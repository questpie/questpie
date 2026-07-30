/**
 * Globals Routes
 *
 * Global settings route handlers.
 */

import { parseRfc3339Instant } from "#questpie/shared/temporal.js";
import { getTxid, QUESTPIE_TXID_HEADER } from "#questpie/shared/txid.js";

import type { Questpie } from "../../config/questpie.js";
import { ApiError } from "../../errors/index.js";
import {
	introspectGlobal,
	resolveGlobalIntrospectionAccess,
} from "../../global/introspection.js";
import type { AdapterConfig, AdapterContext } from "../types.js";
import { resolveContext } from "../utils/context.js";
import {
	parseGlobalGetOptions,
	parseGlobalUpdateOptions,
} from "../utils/parsers.js";
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

export async function globalGet(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);

	try {
		const options = parseGlobalGetOptions(new URL(request.url));
		const globalInstance = app.getGlobalConfig(params.global as any);
		const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
		const result = await crud.get(options, resolved.appContext);
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalVersions(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);

	try {
		const url = new URL(request.url);
		const limitRaw = url.searchParams.get("limit");
		const offsetRaw = url.searchParams.get("offset");
		const id = url.searchParams.get("id") ?? undefined;
		const limit =
			limitRaw !== null && limitRaw !== "" ? Number(limitRaw) : undefined;
		const offset =
			offsetRaw !== null && offsetRaw !== "" ? Number(offsetRaw) : undefined;

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
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalRevert(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
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
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalTransition(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
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

		const opts: { stage: string; scheduledAt?: Date } = {
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

		const globalInstance = app.getGlobalConfig(params.global as any);
		const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
		const result = await crud.transitionStage(opts, resolved.appContext);
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalSchema(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const globalInstance = app.getGlobalConfig(params.global as any);

	if (!globalInstance) {
		return errorResponse(
			app,
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
		// Gate through the already-computed access info: introspect rule,
		// falling back to "visible iff any operation is allowed".
		if (!schema.access.visible) {
			throw introspectionDeniedError(
				params.global,
				resolved.appContext.session,
			);
		}
		return smartResponse(schema, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalUpdate(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
	input?: unknown,
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
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
		const options = parseGlobalUpdateOptions(new URL(request.url));
		const globalInstance = app.getGlobalConfig(params.global as any);
		const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
		const result = await crud.update(body, resolved.appContext, options);
		return smartResponse(result, request, 200, txidHeaders(result));
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalMeta(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);
	const globalInstance = app.getGlobalConfig(params.global as any);

	if (!globalInstance) {
		return errorResponse(
			app,
			ApiError.notFound("Global", params.global),
			request,
			resolved.appContext.locale,
		);
	}

	try {
		// Gate through the access system: introspect rule, falling back to
		// "visible iff any operation is allowed for the current user".
		const visible = await resolveGlobalIntrospectionAccess(
			globalInstance.state,
			{
				session: resolved.appContext.session,
				db: app.db,
				locale: resolved.appContext.locale,
			},
			app,
		);
		if (!visible) {
			throw introspectionDeniedError(
				params.global,
				resolved.appContext.session,
			);
		}

		const meta = globalInstance.getMeta();
		return smartResponse(meta, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}

export async function globalAudit(
	app: Questpie<any>,
	request: Request,
	params: Record<string, string>,
	context?: AdapterContext,
	config: AdapterConfig<any> = {},
): Promise<Response> {
	const resolved = await resolveContext(app, request, config, context);

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

		const globalInstance = app.getGlobalConfig(params.global as any);
		const crud = globalInstance.generateCRUD(resolved.appContext.db, app);
		await crud.get({}, resolved.appContext);

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
			resolved.appContext,
		);
		return smartResponse(result, request);
	} catch (error) {
		return errorResponse(app, error, request, resolved.appContext.locale);
	}
}
