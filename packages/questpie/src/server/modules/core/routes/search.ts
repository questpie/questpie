/**
 * Search route — POST /search
 *
 * FTS-powered search across collections with access control filtering,
 * CRUD population (hooks run), and search metadata merging.
 */
import { z } from "zod";
import { route } from "#questpie/server/routes/define-route.js";
import { executeAccessRule } from "#questpie/server/collection/crud/shared/access-control.js";
import type {
	CollectionAccessFilter,
	PopulatedSearchResponse,
	SearchMeta,
} from "#questpie/server/integrated/search/types.js";

const searchSchema = z.object({
	query: z.string().optional(),
	collections: z.array(z.string()).optional(),
	locale: z.string().optional(),
	limit: z.number().optional(),
	offset: z.number().optional(),
	filters: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
	highlights: z.boolean().optional(),
	facets: z.array(z.any()).optional(),
	mode: z.string().optional(),
});

export default route()
	.post()
	.schema(searchSchema)
	.access(({ session }: any) => !!session)
	.handler(async (ctx: any) => {
		const app = ctx.app;

		if (!app.search) {
			throw new Error("Search service not configured");
		}

		const input = ctx.input;
		const db = ctx.db ?? app.db;
		const session = ctx.session;
		const locale = input.locale ?? ctx.locale;

		// Build access filters for each collection
		const allCollections = app.getCollections();
		const requestedCollections: string[] =
			input.collections ?? Object.keys(allCollections);
		const accessFilters: CollectionAccessFilter[] = [];
		const accessibleCollections: string[] = [];

		for (const collectionName of requestedCollections) {
			const collection =
				allCollections[collectionName as keyof typeof allCollections];
			if (!collection) continue;

			// Check read access for this collection (falls back to defaultAccess)
			const accessRule =
				(collection as any).state?.access?.read ?? app.defaultAccess?.read;
			const accessWhere = await executeAccessRule(accessRule, {
				app,
				db,
				session,
				locale,
			});

			// Skip collections with no access
			if (accessWhere === false) continue;

			// Build access filter for this collection
			accessFilters.push({
				collection: collectionName,
				table: (collection as any).table,
				accessWhere,
				softDelete: (collection as any).state?.options?.softDelete ?? false,
			});
			accessibleCollections.push(collectionName);
		}

		// If no collections are accessible, return empty results
		if (accessibleCollections.length === 0) {
			return {
				docs: [],
				total: 0,
				facets: [],
			} satisfies PopulatedSearchResponse;
		}

		// Execute search with access filtering
		const searchResults = await app.search.search({
			query: input.query || "",
			collections: accessibleCollections,
			locale,
			limit: input.limit ?? 10,
			offset: input.offset ?? 0,
			filters: input.filters,
			highlights: input.highlights ?? true,
			facets: input.facets,
			mode: input.mode,
			accessFilters,
		});

		// If no results, return early
		if (searchResults.results.length === 0) {
			return {
				docs: [],
				total: searchResults.total,
				facets: searchResults.facets,
			} satisfies PopulatedSearchResponse;
		}

		// Build search metadata map for merging with CRUD results
		const searchMetaMap = new Map<string, SearchMeta>();
		for (const result of searchResults.results) {
			const key = `${result.collection}:${result.recordId}`;
			searchMetaMap.set(key, {
				score: result.score,
				highlights: result.highlights,
				indexedTitle: result.title,
				indexedContent: result.content,
			});
		}

		// Group search results by collection
		const idsByCollection = new Map<string, string[]>();
		for (const result of searchResults.results) {
			const ids = idsByCollection.get(result.collection) ?? [];
			ids.push(result.recordId);
			idsByCollection.set(result.collection, ids);
		}

		// Populate full records via CRUD (this runs hooks!)
		const populatedDocs: any[] = [];
		const crudContext = { session, locale, db };

		for (const [collectionName, ids] of idsByCollection) {
			const collection =
				allCollections[collectionName as keyof typeof allCollections];
			if (!collection) continue;

			const crud = (collection as any).generateCRUD?.(db, app);
			if (!crud) continue;

			try {
				const crudResult = await crud.find(
					{ where: { id: { in: ids } }, limit: ids.length },
					crudContext,
				);

				// Merge search metadata with CRUD results
				for (const doc of crudResult.docs) {
					const key = `${collectionName}:${doc.id}`;
					const searchMeta = searchMetaMap.get(key);
					if (searchMeta) {
						populatedDocs.push({
							...doc,
							_collection: collectionName,
							_search: searchMeta,
						});
					}
				}
			} catch (err) {
				// Log but continue - don't fail entire search if one collection errors
				ctx.logger?.error(
					`[Search] Failed to populate ${collectionName}:`,
					err,
				);
			}
		}

		// Re-sort by search score to maintain relevance order
		populatedDocs.sort(
			(a: any, b: any) => (b._search?.score ?? 0) - (a._search?.score ?? 0),
		);

		return {
			docs: populatedDocs,
			total: searchResults.total,
			facets: searchResults.facets,
		} satisfies PopulatedSearchResponse;
	});
