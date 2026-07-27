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
	update: (params: { id: string; data: Partial<TRow> }) => Promise<unknown>;
	delete: (params: { id: string }) => Promise<unknown>;
};

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

	return createCollection(
		queryCollectionOptions({
			id: `questpie:${name}`,
			queryClient,
			queryKey,
			queryFn,
			getKey: rowId,
			onInsert: async ({ transaction }) => {
				const snapshotRevision = getSnapshotRevision();
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
				const persisted = await Promise.all(
					transaction.mutations.map((mutation) =>
						client.update({
							id: String(mutation.key),
							data: mutation.changes,
						}),
					),
				);
				await reconcileMutation(
					snapshotRevision,
					(rows) => {
						const byId = new Map(rows.map((row) => [row.id, row]));
						for (let index = 0; index < transaction.mutations.length; index++) {
							const mutation = transaction.mutations[index]!;
							const current = byId.get(String(mutation.key));
							if (!current) continue;
							byId.set(
								String(mutation.key),
								persistedRow(persisted[index], {
									...current,
									...mutation.changes,
								} as TRow),
							);
						}
						return rows.map((row) => byId.get(row.id) ?? row);
					},
					(rows) => {
						const byId = new Map(rows.map((row) => [row.id, row]));
						for (let index = 0; index < transaction.mutations.length; index++) {
							const mutation = transaction.mutations[index]!;
							const current = byId.get(String(mutation.key));
							if (!current) continue;
							const original = mutation.original as TRow;
							const result = persistedRow(persisted[index], {
								...original,
								...mutation.changes,
							} as TRow);
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
				await Promise.all(
					transaction.mutations.map((mutation) =>
						client.delete({ id: String(mutation.key) }),
					),
				);
				const deleted = new Set(
					transaction.mutations.map((mutation) => String(mutation.key)),
				);
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
