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
import type { Questpie } from "../../config/cms.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import type {
  CollectionAccessFilter,
  PopulatedSearchResponse,
  SearchMeta,
} from "../../integrated/search/types.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { parseRpcBody } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

export const createSearchRoutes = <
  TConfig extends QuestpieConfig = QuestpieConfig,
>(
  cms: Questpie<TConfig>,
  config: AdapterConfig<TConfig> = {},
) => {
  const errorResponse = (
    error: unknown,
    request: Request,
    locale?: string,
  ): Response => {
    return handleError(error, { request, cms, locale });
  };

  return {
    /**
     * Search across collections
     * POST /cms/search
     *
     * Features:
     * - Respects collection-level access controls via SQL JOINs
     * - Populates full records via CRUD (hooks run)
     * - Returns search metadata merged with records
     *
     * Request body:
     * {
     *   query: string;
     *   collections?: string[];
     *   locale?: string;
     *   limit?: number;
     *   offset?: number;
     *   filters?: Record<string, string | string[]>;
     *   highlights?: boolean;
     *   facets?: FacetDefinition[];
     * }
     *
     * Response:
     * {
     *   docs: [{ ...fullRecord, _search: { score, highlights, indexedTitle } }],
     *   total: number,
     *   facets?: FacetResult[]
     * }
     */
    search: async (
      request: Request,
      _params: Record<string, never>,
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);

      // Check if search service is available
      if (!cms.search) {
        return errorResponse(
          ApiError.notFound("Search", "Search service not configured"),
          request,
          resolved.cmsContext.locale,
        );
      }

      const body = await parseRpcBody(request);
      if (body === null) {
        return errorResponse(
          ApiError.badRequest("Invalid JSON body"),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        // Build access filters for each collection
        const allCollections = cms.getCollections();
        const requestedCollections: string[] =
          body.collections ?? Object.keys(allCollections);
        const accessFilters: CollectionAccessFilter[] = [];
        const accessibleCollections: string[] = [];

        for (const collectionName of requestedCollections) {
          const collection =
            allCollections[collectionName as keyof typeof allCollections];
          if (!collection) continue;

          // Check read access for this collection
          const accessRule = (collection as any).state?.access?.read;
          const accessWhere = await executeAccessRule(accessRule, {
            cms,
            db: resolved.cmsContext.db ?? cms.db,
            session: resolved.cmsContext.session,
            locale: resolved.cmsContext.locale,
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
        const searchResults = await cms.search.search({
          query: body.query || "",
          collections: accessibleCollections,
          locale: body.locale ?? resolved.cmsContext.locale,
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
          session: resolved.cmsContext.session,
          locale: resolved.cmsContext.locale,
          db: resolved.cmsContext.db ?? cms.db,
        };

        for (const [collectionName, ids] of idsByCollection) {
          const collection =
            allCollections[collectionName as keyof typeof allCollections];
          if (!collection) continue;

          // Generate CRUD for this collection
          const crud = (collection as any).generateCRUD?.(
            resolved.cmsContext.db ?? cms.db,
            cms,
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
            console.error(
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
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    /**
     * Reindex a collection
     * POST /cms/search/reindex/:collection
     *
     * PROTECTED: Requires authentication and admin role.
     * This is a potentially expensive operation that rebuilds the search index.
     */
    reindex: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);

      // SECURITY: Require authentication
      if (!resolved.cmsContext.session) {
        return errorResponse(
          ApiError.unauthorized("Authentication required"),
          request,
          resolved.cmsContext.locale,
        );
      }

      // SECURITY: Require admin role
      const user = resolved.cmsContext.session.user as
        | { role?: string }
        | undefined;
      if (user?.role !== "admin") {
        return errorResponse(
          ApiError.forbidden({
            operation: "update",
            resource: `search/reindex/${params.collection}`,
            reason: "Admin role required for reindexing",
            requiredRole: "admin",
            userRole: user?.role,
          }),
          request,
          resolved.cmsContext.locale,
        );
      }

      // Check if search service is available
      if (!cms.search) {
        return errorResponse(
          ApiError.notFound("Search", "Search service not configured"),
          request,
          resolved.cmsContext.locale,
        );
      }

      // Check if collection exists
      const collection = cms.getCollections()[params.collection as any];
      if (!collection) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        await cms.search.reindex(params.collection);
        return smartResponse(
          { success: true, collection: params.collection },
          request,
        );
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },
  };
};
