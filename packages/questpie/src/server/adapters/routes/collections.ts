/**
 * Collections Routes
 *
 * Collection CRUD route handlers.
 */

import { introspectCollection } from "../../collection/introspection.js";
import type { Questpie } from "../../config/questpie.js";
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
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
) => {
	const errorResponse = (
		error: unknown,
		request: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request, app, locale });
	};

	return {
		find: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const options = parseFindOptions(new URL(request.url));
				const result = await crud.find(options, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		count: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const options = parseFindOptions(new URL(request.url));
				const result = await crud.count(
					{ where: options.where, includeDeleted: options.includeDeleted },
					resolved.appContext,
				);
				return smartResponse({ count: result }, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		create: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null) {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const result = await crud.create(body, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		findOne: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const options = parseFindOneOptions(new URL(request.url), params.id);
				const result = await crud.findOne(options, resolved.appContext);
				if (!result) {
					return errorResponse(
						ApiError.notFound("Record", params.id),
						request,
						resolved.appContext.locale,
					);
				}
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		update: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null) {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const result = await crud.updateById(
					{ id: params.id as any, data: body },
					resolved.appContext,
				);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		remove: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				await crud.deleteById({ id: params.id as any }, resolved.appContext);
				return smartResponse({ success: true }, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		versions: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const url = new URL(request.url);
				const limitRaw = url.searchParams.get("limit");
				const offsetRaw = url.searchParams.get("offset");
				const limit =
					limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : undefined;
				const offset =
					offsetRaw !== null && offsetRaw !== ""
						? Number(offsetRaw)
						: undefined;

				const result = await crud.findVersions(
					{
						id: params.id as any,
						...(Number.isFinite(limit) && limit !== undefined
							? { limit: Math.floor(limit) }
							: {}),
						...(Number.isFinite(offset) && offset !== undefined
							? { offset: Math.floor(offset) }
							: {}),
					},
					resolved.appContext,
				);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		revert: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null || typeof body !== "object") {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const payload = body as { version?: number; versionId?: string };
				const result = await crud.revertToVersion(
					{
						id: params.id as any,
						...(typeof payload.version === "number"
							? { version: payload.version }
							: {}),
						...(typeof payload.versionId === "string"
							? { versionId: payload.versionId }
							: {}),
					},
					resolved.appContext,
				);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		transition: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null || typeof body !== "object") {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const payload = body as { stage: string; scheduledAt?: string };
				if (!payload.stage || typeof payload.stage !== "string") {
					throw ApiError.badRequest("Missing required field: stage");
				}

				const opts: { id: any; stage: string; scheduledAt?: Date } = {
					id: params.id as any,
					stage: payload.stage,
				};

				if (payload.scheduledAt) {
					const date = new Date(payload.scheduledAt);
					if (Number.isNaN(date.getTime())) {
						throw ApiError.badRequest("Invalid scheduledAt date");
					}
					opts.scheduledAt = date;
				}

				const result = await crud.transitionStage(opts, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		restore: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const result = await crud.restoreById(
					{ id: params.id as any },
					resolved.appContext,
				);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		updateMany: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null || typeof body !== "object") {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const { where, data } = body as { where: any; data: any };
				const result = await crud.update({ where, data }, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		deleteMany: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null || typeof body !== "object") {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const { where } = body as { where: any };
				const result = await crud.delete({ where }, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		audit: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const crud = app.api.collections[params.collection as any];

			if (!crud) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const url = new URL(request.url);
				const limitRaw = url.searchParams.get("limit");
				const offsetRaw = url.searchParams.get("offset");
				const limit =
					limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : 50;
				const offset =
					offsetRaw !== null && offsetRaw !== ""
						? Number(offsetRaw)
						: undefined;

				const auditCrud = app.api.collections["adminAuditLog" as any] as any;
				if (!auditCrud) {
					return smartResponse([], request);
				}

				const result = await auditCrud.find(
					{
						where: {
							resource: params.collection,
							resourceId: params.id,
						},
						sort: { createdAt: "desc" },
						...(Number.isFinite(limit) ? { limit: Math.floor(limit) } : {}),
						...(Number.isFinite(offset) && offset !== undefined
							? { offset: Math.floor(offset) }
							: {}),
					},
					{ ...resolved.appContext, accessMode: "system" },
				);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		meta: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);

			// Get collection config directly (not CRUD)
			const collection = app.getCollections()[params.collection as any];

			if (!collection) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const meta = collection.getMeta();
				return smartResponse(meta, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		schema: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);

			// Get collection config directly (not CRUD)
			const collection = app.getCollections()[params.collection as any];

			if (!collection) {
				return errorResponse(
					ApiError.notFound("Collection", params.collection),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				// Introspect collection with access control evaluation
				const schema = await introspectCollection(
					collection,
					{
						session: resolved.appContext.session,
						db: app.db,
						locale: resolved.appContext.locale,
					},
					app,
				);
				return smartResponse(schema, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},
	};
};
