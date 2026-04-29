/**
 * Search Routes
 *
 * Search API route handlers for FTS-powered search across collections.
 *
 * Features:
 * - Access control filtering via SQL JOINs (accurate pagination)
 * - Populates full records via CRUD (hooks run)
 * - Returns search metadata (score, highlights, indexed title) with records
 */

import { executeAccessRule } from "../../collection/crud/shared/access-control.js";
import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import type {
	CollectionAccessFilter,
	PopulatedSearchResponse,
	SearchMeta,
} from "../../modules/core/integrated/search/types.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { parseRouteBody } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

// ============================================================================
// Helper
// ============================================================================

async function canReindexCollection(
	app: Questpie<any>,
	config: AdapterConfig,
	params: {
		request: Request;
		collectionName: string;
		collection: unknown;
		session?: { user: any; session: any } | null;
		db: unknown;
		locale?: string;
	},
): Promise<boolean> {
	const customAccess = config.search?.reindexAccess;

	if (typeof customAccess === "boolean") {
		return customAccess;
	}

	if (typeof customAccess === "function") {
		try {
			return await customAccess({
				request: params.request,
				app,
				session: params.session,
				db: params.db,
				locale: params.locale,
				collection: params.collectionName,
			});
		} catch {
			return false;
		}
	}

	// Default policy: derive from collection update access rule.
	// If update access is denied, reindex is denied.
	const updateAccessRule =
		(params.collection as any)?.state?.access?.update ??
		app.defaultAccess?.update;
	const updateAccessResult = await executeAccessRule(updateAccessRule, {
		app,
		db: params.db,
		session: params.session,
		locale: params.locale,
	});

	return updateAccessResult !== false;
}

// ============================================================================
// Standalone Handlers
// ============================================================================

/**
 * Search across collections.
 * POST /search
 *
 * Features:
 * - Respects collection-level access controls via SQL JOINs
 * - Populates full records via CRUD (hooks run)
 * - Returns search metadata merged with records
 */
export async function searchSearch(
	app: Questpie<any>,
	request: Request,
	_params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const errorResponse = (
		error: unknown,
		req: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request: req, app, locale });
	};

	const resolved = await resolveContext(app, request, config, context);

	// Check if search service is available
	if (!app.search) {
		return errorResponse(
			new ApiError({
				code: "NOT_FOUND",
				message: "Search service not configured",
				messageKey: "search.serviceNotConfigured",
			}),
			request,
			resolved.appContext.locale,
		);
	}

	const body = await parseRouteBody(request);
	if (body === null) {
		return errorResponse(
			ApiError.badRequest(
				"Invalid JSON body",
				undefined,
				"error.invalidJsonBody",
			),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		// Build access filters for each collection
		const allCollections = app.getCollections();
		const requestedCollections: string[] =
			body.collections ?? Object.keys(allCollections);
		const accessFilters: CollectionAccessFilter[] = [];
		const accessibleCollections: string[] = [];

		for (const collectionName of requestedCollections) {
			const collection = allCollections[collectionName as any];
			if (!collection) continue;

			// Check read access for this collection (falls back to defaultAccess)
			const accessRule =
				(collection as any).state?.access?.read ?? app.defaultAccess?.read;
			const accessWhere = await executeAccessRule(accessRule, {
				app,
				db: resolved.appContext.db ?? app.db,
				session: resolved.appContext.session,
				locale: resolved.appContext.locale,
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
			return smartResponse(
				{
					docs: [],
					total: 0,
					facets: [],
				} satisfies PopulatedSearchResponse,
				request,
			);
		}

		// Execute search with access filtering
		const searchResults = await app.search.search({
			query: body.query || "",
			collections: accessibleCollections,
			locale: body.locale ?? resolved.appContext.locale,
			limit: body.limit ?? 10,
			offset: body.offset ?? 0,
			filters: body.filters,
			highlights: body.highlights ?? true,
			facets: body.facets,
			mode: body.mode,
			accessFilters,
		});

		// If no results, return early
		if (searchResults.results.length === 0) {
			return smartResponse(
				{
					docs: [],
					total: searchResults.total,
					facets: searchResults.facets,
				} satisfies PopulatedSearchResponse,
				request,
			);
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
		const crudContext = {
			session: resolved.appContext.session,
			locale: resolved.appContext.locale,
			db: resolved.appContext.db ?? app.db,
		};

		for (const [collectionName, ids] of idsByCollection) {
			const collection = allCollections[collectionName as any];
			if (!collection) continue;

			// Generate CRUD for this collection
			const crud = (collection as any).generateCRUD?.(
				resolved.appContext.db ?? app.db,
				app,
			);
			if (!crud) continue;

			try {
				const crudResult = await crud.find(
					{
						where: { id: { in: ids } },
						limit: ids.length,
					},
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
				(resolved.appContext as any).logger?.error(
					`[Search] Failed to populate ${collectionName}:`,
					err,
				);
			}
		}

		// Re-sort by search score to maintain relevance order
		populatedDocs.sort(
			(a, b) => (b._search?.score ?? 0) - (a._search?.score ?? 0),
		);

		return smartResponse(
			{
				docs: populatedDocs,
				total: searchResults.total,
				facets: searchResults.facets,
			} satisfies PopulatedSearchResponse,
			request,
		);
	} catch (error) {
		return errorResponse(error, request, resolved.appContext.locale);
	}
}

/**
 * Reindex a collection.
 * POST /search/reindex/:collection
 *
 * PROTECTED: Requires authentication and reindex access policy.
 */
export async function searchReindex(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const errorResponse = (
		error: unknown,
		req: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request: req, app, locale });
	};

	const resolved = await resolveContext(app, request, config, context);
	const collectionName = params.collection;

	// SECURITY: Require authentication
	if (!resolved.appContext.session) {
		return errorResponse(
			ApiError.unauthorized("Authentication required"),
			request,
			resolved.appContext.locale,
		);
	}

	// Check if search service is available
	if (!app.search) {
		return errorResponse(
			new ApiError({
				code: "NOT_FOUND",
				message: "Search service not configured",
				messageKey: "search.serviceNotConfigured",
			}),
			request,
			resolved.appContext.locale,
		);
	}

	// Check if collection exists
	const collection = app.getCollections()[collectionName as any];
	if (!collection) {
		return errorResponse(
			ApiError.notFound("Collection", collectionName),
			request,
			resolved.appContext.locale,
		);
	}

	const db = resolved.appContext.db ?? app.db;
	const hasReindexAccess = await canReindexCollection(app, config, {
		request,
		collectionName,
		collection,
		session: resolved.appContext.session,
		db,
		locale: resolved.appContext.locale,
	});

	if (!hasReindexAccess) {
		return errorResponse(
			new ApiError({
				code: "FORBIDDEN",
				message: "Reindex access denied by policy",
				messageKey: "search.reindexAccessDenied",
				context: {
					access: {
						operation: "update",
						resource: `search/reindex/${collectionName}`,
						reason: "Reindex access denied by policy",
					},
				},
			}),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		await app.search.reindex(collectionName);
		return smartResponse(
			{ success: true, collection: collectionName },
			request,
		);
	} catch (error) {
		return errorResponse(error, request, resolved.appContext.locale);
	}
}

// ============================================================================
// Legacy closure factory (deprecated)
// ============================================================================

/**
 * @deprecated Use standalone `searchSearch` and `searchReindex` instead.
 */
export const createSearchRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
) => {
	return {
		search: async (
			request: Request,
			_params: Record<string, never>,
			context?: AdapterContext,
		): Promise<Response> => {
			return searchSearch(app, request, _params, context, config);
		},

		reindex: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return searchReindex(app, request, params, context, config);
		},
	};
};
