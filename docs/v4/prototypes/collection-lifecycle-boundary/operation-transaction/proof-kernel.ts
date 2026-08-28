import type { Pool, PoolClient } from "pg";

const issueBrand = Symbol("collection-lifecycle-issue");

export type IssueIdentity = `collection:${string}/issue:${string}`;

export type PublicFailure = Readonly<{
	kind: "declared" | "framework";
	code: string;
	retryable: false;
}>;

export type ProofOutcome =
	| Readonly<{
			ok: true;
			result: Readonly<Record<string, unknown>>;
			transactionId: string;
			now: string;
			replayed: boolean;
	  }>
	| Readonly<{
			ok: false;
			error: PublicFailure;
			bytes: Uint8Array;
			classification:
				| "collectionIssue"
				| "postgresConstraint"
				| "internal"
				| "cancelled"
				| "deadline"
				| "limit";
	  }>;

export type ProofTrace = {
	events: string[];
	lifecycleRuns: number;
	transactionIds: string[];
};

export type ExecuteInput = Readonly<{
	callId: string;
	ticketId: string;
	caller: Readonly<Record<string, unknown>>;
	trusted: Readonly<Record<string, unknown>>;
	issueMappings?: ReadonlyMap<IssueIdentity, string>;
	catchIssue?: boolean;
	fault?:
		| "unknown"
		| "forged"
		| "malformed"
		| "unmapped"
		| "cancel"
		| "deadline";
	maxStatements?: number;
	nestedDepth?: number;
	maxReentry?: number;
}>;

type InternalFailure = Error & {
	readonly classification:
		| "postgresConstraint"
		| "internal"
		| "cancelled"
		| "deadline"
		| "limit";
};

class CollectionIssue extends Error {
	readonly [issueBrand] = true;

	constructor(readonly identity: IssueIdentity) {
		super("Collection lifecycle issue");
	}
}

function internalFailure(
	classification: InternalFailure["classification"],
): InternalFailure {
	return Object.assign(new Error("operation failed"), { classification });
}

function isCollectionIssue(error: unknown): error is CollectionIssue {
	return (
		error instanceof CollectionIssue &&
		error[issueBrand] === true &&
		/^collection:[a-z][a-z0-9-]*\/issue:[a-z][A-Za-z0-9]*$/.test(error.identity)
	);
}

function publicBytes(error: PublicFailure): Uint8Array {
	return new TextEncoder().encode(JSON.stringify({ ok: false, error }));
}

function normalizeLane(
	laneName: "caller" | "trusted",
	lane: Readonly<Record<string, unknown>>,
	trace: ProofTrace,
): Readonly<Record<string, unknown>> {
	trace.events.push(`normalize:${laneName}`);
	const before = Object.keys(lane).toSorted();
	const normalized = Object.fromEntries(
		Object.entries(lane).map(([path, value]) => [
			path,
			typeof value === "string" ? value.trim() : value,
		]),
	);
	const after = Object.keys(normalized).toSorted();
	if (JSON.stringify(before) !== JSON.stringify(after))
		throw internalFailure("internal");
	return Object.freeze(normalized);
}

function codec(
	candidate: Readonly<Record<string, unknown>>,
	trace: ProofTrace,
) {
	trace.events.push("codec");
	if (
		typeof candidate.title !== "string" ||
		typeof candidate.status !== "string" ||
		typeof candidate.secret !== "string"
	)
		throw internalFailure("internal");
}

const emptyTitle = "collection:tickets/issue:emptyTitle" as const;
const forbiddenTitle = "collection:tickets/issue:forbiddenTitle" as const;
const unmappedIssue = "collection:tickets/issue:unmapped" as const;

export const ticketIssues = Object.freeze({
	emptyTitle,
	forbiddenTitle,
	unmappedIssue,
});

function raise(identity: IssueIdentity, doom: () => void): never {
	doom();
	throw new CollectionIssue(identity);
}

async function rollback(client: PoolClient, trace: ProofTrace): Promise<void> {
	await client.query("ROLLBACK");
	trace.events.push("rollback");
}

export class OperationTransactionProof {
	constructor(
		private readonly pool: Pool,
		private readonly schema: string,
	) {
		if (!/^qp_lifecycle_[a-z0-9_]+$/.test(schema))
			throw new TypeError("unsafe proof schema");
	}

	async execute(input: ExecuteInput, trace: ProofTrace): Promise<ProofOutcome> {
		if ("updatedAt" in input.caller || "updatedAt" in input.trusted)
			return this.frameworkFailure("QP-DATA-023", "internal");

		const replay = await this.pool.query<{
			result: Readonly<Record<string, unknown>>;
			transaction_id: string;
			now: string;
		}>(
			`SELECT result, transaction_id, now::text AS now FROM ${this.schema}.receipts WHERE call_id = $1`,
			[input.callId],
		);
		const receipt = replay.rows[0];
		if (receipt) {
			trace.events.push("committed-replay");
			return {
				ok: true,
				result: receipt.result,
				transactionId: receipt.transaction_id,
				now: receipt.now,
				replayed: true,
			};
		}

		const client = await this.pool.connect();
		let doomedByIssue: IssueIdentity | null = null;
		let doomed = false;
		let began = false;
		let statements = 0;
		const doom = () => {
			doomed = true;
		};
		const spend = () => {
			statements += 1;
			if (statements > (input.maxStatements ?? 20)) {
				doom();
				throw internalFailure("limit");
			}
		};

		try {
			await client.query("BEGIN");
			began = true;
			trace.events.push("begin");
			const clock = await client.query<{ now: string; transaction_id: string }>(
				"SELECT transaction_timestamp()::text AS now, pg_current_xact_id()::text AS transaction_id",
			);
			spend();
			const { now, transaction_id: transactionId } = clock.rows[0]!;
			trace.transactionIds.push(transactionId);
			trace.lifecycleRuns += 1;

			const caller = normalizeLane("caller", input.caller, trace);
			const trusted = normalizeLane("trusted", input.trusted, trace);
			const overlap = Object.keys(caller).find((path) => path in trusted);
			if (overlap) throw internalFailure("internal");
			const candidate = Object.freeze({ ...caller, ...trusted });
			codec(candidate, trace);

			trace.events.push("validate");
			const raiseFirst = (identity: IssueIdentity): never =>
				raise(identity, () => {
					doomedByIssue ??= identity;
					doom();
				});
			const validate = () => {
				if (candidate.title === "") raiseFirst(emptyTitle);
				if (
					candidate.title === "forbidden" ||
					candidate.status === "also-invalid"
				)
					raiseFirst(forbiddenTitle);
				if (input.fault === "unknown") throw new Error("secret unknown detail");
				if (input.fault === "forged")
					throw { identity: emptyTitle, stack: "secret forged stack" };
				if (input.fault === "malformed")
					throw new CollectionIssue("collection:../issue:bad" as IssueIdentity);
				if (input.fault === "unmapped") raiseFirst(unmappedIssue);
			};
			if (input.catchIssue) {
				try {
					validate();
				} catch (error) {
					trace.events.push("application-catch");
					if (!isCollectionIssue(error)) throw error;
				}
			} else validate();
			if (doomedByIssue) throw new CollectionIssue(doomedByIssue);

			trace.events.push("candidate-policy");
			if (candidate.secret === "policy-denied")
				throw internalFailure("internal");
			trace.events.push("check");
			if (candidate.title === "database-forbidden") raiseFirst(forbiddenTitle);
			trace.events.push("constraint-and-database-values");
			const written = await client.query<{
				id: string;
				title: string;
				status: string;
				updated_at: string;
			}>(
				`INSERT INTO ${this.schema}.tickets (id, title, secret, status, updated_at)
				 VALUES ($1, $2, $3, $4, transaction_timestamp())
				 ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, secret = EXCLUDED.secret,
				 status = EXCLUDED.status, updated_at = transaction_timestamp()
				 RETURNING id::text, title, status, updated_at::text`,
				[input.ticketId, candidate.title, candidate.secret, candidate.status],
			);
			spend();
			const row = written.rows[0]!;
			if (input.fault === "cancel") {
				doom();
				throw internalFailure("cancelled");
			}
			if (input.fault === "deadline") {
				doom();
				throw internalFailure("deadline");
			}
			trace.events.push("afterWrite");

			const nested = async (depth: number): Promise<void> => {
				if (depth > (input.maxReentry ?? 3)) {
					doom();
					throw internalFailure("limit");
				}
				trace.events.push(`nested-write:${depth}`);
				await client.query(
					`INSERT INTO ${this.schema}.audit (ticket_id, ordinal, transaction_id)
					 VALUES ($1, $2, pg_current_xact_id()::text)`,
					[input.ticketId, depth],
				);
				spend();
				if (depth < (input.nestedDepth ?? 0)) await nested(depth + 1);
			};
			await nested(0);
			trace.events.push("job-accept");
			await client.query(
				`INSERT INTO ${this.schema}.jobs (id, ticket_id, transaction_id) VALUES ($1, $2, pg_current_xact_id()::text)`,
				[`${input.callId}:job`, input.ticketId],
			);
			spend();
			if (doomed) throw internalFailure("internal");

			const stableClock = await client.query<{ stable: boolean }>(
				"SELECT transaction_timestamp()::text = $1 AS stable",
				[now],
			);
			spend();
			if (!stableClock.rows[0]?.stable) throw internalFailure("internal");

			const result = Object.freeze({
				id: row.id,
				title: row.title,
				status: row.status,
				updatedAt: row.updated_at,
			});
			trace.events.push("receipt");
			await client.query(
				`INSERT INTO ${this.schema}.receipts (call_id, result, transaction_id, now) VALUES ($1, $2::jsonb, $3, $4::timestamptz)`,
				[input.callId, JSON.stringify(result), transactionId, now],
			);
			spend();
			await client.query("COMMIT");
			trace.events.push("commit");
			return { ok: true, result, transactionId, now, replayed: false };
		} catch (error) {
			if (began) await rollback(client, trace);
			trace.events.push("map");
			if (isCollectionIssue(error)) {
				const code = input.issueMappings?.get(error.identity);
				if (code) return this.declaredFailure(code, "collectionIssue");
			}
			const databaseError = error as { code?: unknown };
			if (databaseError.code === "23514")
				return this.frameworkFailure("INTERNAL", "postgresConstraint");
			const classification =
				error instanceof Error && "classification" in error
					? (error as InternalFailure).classification
					: "internal";
			return this.frameworkFailure("INTERNAL", classification);
		} finally {
			client.release();
		}
	}

	private declaredFailure(
		code: string,
		classification: "collectionIssue",
	): ProofOutcome {
		const error = Object.freeze({
			kind: "declared" as const,
			code,
			retryable: false as const,
		});
		return { ok: false, error, bytes: publicBytes(error), classification };
	}

	private frameworkFailure(
		code: string,
		classification: Exclude<
			ProofOutcome & { ok: false },
			{ classification: "collectionIssue" }
		>["classification"],
	): ProofOutcome {
		const error = Object.freeze({
			kind: "framework" as const,
			code,
			retryable: false as const,
		});
		return { ok: false, error, bytes: publicBytes(error), classification };
	}
}

export type ReachabilityNode = Readonly<{
	identity: string;
	issues: readonly IssueIdentity[];
	calls: readonly string[];
}>;

export function compileIssueCapability(
	input: Readonly<{
		operation: string;
		root: string;
		nodes: ReadonlyMap<string, ReachabilityNode>;
		mappings: ReadonlyMap<IssueIdentity, string>;
		declaredErrors: readonly string[];
	}>,
):
	| Readonly<{ ok: true; call: Readonly<{ identity: string }> }>
	| Readonly<{
			ok: false;
			code: "QP-COMPOSE-027";
			reason:
				| "invalidIssueDeclaration"
				| "invalidIssueMapping"
				| "missingIssueMapping";
			path: readonly string[];
			issue: IssueIdentity;
			mappedError?: string;
			call?: never;
	  }> {
	const reachable = new Map<IssueIdentity, readonly string[]>();
	const visit = (
		identity: string,
		path: readonly string[],
		visited: ReadonlySet<string>,
	): ReturnType<typeof compileIssueCapability> | null => {
		if (visited.has(identity)) return null;
		const node = input.nodes.get(identity);
		if (!node) throw new TypeError(`unknown reachability node: ${identity}`);
		const nextVisited = new Set(visited).add(identity);
		for (const issue of node.issues) {
			if (!/^collection:[a-z][a-z0-9-]*\/issue:[a-z][A-Za-z0-9]*$/.test(issue))
				return {
					ok: false,
					code: "QP-COMPOSE-027",
					reason: "invalidIssueDeclaration",
					path,
					issue,
				};
			reachable.set(issue, path);
		}
		for (const target of node.calls) {
			const failure = visit(target, [...path, target], nextVisited);
			if (failure) return failure;
		}
		return null;
	};
	const traversalFailure = visit(
		input.root,
		[input.operation, input.root],
		new Set(),
	);
	if (traversalFailure) return traversalFailure;
	for (const [issue, mappedError] of input.mappings) {
		if (!reachable.has(issue) || !input.declaredErrors.includes(mappedError))
			return {
				ok: false,
				code: "QP-COMPOSE-027",
				reason: "invalidIssueMapping",
				path: reachable.get(issue) ?? [input.operation, input.root],
				issue,
				mappedError,
			};
	}
	for (const [issue, path] of reachable)
		if (!input.mappings.has(issue))
			return {
				ok: false,
				code: "QP-COMPOSE-027",
				reason: "missingIssueMapping",
				path,
				issue,
			};
	return {
		ok: true,
		call: Object.freeze({ identity: input.operation }),
	};
}

export function directFailureBytes(outcome: ProofOutcome): Uint8Array {
	if (outcome.ok) throw new TypeError("expected failure");
	return publicBytes(outcome.error);
}

export function wireFailureBytes(outcome: ProofOutcome): Uint8Array {
	if (outcome.ok) throw new TypeError("expected failure");
	return new TextEncoder().encode(
		JSON.stringify({ ok: false, error: outcome.error }),
	);
}
