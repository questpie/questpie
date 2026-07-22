import {
	and,
	createCollection,
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
	const { queryFn, updateSnapshot } = resolveSync({
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
				const persisted = await Promise.all(
					transaction.mutations.map((mutation) =>
						client.create(mutation.modified),
					),
				);
				updateSnapshot((rows) => {
					const next = [...rows];
					for (let index = 0; index < transaction.mutations.length; index++) {
						const optimistic = transaction.mutations[index]!.modified;
						const result = persisted[index];
						const row =
							result && typeof result === "object" && "id" in result
								? (result as TRow)
								: optimistic;
						const existing = next.findIndex((item) => item.id === row.id);
						if (existing === -1) next.push(row);
						else next[existing] = row;
					}
					return next;
				});
				return skipRefetch;
			},
			onUpdate: async ({ transaction }) => {
				const persisted = await Promise.all(
					transaction.mutations.map((mutation) =>
						client.update({
							id: String(mutation.key),
							data: mutation.changes,
						}),
					),
				);
				updateSnapshot((rows) => {
					const byId = new Map(rows.map((row) => [row.id, row]));
					for (let index = 0; index < transaction.mutations.length; index++) {
						const mutation = transaction.mutations[index]!;
						const result = persisted[index];
						const current = byId.get(String(mutation.key));
						if (!current) continue;
						byId.set(
							String(mutation.key),
							result && typeof result === "object" && "id" in result
								? (result as TRow)
								: ({ ...current, ...mutation.changes } as TRow),
						);
					}
					return rows.map((row) => byId.get(row.id) ?? row);
				});
				return skipRefetch;
			},
			onDelete: async ({ transaction }) => {
				await Promise.all(
					transaction.mutations.map((mutation) =>
						client.delete({ id: String(mutation.key) }),
					),
				);
				const deleted = new Set(
					transaction.mutations.map((mutation) => String(mutation.key)),
				);
				updateSnapshot((rows) => rows.filter((row) => !deleted.has(row.id)));
				return skipRefetch;
			},
		}),
	);
}
