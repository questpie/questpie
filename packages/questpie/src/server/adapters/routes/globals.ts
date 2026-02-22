/**
 * Globals Routes
 *
 * Global settings route handlers.
 */

import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { introspectGlobal } from "../../global/introspection.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import {
	parseGlobalGetOptions,
	parseGlobalUpdateOptions,
} from "../utils/parsers.js";
import { parseRpcBody } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

export interface GlobalRoutes {
	get: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
	) => Promise<Response>;
	versions: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
	) => Promise<Response>;
	revert: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
		input?: unknown,
	) => Promise<Response>;
	transition: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
		input?: unknown,
	) => Promise<Response>;
	schema: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
	) => Promise<Response>;
	update: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
		input?: unknown,
	) => Promise<Response>;
	meta: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
	) => Promise<Response>;
	audit: (
		request: Request,
		params: { global: string },
		context?: AdapterContext,
	) => Promise<Response>;
}

export const createGlobalRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
): GlobalRoutes => {
	const errorResponse = (
		error: unknown,
		request: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request, app, locale });
	};

	return {
		get: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);

			try {
				const options = parseGlobalGetOptions(new URL(request.url));
				const globalInstance = app.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
				const result = await crud.get(options, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		versions: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);

			try {
				const url = new URL(request.url);
				const limitRaw = url.searchParams.get("limit");
				const offsetRaw = url.searchParams.get("offset");
				const id = url.searchParams.get("id") ?? undefined;
				const limit =
					limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : undefined;
				const offset =
					offsetRaw !== null && offsetRaw !== ""
						? Number(offsetRaw)
						: undefined;

				const globalInstance = app.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
				const result = await crud.findVersions(
					{
						...(typeof id === "string" && id.length > 0 ? { id } : {}),
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
			params: { global: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const body = input !== undefined ? input : await parseRpcBody(request);

			if (body === null || typeof body !== "object") {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const payload = body as {
					id?: string;
					version?: number;
					versionId?: string;
				};
				const globalInstance = app.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
				const result = await crud.revertToVersion(
					{
						...(typeof payload.id === "string" ? { id: payload.id } : {}),
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
			params: { global: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
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

				const opts: { stage: string; scheduledAt?: Date } = {
					stage: payload.stage,
				};

				if (payload.scheduledAt) {
					const date = new Date(payload.scheduledAt);
					if (Number.isNaN(date.getTime())) {
						throw ApiError.badRequest("Invalid scheduledAt date");
					}
					opts.scheduledAt = date;
				}

				const globalInstance = app.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
				const result = await crud.transitionStage(opts, resolved.appContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		schema: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const globalInstance = app.getGlobalConfig(params.global as any);

			if (!globalInstance) {
				return errorResponse(
					ApiError.notFound("Global", params.global),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const schema = await introspectGlobal(
					globalInstance,
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

		update: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null) {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const options = parseGlobalUpdateOptions(new URL(request.url));
				const globalInstance = app.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
				const result = await crud.update(body, resolved.appContext, options);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		meta: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);
			const globalInstance = app.getGlobalConfig(params.global as any);

			if (!globalInstance) {
				return errorResponse(
					ApiError.notFound("Global", params.global),
					request,
					resolved.appContext.locale,
				);
			}

			try {
				const meta = globalInstance.getMeta();
				return smartResponse(meta, request);
			} catch (error) {
				return errorResponse(error, request, resolved.appContext.locale);
			}
		},

		audit: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(app, request, config, context);

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
							resource: params.global,
							resourceType: "global",
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
	};
};
