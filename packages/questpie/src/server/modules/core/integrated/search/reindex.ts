/**
 * Full-collection reindex.
 *
 * The per-record `index-records` job indexes on write; this backfills an
 * EXISTING dataset (e.g. after a seed, or when search is enabled on data that
 * predates it). It reuses the exact same {@link buildIndexParams} pipeline as
 * the job, iterating every record of a collection across every configured
 * locale, and upserts them via `search.indexBatch`.
 *
 * Lives at the app layer (not the search adapter) because it needs CRUD access
 * to read records — which is why `SearchAdapter.reindex()` could only ever
 * throw "requires app context".
 */

import type { Locale } from "#questpie/server/config/types.js";

import {
	buildIndexParams,
	resolveAutomaticSearchableConfig,
} from "./index-params.js";
import type { IndexParams, SearchableConfig } from "./types.js";

/** Structural slice of the Questpie app this reindex reaches for. */
interface ReindexApp {
	search?: {
		indexBatch(params: IndexParams[]): Promise<void>;
	};
	collections?: Record<
		string,
		{
			find(options: Record<string, unknown>): Promise<unknown>;
			findOne(options: Record<string, unknown>): Promise<unknown>;
		}
	>;
	getLocales?: () => Promise<Locale[]>;
	getCollectionConfig?: (
		name: string,
	) => { state?: { searchable?: SearchableConfig | false } } | undefined;
	config?: { locale?: { defaultLocale?: string } };
}

export interface ReindexResult {
	collection: string;
	/** Records visited (each may produce one index entry per locale). */
	indexed: number;
	/** True when the collection is not searchable or has no search service. */
	skipped: boolean;
}

/**
 * Reindex every record of a single collection across all configured locales.
 */
export async function reindexCollection(
	app: ReindexApp,
	collectionName: string,
	opts?: { pageSize?: number },
): Promise<ReindexResult> {
	const search = app.search;
	const collectionApi = app.collections?.[collectionName];
	if (!search || !collectionApi) {
		return { collection: collectionName, indexed: 0, skipped: true };
	}

	// Only explicitly enabled, automatically managed projections are reindexed.
	const searchable =
		app.getCollectionConfig?.(collectionName)?.state?.searchable;
	if (!resolveAutomaticSearchableConfig(searchable)) {
		return { collection: collectionName, indexed: 0, skipped: true };
	}

	const locales = (await app.getLocales?.()) ?? [{ code: "en" } as Locale];
	const localeCodes = locales.map((l) => l.code);
	const defaultLocale = app.config?.locale?.defaultLocale ?? "en";

	const pageSize = opts?.pageSize ?? 100;
	let offset = 0;
	let indexed = 0;

	// A collection that can't be read (adapter quirk, transient error) must not
	// abort a full reindex — log and return what was indexed so far.
	try {
		for (;;) {
			const res = (await collectionApi.find({
				limit: pageSize,
				offset,
				locale: defaultLocale,
				localeFallback: false,
				populate: false,
			})) as { docs?: Record<string, any>[] } | Record<string, any>[];
			const docs: Record<string, any>[] = Array.isArray(res)
				? res
				: (res?.docs ?? []);
			if (docs.length === 0) break;

			const ops: IndexParams[] = [];
			for (const doc of docs) {
				for (const locale of localeCodes) {
					// The default-locale record is already loaded; other locales need
					// a per-locale fetch (localeFallback:false so we only index real
					// translations).
					const record =
						locale === defaultLocale
							? doc
							: ((await collectionApi.findOne({
									where: { id: doc.id },
									locale,
									localeFallback: false,
									populate: false,
								})) as Record<string, any> | null);
					if (!record) continue;

					const params = await buildIndexParams(record, {
						collection: collectionName,
						locale,
						searchable,
						app,
						defaultLocale,
					});
					if (params) ops.push(params);
				}
			}

			if (ops.length > 0) await search.indexBatch(ops);
			indexed += docs.length;
			if (docs.length < pageSize) break;
			offset += pageSize;
		}
	} catch (error) {
		console.warn(
			`[search] reindex of "${collectionName}" stopped after ${indexed} record(s):`,
			error,
		);
	}

	return { collection: collectionName, indexed, skipped: false };
}

/**
 * Reindex every searchable collection. Used after seeding so the search index
 * reflects the seeded dataset without needing a running queue worker.
 */
export async function reindexAllCollections(
	app: ReindexApp & { config?: { collections?: Record<string, unknown> } },
): Promise<ReindexResult[]> {
	const names = Object.keys(app.collections ?? {});
	const results: ReindexResult[] = [];
	for (const name of names) {
		results.push(await reindexCollection(app, name));
	}
	return results;
}
