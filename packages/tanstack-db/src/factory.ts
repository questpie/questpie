import type { Collection } from "@tanstack/db";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { QuestpieApp, QuestpieClient } from "questpie/client";

import { createQuestpieCollection } from "./collection.js";
import type { QuestpieDbSyncMode } from "./sync.js";
import type {
	CollectionKeys,
	FindOptionsOf,
	QuestpieDb,
	SnapshotFindOptionsOf,
} from "./types.js";

export type QuestpieFindOptions<
	TApp extends QuestpieApp,
	TMode extends QuestpieDbSyncMode = QuestpieDbSyncMode,
> = Partial<{
	[K in CollectionKeys<TApp>]: TMode extends "snapshot"
		? SnapshotFindOptionsOf<TApp, K>
		: FindOptionsOf<TApp, K>;
}>;

export type CreateQuestpieCollectionsOptions<
	TApp extends QuestpieApp,
	TMode extends QuestpieDbSyncMode = QuestpieDbSyncMode,
> = {
	queryClient: QueryClient;
	syncMode?: TMode;
	find?: QuestpieFindOptions<TApp, TMode>;
	keyPrefix?: QueryKey;
};

type RuntimeCollectionClient = Parameters<
	typeof createQuestpieCollection<{ id: string }>
>[0]["client"];

const SHAPE_CHANGING_FIND_OPTIONS = [
	"columns",
	"with",
	"extras",
	"groupBy",
] as const;

/**
 * Find options `find()` honours that the realtime topic cannot carry — the
 * complement of `SnapshotFindOptionsOf`. In snapshot mode the live subscription
 * would silently ignore them while the post-mutation repair read applied them,
 * so the two would describe different row sets.
 */
export const SNAPSHOT_UNSUPPORTED_FIND_OPTIONS = [
	"search",
	"localeFallback",
	"includeDeleted",
	"stage",
] as const;

function assertBaseRowFindOptions(options: unknown): void {
	if (!options || typeof options !== "object" || Array.isArray(options)) return;
	for (const key of SHAPE_CHANGING_FIND_OPTIONS) {
		if (key in options) {
			throw new Error(
				`QUESTPIE TanStack DB find.${key} is not supported because collections require base rows with an id`,
			);
		}
	}
}

function assertSnapshotFindOptions(options: unknown): void {
	if (!options || typeof options !== "object" || Array.isArray(options)) return;
	for (const key of SNAPSHOT_UNSUPPORTED_FIND_OPTIONS) {
		if (key in options) {
			throw new Error(
				`QUESTPIE TanStack DB find.${key} is not supported in snapshot sync mode because live subscriptions cannot carry it, so snapshots and repair reads would describe different rows`,
			);
		}
	}
}

export function createQuestpieCollections<
	TApp extends QuestpieApp,
	TMode extends QuestpieDbSyncMode = QuestpieDbSyncMode,
>(
	client: QuestpieClient<TApp>,
	options: CreateQuestpieCollectionsOptions<TApp, TMode>,
): QuestpieDb<TApp> {
	const cache = new Map<string, Collection<{ id: string }, string>>();
	const disposers = new Set<() => void>();
	const syncMode = options.syncMode ?? "refetch";
	let destroyed = false;

	const collections = new Proxy(
		Object.create(null) as Record<string, unknown>,
		{
			get(_target, property) {
				if (typeof property !== "string") return undefined;
				if (destroyed) {
					throw new Error("QUESTPIE TanStack DB registry has been destroyed");
				}
				const cached = cache.get(property);
				if (cached) return cached;

				const collectionClient = client.collections[property];
				if (!collectionClient) return undefined;
				const findOptions = options.find?.[property as CollectionKeys<TApp>];
				assertBaseRowFindOptions(findOptions);
				if (syncMode === "snapshot") assertSnapshotFindOptions(findOptions);
				const created = createQuestpieCollection({
					client: collectionClient as unknown as RuntimeCollectionClient,
					name: property,
					queryClient: options.queryClient,
					queryKey: [
						...(options.keyPrefix ?? ["questpie", "tanstack-db"]),
						property,
						findOptions,
					],
					findOptions,
					syncMode,
					onDispose: (dispose) => {
						disposers.add(dispose);
						return () => disposers.delete(dispose);
					},
				});
				cache.set(property, created);
				return created;
			},
		},
	);

	return {
		collections: collections as QuestpieDb<TApp>["collections"],
		destroy() {
			if (destroyed) return;
			destroyed = true;
			for (const dispose of disposers) dispose();
			disposers.clear();
			cache.clear();
		},
	};
}
