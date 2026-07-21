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
	onDispose: (dispose: () => void) => void;
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
	const { queryFn } = resolveSync({
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
				await Promise.all(
					transaction.mutations.map((mutation) =>
						client.create(mutation.modified),
					),
				);
				return skipRefetch;
			},
			onUpdate: async ({ transaction }) => {
				await Promise.all(
					transaction.mutations.map((mutation) =>
						client.update({
							id: String(mutation.key),
							data: mutation.changes,
						}),
					),
				);
				return skipRefetch;
			},
			onDelete: async ({ transaction }) => {
				await Promise.all(
					transaction.mutations.map((mutation) =>
						client.delete({ id: String(mutation.key) }),
					),
				);
				return skipRefetch;
			},
		}),
	);
}
