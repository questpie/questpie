/**
 * Collections Routes
 *
 * Collection CRUD route handlers.
 */

import { parseRfc3339Instant } from "#questpie/shared/temporal.js";
import { getTxid, QUESTPIE_TXID_HEADER } from "#questpie/shared/txid.js";

import {
	introspectCollection,
	resolveIntrospectionAccess,
} from "../../collection/introspection.js";
import type { Questpie } from "../../config/questpie.js";
import { ApiError } from "../../errors/index.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import { parseFindOneOptions, parseFindOptions } from "../utils/parsers.js";
import { parseRouteBody } from "../utils/request.js";
import {
	handleError,
	introspectionDeniedError,
	smartResponse,
} from "../utils/response.js";

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

function txidHeaders(result: unknown): HeadersInit | undefined {
	const txid = getTxid(result);
	return txid ? { [QUESTPIE_TXID_HEADER]: txid } : undefined;
}

// ============================================================================
// Standalone Handlers
// ============================================================================

export async function collectionFind(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
	config: AdapterConfig<any> = {},
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
	config: AdapterConfig<any> = {},
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
		const result = await crud.create(body, resolved.appContext);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionFindOne(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
	config: AdapterConfig<any> = {},
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
		const result = await crud.updateById(
			{ id: params.id as any, data: body },
			resolved.appContext,
		);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionRemove(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const result = await crud.deleteById(
			{ id: params.id as any },
			resolved.appContext,
		);
		return smartResponse({ success: true }, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionVersions(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
			offsetRaw !== null && offsetRaw !== "" ? Number(offsetRaw) : undefined;

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
	config: AdapterConfig<any> = {},
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
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionTransition(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const payload = body as { stage?: unknown; scheduledAt?: unknown };
		if (!payload.stage || typeof payload.stage !== "string") {
			throw ApiError.badRequest(
				"Missing required field: stage",
				undefined,
				"error.missingRequiredField",
				{ field: "stage" },
			);
		}

		const opts: { id: string; stage: string; scheduledAt?: Date } = {
			id: params.id,
			stage: payload.stage,
		};

		if (payload.scheduledAt !== undefined) {
			const date = parseRfc3339Instant(payload.scheduledAt);
			if (!date) {
				throw ApiError.badRequest(
					"Invalid scheduledAt date",
					undefined,
					"error.invalidDateField",
					{ field: "scheduledAt" },
				);
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
	config: AdapterConfig<any> = {},
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
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionPurge(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const result = await crud.purgeById(
			{ id: params.id as any },
			resolved.appContext,
		);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionUpdateMany(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const { where, data } = body as { where: any; data: any };
		const result = await crud.updateMany({ where, data }, resolved.appContext);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionUpdateBatch(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const { updates } = body as { updates: Array<{ id: any; data: any }> };
		const result = await crud.updateBatch({ updates }, resolved.appContext);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionDeleteMany(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const { where } = body as { where: any };
		const result = await crud.deleteMany({ where }, resolved.appContext);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function collectionAudit(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
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
		const limit = limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : 50;
		const offset =
			offsetRaw !== null && offsetRaw !== "" ? Number(offsetRaw) : undefined;

		// Audit collection name is configurable; defaults to admin_audit_log for backwards compat
		const auditCollectionName =
			(app.config as any).auditCollection ?? "admin_audit_log";
		const auditCrud = app.collections[auditCollectionName as any] as any;
		if (!auditCrud) {
			return smartResponse([], request);
		}

		const record = await crud.findOne(
			{
				where: { id: params.id as any },
				includeDeleted: true,
			},
			resolved.appContext,
		);
		if (!record) {
			return errorResponse(
				app,
				ApiError.notFound("Record", params.id),
				request,
				resolved.appContext.locale,
			);
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
			resolved.appContext,
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
	config: AdapterConfig<any> = {},
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
		// Gate through the access system: introspect rule, falling back to
		// "visible iff any CRUD operation is allowed for the current user".
		const visible = await resolveIntrospectionAccess(
			collection.state,
			{
				session: resolved.appContext.session,
				db: app.db,
				locale: resolved.appContext.locale,
			},
			app,
		);
		if (!visible) {
			throw introspectionDeniedError(
				params.collection,
				resolved.appContext.session,
			);
		}

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
	config: AdapterConfig<any> = {},
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
		// Gate through the already-computed access info: introspect rule,
		// falling back to "visible iff any CRUD operation is allowed".
		if (!schema.access.visible) {
			throw introspectionDeniedError(
				params.collection,
				resolved.appContext.session,
			);
		}
		return smartResponse(schema, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}
