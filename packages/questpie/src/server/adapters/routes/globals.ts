/**
 * Globals Routes
 *
 * Global settings route handlers.
 */

import type { Questpie } from "../../config/cms.js";
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
}

export const createGlobalRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	cms: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
): GlobalRoutes => {
	const errorResponse = (
		error: unknown,
		request: Request,
		locale?: string,
	): Response => {
		return handleError(error, { request, cms, locale });
	};

	return {
		get: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(cms, request, config, context);

			try {
				const options = parseGlobalGetOptions(new URL(request.url));
				const globalInstance = cms.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.cmsContext.db, cms);
				const result = await crud.get(options, resolved.cmsContext);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.cmsContext.locale);
			}
		},

		schema: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(cms, request, config, context);
			const globalInstance = cms.getGlobalConfig(params.global as any);

			if (!globalInstance) {
				return errorResponse(
					ApiError.notFound("Global", params.global),
					request,
					resolved.cmsContext.locale,
				);
			}

			try {
				const schema = await introspectGlobal(
					globalInstance,
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

		update: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			const resolved = await resolveContext(cms, request, config, context);
			const body = input !== undefined ? input : await parseRpcBody(request);
			if (body === null) {
				return errorResponse(
					ApiError.badRequest("Invalid JSON body"),
					request,
					resolved.cmsContext.locale,
				);
			}

			try {
				const options = parseGlobalUpdateOptions(new URL(request.url));
				const globalInstance = cms.getGlobalConfig(params.global as any);
				const crud = globalInstance.generateCRUD(resolved.cmsContext.db, cms);
				const result = await crud.update(body, resolved.cmsContext, options);
				return smartResponse(result, request);
			} catch (error) {
				return errorResponse(error, request, resolved.cmsContext.locale);
			}
		},

		meta: async (
			request: Request,
			params: { global: string },
			context?: AdapterContext,
		): Promise<Response> => {
			const resolved = await resolveContext(cms, request, config, context);
			const globalInstance = cms.getGlobalConfig(params.global as any);

			if (!globalInstance) {
				return errorResponse(
					ApiError.notFound("Global", params.global),
					request,
					resolved.cmsContext.locale,
				);
			}

			try {
				const meta = globalInstance.getMeta();
				return smartResponse(meta, request);
			} catch (error) {
				return errorResponse(error, request, resolved.cmsContext.locale);
			}
		},
	};
};
