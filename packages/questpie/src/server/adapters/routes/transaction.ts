/**
 * Cross-collection transaction route.
 *
 * One ordered list of mutations spanning any number of collections, applied
 * inside a single Postgres transaction: every operation commits or none does.
 * A client store that rolls its optimistic state back on failure needs exactly
 * this — three separate HTTP calls leave the server holding two committed
 * writes while the UI shows none.
 *
 * The engine already did all of this. `withTransaction` reuses an ambient
 * transaction through AsyncLocalStorage
 * (`collection/crud/shared/transaction.ts`), so every CRUD verb silently joins
 * the transaction opened here, and the realtime outbox append does the same —
 * a rollback takes the change events with it. What was missing was only the
 * HTTP surface: every mutating route is scoped to one `params.collection`.
 *
 * ## Design decisions
 *
 * **Authorization.** Each operation is authorized as the requesting principal
 * against its own collection. The transaction context is the request's own
 * `appContext` with nothing but `db` replaced, so `accessMode`, `session` and
 * `principal` are untouched and every verb runs its normal per-record access
 * control and hooks. There is deliberately no elevated path here: batching is
 * not a reason to skip a check, and one request buys one session resolution,
 * not one authorization.
 *
 * **Ordering and locks.** Operations run strictly in the order given, and are
 * never reordered. The order is semantic — operation N+1 routinely depends on
 * N (create a post, then its comment; delete the child, then the parent) — so
 * sorting by `(collection, id)` for deadlock avoidance would break referential
 * correctness to buy a partial guarantee. Cross-table lock ordering therefore
 * belongs to the caller, and it is a real hazard: two concurrent batches that
 * touch the same rows in opposite order can deadlock, and Postgres will abort
 * one of them (the loser gets a failure that, correctly, says nothing was
 * applied). Callers who care should order operations consistently across call
 * sites. Server-side code that needs to take locks explicitly ahead of its
 * writes has `collection.lockMany()`, which locks in deterministic id order
 * inside the active transaction.
 *
 * **The error contract.** A failure aborts the whole batch and the response
 * carries `context.custom.transaction` naming the operation that failed and
 * stating that nothing was applied. The underlying error's code, message,
 * translation key and field errors are preserved verbatim, so a stale revision
 * is still a 409 CONFLICT and a denied write is still a 403 — the descriptor
 * tells the store *where*, the code tells it *what to do*.
 *
 * **Optimistic concurrency.** `expectedRevision` travels per operation. It is
 * required at the type level on the client whenever the collection enables
 * `optimisticConcurrency`, and enforced by the CRUD layer regardless. The
 * `If-Match` header is rejected: one ETag cannot address many rows.
 *
 * POST /transaction
 */

import { attachTxid } from "#questpie/shared/txid.js";

import {
	getTransactionTxid,
	withTransaction,
} from "../../collection/crud/shared/transaction.js";
import type { Questpie } from "../../config/questpie.js";
import { ApiError, parseDatabaseError } from "../../errors/index.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { parseRouteBody } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";
import { txidHeaders } from "./optimistic-concurrency.js";

/**
 * One mutation in a transaction, as it arrives on the wire.
 *
 * The verb set is exactly what a client store produces — insert, update,
 * delete. Bulk verbs (`updateMany`, `deleteMany`) are deliberately absent: a
 * where-clause mutation inside an ordered batch has no stable meaning once
 * earlier operations have already moved rows in or out of its predicate.
 */
export type TransactionOperationInput =
	| {
			collection: string;
			operation: "create";
			data: Record<string, unknown>;
	  }
	| {
			collection: string;
			operation: "update";
			id: string | number;
			data: Record<string, unknown>;
			expectedRevision?: number;
	  }
	| {
			collection: string;
			operation: "delete";
			id: string | number;
			expectedRevision?: number;
	  };

/** Machine-readable descriptor attached to a failed transaction's error. */
export type TransactionFailure = {
	/** Zero-based index of the failing operation, in request order. */
	index: number;
	collection: string;
	operation: TransactionOperationInput["operation"];
	/** Always `false`: the transaction rolled back, including the outbox. */
	applied: false;
};

/**
 * Upper bound on one batch.
 *
 * A transaction is held open for the whole list, so an unbounded batch is an
 * availability hazard — held row locks and a long-lived snapshot — rather than
 * a correctness one. 100 matches the cap `lockMany` already enforces.
 *
 * Deliberately stricter than the per-collection `updateBatch`, which has no
 * cap: that one takes a homogeneous update list for a single table, while this
 * accepts arbitrary verbs across arbitrary tables from any authenticated
 * caller.
 */
const MAX_TRANSACTION_OPERATIONS = 100;

const MUTATION_OPERATIONS = new Set(["create", "update", "delete"]);

/**
 * Validate the wire body into operations that are safe to dispatch.
 *
 * `operation` is checked against a literal allowlist and `collection` against
 * the app's own collections with `Object.hasOwn`, so neither a verb nor a
 * collection name taken from the request body can reach anything but a real
 * CRUD verb on a real collection.
 */
function parseOperations(
	app: Questpie<any>,
	body: unknown,
): TransactionOperationInput[] {
	if (body === null || typeof body !== "object") {
		throw ApiError.badRequest(
			"Invalid JSON body",
			undefined,
			"error.invalidJsonBody",
		);
	}

	const { operations } = body as { operations?: unknown };
	if (!Array.isArray(operations)) {
		throw ApiError.badRequest("operations must be an array");
	}
	if (operations.length > MAX_TRANSACTION_OPERATIONS) {
		throw ApiError.badRequest(
			`A transaction accepts at most ${MAX_TRANSACTION_OPERATIONS} operations`,
		);
	}

	return operations.map((raw, index) => {
		const at = `operations[${index}]`;
		if (raw === null || typeof raw !== "object") {
			throw ApiError.badRequest(`${at} must be an object`);
		}
		const op = raw as Record<string, unknown>;

		if (typeof op.collection !== "string") {
			throw ApiError.badRequest(`${at}.collection must be a string`);
		}
		if (!Object.hasOwn(app.collections, op.collection)) {
			throw ApiError.notFound("Collection", op.collection);
		}
		if (
			typeof op.operation !== "string" ||
			!MUTATION_OPERATIONS.has(op.operation)
		) {
			throw ApiError.badRequest(
				`${at}.operation must be create, update or delete`,
			);
		}
		if (
			op.expectedRevision !== undefined &&
			(typeof op.expectedRevision !== "number" ||
				!Number.isFinite(op.expectedRevision))
		) {
			throw ApiError.badRequest(`${at}.expectedRevision must be a number`);
		}

		if (op.operation === "create") {
			if (op.data === null || typeof op.data !== "object") {
				throw ApiError.badRequest(`${at}.data must be an object`);
			}
			return {
				collection: op.collection,
				operation: "create",
				data: op.data as Record<string, unknown>,
			};
		}

		if (typeof op.id !== "string" && typeof op.id !== "number") {
			throw ApiError.badRequest(`${at}.id must be a string or a number`);
		}

		if (op.operation === "update") {
			if (op.data === null || typeof op.data !== "object") {
				throw ApiError.badRequest(`${at}.data must be an object`);
			}
			return {
				collection: op.collection,
				operation: "update",
				id: op.id,
				data: op.data as Record<string, unknown>,
				...(op.expectedRevision === undefined
					? {}
					: { expectedRevision: op.expectedRevision as number }),
			};
		}

		return {
			collection: op.collection,
			operation: "delete",
			id: op.id,
			...(op.expectedRevision === undefined
				? {}
				: { expectedRevision: op.expectedRevision as number }),
		};
	});
}

/**
 * Resolve a thrown value to an `ApiError` so decorating a failure never
 * changes the status the caller would otherwise have received for that
 * operation. Mirrors `handleError`'s ladder minus its `ZodError` rung: CRUD
 * converts validation issues with `ApiError.fromZodError` before they leave
 * the verb (`crud-generator.ts:1782`, `:2409`).
 */
function toApiError(error: unknown): ApiError {
	if (error instanceof ApiError) return error;
	const dbError = parseDatabaseError(error);
	if (dbError) return dbError;
	return ApiError.internal(
		error instanceof Error ? error.message : "Unknown error",
		error,
	);
}

/**
 * Re-throw an operation's failure with the transaction descriptor attached.
 *
 * Everything the client already keys on — code, message, `messageKey`, field
 * errors — is carried through unchanged; only `context.custom.transaction` is
 * added.
 */
function decorateFailure(
	error: unknown,
	index: number,
	operation: TransactionOperationInput,
): ApiError {
	const resolved = toApiError(error);
	const failure: TransactionFailure = {
		index,
		collection: operation.collection,
		operation: operation.operation,
		applied: false,
	};

	return new ApiError({
		code: resolved.code,
		message: resolved.message,
		...(resolved.messageKey === undefined
			? {}
			: { messageKey: resolved.messageKey }),
		...(resolved.messageParams === undefined
			? {}
			: { messageParams: resolved.messageParams }),
		...(resolved.fieldErrors === undefined
			? {}
			: { fieldErrors: resolved.fieldErrors }),
		context: {
			...resolved.context,
			custom: { ...resolved.context?.custom, transaction: failure },
		},
		cause: resolved.cause ?? error,
	});
}

function applyOperation(
	crud: any,
	operation: TransactionOperationInput,
	context: unknown,
): Promise<unknown> {
	// An explicit switch, not `crud[operation.operation]` — the verb reaching
	// the collection must come from this file, never from the request body.
	switch (operation.operation) {
		case "create":
			return crud.create(operation.data, context);
		case "update":
			return crud.updateById(
				{
					id: operation.id,
					data: operation.data,
					...(operation.expectedRevision === undefined
						? {}
						: { expectedRevision: operation.expectedRevision }),
				},
				context,
			);
		case "delete":
			return crud.deleteById(
				{
					id: operation.id,
					...(operation.expectedRevision === undefined
						? {}
						: { expectedRevision: operation.expectedRevision }),
				},
				context,
			);
	}
}

export async function collectionsTransaction(
	app: Questpie<any>,
	request: Request,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const locale = resolved.appContext.locale;

	try {
		// One ETag cannot address many rows. Per-operation `expectedRevision` is
		// the only conditional mechanism here.
		if (request.headers.has("if-match")) {
			throw ApiError.badRequest("If-Match is not supported on a transaction");
		}

		const body = input !== undefined ? input : await parseRouteBody(request);
		const operations = parseOperations(app, body);
		if (operations.length === 0) {
			return smartResponse([], request, 200);
		}

		const results = await withTransaction(app.db, async (tx) => {
			// The request's own context with the transaction swapped in. Reads and
			// writes inside every verb then run on this connection and see each
			// other's uncommitted rows; `session`, `principal` and `accessMode`
			// are the caller's, unchanged.
			const txContext = { ...resolved.appContext, db: tx };
			const applied: unknown[] = [];

			for (const [index, operation] of operations.entries()) {
				const crud = app.collections[operation.collection as never] as any;
				try {
					applied.push(await applyOperation(crud, operation, txContext));
				} catch (error) {
					// Throwing out of `withTransaction` rolls the whole thing back —
					// rows, realtime outbox entries and queued afterCommit callbacks.
					throw decorateFailure(error, index, operation);
				}
			}

			return attachTxid(applied, getTransactionTxid());
		});

		return smartResponse(results, request, 200, txidHeaders(results));
	} catch (error) {
		return handleError(error, { request, app, locale });
	}
}
