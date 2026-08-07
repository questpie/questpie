import {
	and,
	createCollection,
	deepEquals,
	eq,
	gt,
	inArray,
	lt,
	or,
	type Collection,
} from "@tanstack/db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { useLiveQuery } from "@tanstack/react-db";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { resolveSync, type QuestpieDbSyncMode } from "./sync.js";

export { and, eq, gt, inArray, lt, or, useLiveQuery };

type MutableRow = { id: string; [key: string]: unknown };

type MutationCollectionClient<TRow extends MutableRow> = {
	find: (options?: unknown) => Promise<{ docs: TRow[] }>;
	live: (
		options: unknown,
		onSnapshot: (snapshot: { docs: TRow[] }) => void,
		opts?: { onError?: (error: Error) => void },
	) => () => void;
	create: (data: TRow) => Promise<unknown>;
	updateBatch: (params: {
		updates: Array<{
			id: string;
			data: Partial<TRow>;
			expectedRevision?: number;
		}>;
	}) => Promise<unknown>;
	deleteMany: (params: {
		where: { id: { in: string[] } };
		expectedRevisions?: Array<{ id: string; expectedRevision: number }>;
	}) => Promise<unknown>;
};

/**
 * A mutation lost an optimistic-concurrency race: QUESTPIE answered `409`
 * (`CONFLICT`), or `412` when the request carried `If-Match`. TanStack DB has
 * already rolled the optimistic state back, so the row on screen is the stale
 * one that lost — refetch the collection before retrying, otherwise the retry
 * carries the same stale revision and conflicts again.
 *
 * `ids` lists every row in the failed transaction. QUESTPIE validates all
 * revisions before writing any row, so a conflict fails the whole batch without
 * naming the individual loser.
 */
export class QuestpieDbConflictError extends Error {
	readonly collection: string;
	readonly operation: "update" | "delete";
	readonly ids: string[];

	constructor(options: {
		collection: string;
		operation: "update" | "delete";
		ids: string[];
		cause: unknown;
	}) {
		super(
			`QUESTPIE rejected a ${options.operation} on "${options.collection}" as a conflict: ${options.ids.join(", ")}`,
			{ cause: options.cause },
		);
		this.name = "QuestpieDbConflictError";
		this.collection = options.collection;
		this.operation = options.operation;
		this.ids = options.ids;
	}
}

function isConflict(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const { code, status } = error as { code?: unknown; status?: unknown };
	return status === 409 || status === 412 || code === "CONFLICT";
}

async function asConflict<TResult>(
	options: {
		collection: string;
		operation: "update" | "delete";
		ids: string[];
	},
	run: () => Promise<TResult>,
): Promise<TResult> {
	try {
		return await run();
	} catch (error) {
		if (!isConflict(error)) throw error;
		throw new QuestpieDbConflictError({ ...options, cause: error });
	}
}

/**
 * QUESTPIE owns the `revision` column and only adds it when the collection
 * enables `optimisticConcurrency`, so its presence on the row TanStack DB read
 * is the feature detection. Collections without the feature must not send the
 * key at all: the server ignores it there, which would read as a precondition
 * that was checked when it never was.
 */
function revisionOf(original: unknown): number | undefined {
	const revision = (original as { revision?: unknown } | undefined)?.revision;
	return typeof revision === "number" ? revision : undefined;
}

/** Spreadable form of {@link revisionOf}, so the key is absent when unset. */
function expectedRevisionOf(original: unknown): { expectedRevision?: number } {
	const revision = revisionOf(original);
	return revision === undefined ? {} : { expectedRevision: revision };
}

function rowId(row: MutableRow): string {
	if (typeof row.id !== "string" || row.id.length === 0) {
		throw new Error("QUESTPIE TanStack DB rows require a non-empty string id");
	}
	return row.id;
}

function persistedRow<TRow extends MutableRow>(
	result: unknown,
	fallback: TRow,
): TRow {
	return result && typeof result === "object" && "id" in result
		? (result as TRow)
		: fallback;
}

function persistedRowsById<TRow extends MutableRow>(
	result: unknown,
): Map<string, TRow> {
	const rows = new Map<string, TRow>();
	if (!Array.isArray(result)) return rows;
	for (const row of result) {
		if (row && typeof row === "object" && typeof row.id === "string") {
			rows.set(row.id, row as TRow);
		}
	}
	return rows;
}

export function createQuestpieCollection<TRow extends MutableRow>(options: {
	client: MutationCollectionClient<TRow>;
	name: string;
	queryClient: QueryClient;
	queryKey: QueryKey;
	findOptions?: unknown;
	syncMode: QuestpieDbSyncMode;
	onDispose: (dispose: () => void) => void | (() => void);
}): Collection<TRow, string> {
	const {
		client,
		name,
		queryClient,
		queryKey,
		findOptions,
		syncMode,
		onDispose,
	} = options;
	const { getSnapshotRevision, queryFn, reconcileMutation } = resolveSync({
		client,
		findOptions,
		mode: syncMode,
		queryClient,
		queryKey,
		onDispose,
	});
	const skipRefetch = syncMode === "snapshot" ? { refetch: false } : undefined;

	// TanStack DB calls these handlers once per collection, so every mutation
	// here targets `name` and becomes exactly one QUESTPIE request. A TanStack DB
	// transaction that spans two collections still becomes one request per
	// collection, and nothing here can make those two commit together — apps that
	// need cross-collection atomicity must drive it themselves.
	return createCollection(
		queryCollectionOptions({
			id: `questpie:${name}`,
			queryClient,
			queryKey,
			queryFn,
			getKey: rowId,
			onInsert: async ({ transaction }) => {
				const snapshotRevision = getSnapshotRevision();
				// FRAMEWORK GAP: QUESTPIE has no batch create — `updateBatch` and
				// `deleteMany` have no `createMany` counterpart — so inserts stay N
				// independent requests. Order is not preserved, and a partial failure
				// leaves rows on the server while the client rolls all of them back.
				const persisted = await Promise.all(
					transaction.mutations.map((mutation) =>
						client.create(mutation.modified),
					),
				);
				await reconcileMutation(
					snapshotRevision,
					(rows) => {
						const next = [...rows];
						for (let index = 0; index < transaction.mutations.length; index++) {
							const optimistic = transaction.mutations[index]!.modified;
							const row = persistedRow(persisted[index], optimistic);
							const existing = next.findIndex((item) => item.id === row.id);
							if (existing === -1) next.push(row);
							else next[existing] = row;
						}
						return next;
					},
					(rows) => {
						const next = [...rows];
						for (let index = 0; index < transaction.mutations.length; index++) {
							const optimistic = transaction.mutations[index]!.modified;
							const row = persistedRow(persisted[index], optimistic);
							if (!next.some((item) => item.id === row.id)) next.push(row);
						}
						return next;
					},
				);
				return skipRefetch;
			},
			onUpdate: async ({ transaction }) => {
				const snapshotRevision = getSnapshotRevision();
				const ids = transaction.mutations.map((mutation) =>
					String(mutation.key),
				);
				// One request, one server transaction: QUESTPIE locks the ids in
				// deterministic order and validates every revision before writing any
				// row, so the batch either lands whole or leaves nothing behind.
				const result = await asConflict(
					{ collection: name, operation: "update", ids },
					() =>
						client.updateBatch({
							updates: transaction.mutations.map((mutation) => ({
								id: String(mutation.key),
								data: mutation.changes,
								...expectedRevisionOf(mutation.original),
							})),
						}),
				);
				const persisted = persistedRowsById<TRow>(result);
				await reconcileMutation(
					snapshotRevision,
					(rows) => {
						const byId = new Map(rows.map((row) => [row.id, row]));
						for (const mutation of transaction.mutations) {
							const current = byId.get(String(mutation.key));
							if (!current) continue;
							byId.set(
								String(mutation.key),
								persisted.get(String(mutation.key)) ??
									({ ...current, ...mutation.changes } as TRow),
							);
						}
						return rows.map((row) => byId.get(row.id) ?? row);
					},
					(rows) => {
						const byId = new Map(rows.map((row) => [row.id, row]));
						for (const mutation of transaction.mutations) {
							const current = byId.get(String(mutation.key));
							if (!current) continue;
							const original = mutation.original as TRow;
							const result =
								persisted.get(String(mutation.key)) ??
								({ ...original, ...mutation.changes } as TRow);
							const merged = { ...current };
							for (const key of Object.keys(result) as Array<keyof TRow>) {
								if (deepEquals(current[key], original[key])) {
									merged[key] = result[key];
								}
							}
							byId.set(String(mutation.key), merged);
						}
						return rows.map((row) => byId.get(row.id) ?? row);
					},
				);
				return skipRefetch;
			},
			onDelete: async ({ transaction }) => {
				const snapshotRevision = getSnapshotRevision();
				const ids = transaction.mutations.map((mutation) =>
					String(mutation.key),
				);
				const expectedRevisions = transaction.mutations.flatMap((mutation) => {
					const revision = revisionOf(mutation.original);
					return revision === undefined
						? []
						: [{ id: String(mutation.key), expectedRevision: revision }];
				});
				await asConflict({ collection: name, operation: "delete", ids }, () =>
					client.deleteMany({
						where: { id: { in: ids } },
						// QUESTPIE requires one entry per matched row, so a partially
						// revisioned batch would be rejected as a conflict rather than
						// checked. Rows carry a revision only with optimistic
						// concurrency on, where every row has one.
						...(expectedRevisions.length === ids.length
							? { expectedRevisions }
							: {}),
					}),
				);
				const deleted = new Set(ids);
				await reconcileMutation(
					snapshotRevision,
					(rows) => rows.filter((row) => !deleted.has(row.id)),
					(rows) => {
						const originals = new Map(
							transaction.mutations.map((mutation) => [
								String(mutation.key),
								mutation.original as TRow,
							]),
						);
						return rows.filter((row) => {
							const original = originals.get(row.id);
							return !original || !deepEquals(row, original);
						});
					},
				);
				return skipRefetch;
			},
		}),
	);
}
