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
import { parseRouteBody } from "../utils/request.js";
import { handleError, smartResponse } from "../utils/response.js";

// ============================================================================
// Helper
// ============================================================================

function errorResponse(
	app: Questpie<any>,
	error: unknown,
	request: Request,
	locale?: string,
): Response {
	return handleError(error, { request, app, locale });
}

// ============================================================================
// Standalone Handlers
// ============================================================================

export async function collectionFind(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionCount(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionCreate(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	const body = input !== undefined ? input : await parseRouteBody(request);
	if (body === null) {
		return errorResponse(
			app,
			ApiError.badRequest("Invalid JSON body"),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		const result = await crud.create(body, resolved.appContext);
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionFindOne(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
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
				app,
				ApiError.notFound("Record", params.id),
				request,
				resolved.appContext.locale,
			);
		}
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionUpdate(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	const body = input !== undefined ? input : await parseRouteBody(request);
	if (body === null) {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionRemove(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		await crud.deleteById({ id: params.id as any }, resolved.appContext);
		return smartResponse({ success: true }, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionVersions(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionRevert(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	const body = input !== undefined ? input : await parseRouteBody(request);
	if (body === null || typeof body !== "object") {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionTransition(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	const body = input !== undefined ? input : await parseRouteBody(request);
	if (body === null || typeof body !== "object") {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionRestore(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionUpdateMany(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	const body = input !== undefined ? input : await parseRouteBody(request);
	if (body === null || typeof body !== "object") {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionDeleteMany(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	const body = input !== undefined ? input : await parseRouteBody(request);
	if (body === null || typeof body !== "object") {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionAudit(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const crud = app.collections[params.collection as any];

	if (!crud) {
		return errorResponse(
			app,
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

		// Audit collection name is configurable; defaults to admin_audit_log for backwards compat
		const auditCollectionName =
			(app.config as any).auditCollection ?? "admin_audit_log";
		const auditCrud = app.collections[
			auditCollectionName as any
		] as any;
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionMeta(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);

	// Get collection config directly (not CRUD)
	const collection = app.getCollections()[params.collection as any];

	if (!collection) {
		return errorResponse(
			app,
			ApiError.notFound("Collection", params.collection),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		const meta = collection.getMeta();
		return smartResponse(meta, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionSchema(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);

	// Get collection config directly (not CRUD)
	const collection = app.getCollections()[params.collection as any];

	if (!collection) {
		return errorResponse(
			app,
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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

// ============================================================================
// Legacy closure factory (deprecated)
// ============================================================================

/**
 * @deprecated Use standalone handler functions instead.
 */
export const createCollectionRoutes = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	config: AdapterConfig<TConfig> = {},
) => {
	return {
		find: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionFind(app, request, params, context, config);
		},

		count: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionCount(app, request, params, context, config);
		},

		create: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			return collectionCreate(app, request, params, context, config, input);
		},

		findOne: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionFindOne(app, request, params, context, config);
		},

		update: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			return collectionUpdate(app, request, params, context, config, input);
		},

		remove: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionRemove(app, request, params, context, config);
		},

		versions: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionVersions(app, request, params, context, config);
		},

		revert: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			return collectionRevert(app, request, params, context, config, input);
		},

		transition: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			return collectionTransition(app, request, params, context, config, input);
		},

		restore: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionRestore(app, request, params, context, config);
		},

		updateMany: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			return collectionUpdateMany(app, request, params, context, config, input);
		},

		deleteMany: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
			input?: unknown,
		): Promise<Response> => {
			return collectionDeleteMany(app, request, params, context, config, input);
		},

		audit: async (
			request: Request,
			params: { collection: string; id: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionAudit(app, request, params, context, config);
		},

		meta: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionMeta(app, request, params, context, config);
		},

		schema: async (
			request: Request,
			params: { collection: string },
			context?: AdapterContext,
		): Promise<Response> => {
			return collectionSchema(app, request, params, context, config);
		},
	};
};
