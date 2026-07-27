/**
 * Search Routes
 *
 * Search API route handlers for FTS-powered search across collections.
 *
 * Features:
 * - Access control filtering via SQL JOINs (accurate pagination)
 * - Populates full records via CRUD (hooks run)
 * - Returns only field-access-safe hydrated records plus relevance scores
 */

import { executeAccessRule } from "../../collection/crud/shared/access-control.js";
import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { isSearchableConfigEnabled } from "../../modules/core/integrated/search/index-params.js";
import { reindexCollection } from "../../modules/core/integrated/search/reindex.js";
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
		contextExtensions?: Record<string, unknown>;
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
		contextExtensions: params.contextExtensions,
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
		const allCollections = app.getCollections();
		const requestedCollections: string[] =
			body.collections ?? Object.keys(allCollections);
		const searchLocale = body.locale ?? resolved.appContext.locale;
		const db = resolved.appContext.db ?? app.db;
		const accessContext = {
			session: resolved.appContext.session,
			principal: resolved.appContext.principal,
			actor: resolved.appContext.actor,
			locale: searchLocale,
			defaultLocale: resolved.appContext.defaultLocale,
			localeFallback: resolved.appContext.localeFallback,
			accessMode: resolved.appContext.accessMode,
			stage: resolved.appContext.stage,
			db,
			"~contextExtensions": resolved.appContext["~contextExtensions"],
		};
		const accessFilters: CollectionAccessFilter[] = [];
		const accessibleCollections: string[] = [];

		for (const collectionName of requestedCollections) {
			const collection = allCollections[collectionName as any];
			if (!collection) continue;
			const state = (collection as any).state;
			if (!isSearchableConfigEnabled(state?.searchable)) continue;

			// Check read access for this collection (falls back to defaultAccess)
			const accessRule = state?.access?.read ?? app.defaultAccess?.read;
			const accessWhere = await executeAccessRule(accessRule, {
				app,
				db,
				session: resolved.appContext.session,
				principal: resolved.appContext.principal,
				actor: resolved.appContext.actor,
				locale: searchLocale,
				request,
				contextExtensions: resolved.appContext["~contextExtensions"],
			});

			// Skip collections with no access
			if (accessWhere === false) continue;

			const crud = (collection as any).generateCRUD?.(db, app);
			accessFilters.push({
				collection: collectionName,
				table: (collection as any).table,
				accessWhere,
				softDelete: state?.options?.softDelete ?? false,
				state,
				i18nTable: crud?.["~internalI18nTable"] ?? null,
				context: accessContext,
				app,
				db,
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
			locale: searchLocale,
			limit: body.limit ?? 10,
			offset: body.offset ?? 0,
			filters: body.filters,
			// The hydrated HTTP response must not expose index snapshots because
			// they can contain values removed by CRUD field access.
			highlights: false,
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
			});
		}

		// Group search results by collection
		const idsByCollection = new Map<string, string[]>();
		for (const result of searchResults.results) {
			const ids = idsByCollection.get(result.collection) ?? [];
			ids.push(result.recordId);
			idsByCollection.set(result.collection, ids);
		}

		// Populate full records via CRUD (this runs hooks). Hydration is
		// fail-closed: one missing or rejected candidate invalidates the response
		// instead of returning docs whose cardinality disagrees with total/facets.
		const populatedByKey = new Map<string, any>();
		const crudContext = {
			session: resolved.appContext.session,
			principal: resolved.appContext.principal,
			actor: resolved.appContext.actor,
			locale: searchLocale,
			defaultLocale: resolved.appContext.defaultLocale,
			localeFallback: resolved.appContext.localeFallback,
			accessMode: resolved.appContext.accessMode,
			stage: resolved.appContext.stage,
			db,
			request,
			"~contextExtensions": resolved.appContext["~contextExtensions"],
		};

		for (const [collectionName, ids] of idsByCollection) {
			const collection = allCollections[collectionName as any];
			if (!collection) {
				throw new Error(
					`Search adapter returned unknown collection "${collectionName}"`,
				);
			}

			// Generate CRUD for this collection
			const crud = (collection as any).generateCRUD?.(db, app);
			if (!crud) {
				throw new Error(
					`Search collection "${collectionName}" has no CRUD hydrator`,
				);
			}

			const crudResult = await crud.find(
				{
					where: { id: { in: ids } },
					limit: ids.length,
				},
				crudContext,
			);

			for (const doc of crudResult.docs) {
				populatedByKey.set(`${collectionName}:${doc.id}`, doc);
			}
		}

		const populatedDocs = searchResults.results.map((result) => {
			const key = `${result.collection}:${result.recordId}`;
			const doc = populatedByKey.get(key);
			const searchMeta = searchMetaMap.get(key);
			if (!doc || !searchMeta) {
				throw new Error(`Search hydration rejected candidate "${key}"`);
			}
			return {
				...doc,
				_collection: result.collection,
				_search: searchMeta,
			};
		});

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
		contextExtensions: resolved.appContext["~contextExtensions"],
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
		// App-layer reindex: iterate the collection's records and (re)build the
		// index. `SearchAdapter.reindex()` can't do this — it has no CRUD access.
		const result = await reindexCollection(app, collectionName);
		return smartResponse(
			{ success: true, collection: collectionName, indexed: result.indexed },
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
