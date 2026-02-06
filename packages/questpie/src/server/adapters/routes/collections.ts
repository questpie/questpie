/**
 * Collections Routes
 *
 * Collection CRUD route handlers.
 */

import { introspectCollection } from "../../collection/introspection.js";
import type { Questpie } from "../../config/cms.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { parseFindOneOptions, parseFindOptions } from "../utils/parsers.js";
import { parseRpcBody } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

export const createCollectionRoutes = <
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
    find: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const options = parseFindOptions(new URL(request.url));
        const result = await crud.find(options, resolved.cmsContext);
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    count: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const options = parseFindOptions(new URL(request.url));
        const result = await crud.count(
          { where: options.where, includeDeleted: options.includeDeleted },
          resolved.cmsContext,
        );
        return smartResponse({ count: result }, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    create: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
      input?: unknown,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      const body = input !== undefined ? input : await parseRpcBody(request);
      if (body === null) {
        return errorResponse(
          ApiError.badRequest("Invalid JSON body"),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const result = await crud.create(body, resolved.cmsContext);
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    findOne: async (
      request: Request,
      params: { collection: string; id: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const options = parseFindOneOptions(new URL(request.url), params.id);
        const result = await crud.findOne(options, resolved.cmsContext);
        if (!result) {
          return errorResponse(
            ApiError.notFound("Record", params.id),
            request,
            resolved.cmsContext.locale,
          );
        }
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    update: async (
      request: Request,
      params: { collection: string; id: string },
      context?: AdapterContext,
      input?: unknown,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      const body = input !== undefined ? input : await parseRpcBody(request);
      if (body === null) {
        return errorResponse(
          ApiError.badRequest("Invalid JSON body"),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const result = await crud.updateById(
          { id: params.id as any, data: body },
          resolved.cmsContext,
        );
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    remove: async (
      request: Request,
      params: { collection: string; id: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        await crud.deleteById({ id: params.id as any }, resolved.cmsContext);
        return smartResponse({ success: true }, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    restore: async (
      request: Request,
      params: { collection: string; id: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const result = await crud.restoreById(
          { id: params.id as any },
          resolved.cmsContext,
        );
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    updateMany: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
      input?: unknown,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      const body = input !== undefined ? input : await parseRpcBody(request);
      if (body === null || typeof body !== "object") {
        return errorResponse(
          ApiError.badRequest("Invalid JSON body"),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const { where, data } = body as { where: any; data: any };
        const result = await crud.update({ where, data }, resolved.cmsContext);
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    deleteMany: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
      input?: unknown,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);
      const crud = cms.api.collections[params.collection as any];

      if (!crud) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      const body = input !== undefined ? input : await parseRpcBody(request);
      if (body === null || typeof body !== "object") {
        return errorResponse(
          ApiError.badRequest("Invalid JSON body"),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const { where } = body as { where: any };
        const result = await crud.delete({ where }, resolved.cmsContext);
        return smartResponse(result, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    meta: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);

      // Get collection config directly (not CRUD)
      const collection = cms.getCollections()[params.collection as any];

      if (!collection) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        const meta = collection.getMeta();
        return smartResponse(meta, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },

    schema: async (
      request: Request,
      params: { collection: string },
      context?: AdapterContext,
    ): Promise<Response> => {
      const resolved = await resolveContext(cms, request, config, context);

      // Get collection config directly (not CRUD)
      const collection = cms.getCollections()[params.collection as any];

      if (!collection) {
        return errorResponse(
          ApiError.notFound("Collection", params.collection),
          request,
          resolved.cmsContext.locale,
        );
      }

      try {
        // Introspect collection with access control evaluation
        const schema = await introspectCollection(
          collection,
          {
            session: resolved.cmsContext.session,
            db: cms.db,
            locale: resolved.cmsContext.locale,
          },
          cms,
        );
        return smartResponse(schema, request);
      } catch (error) {
        return errorResponse(error, request, resolved.cmsContext.locale);
      }
    },
  };
};
