/**
 * Route Execution Engine
 *
 * Unified execution for JSON and raw routes with full context propagation.
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import { extractAppServices } from "#questpie/server/config/app-context.js";
import {
	type RequestContext,
	runWithContext,
} from "#questpie/server/config/context.js";
import { attachInternalAdapterContext } from "#questpie/server/config/internal-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { ApiError } from "#questpie/server/errors/index.js";

import type {
	JsonRouteDefinition,
	JsonRouteParams,
	RawRouteDefinition,
	RouteAccess,
	RouteAccessRule,
} from "./types.js";

type RouteAdapterContext = {
	session?: RequestContext["session"];
	locale?: string;
	localeFallback?: boolean;
	stage?: string;
	appContext: RequestContext;
};

type RouteExecutionContext = RequestContext | RouteAdapterContext;

function isRouteAdapterContext(
	context: RouteExecutionContext | undefined,
): context is RouteAdapterContext {
	return !!context && typeof context === "object" && "appContext" in context;
}

function unwrapRequestContext(
	context: RouteExecutionContext | undefined,
): RequestContext | undefined {
	return isRouteAdapterContext(context) ? context.appContext : context;
}

function toRouteAdapterContext(context: RequestContext): RouteAdapterContext {
	return {
		session: context.session,
		locale: context.locale,
		localeFallback: context.localeFallback,
		stage: context.stage,
		appContext: context,
	};
}

type RouteStoreContext = Parameters<typeof runWithContext>[0];

function createRouteStoreContext(
	app: Questpie<any>,
	resolvedContext: RequestContext,
	adapterContext: RouteAdapterContext,
): RouteStoreContext {
	return attachInternalAdapterContext(
		{
			app,
			session: resolvedContext.session,
			db: resolvedContext.db ?? app.db,
			locale: resolvedContext.locale,
			accessMode: resolvedContext.accessMode ?? "system",
			stage: resolvedContext.stage,
		},
		adapterContext,
	);
}

// ============================================================================
// Access Control
// ============================================================================

const extractAccessRule = (
	access?: RouteAccess,
): RouteAccessRule | undefined => {
	if (access === undefined) return undefined;
	if (typeof access === "object" && access !== null && "execute" in access) {
		return (access as { execute?: RouteAccessRule }).execute;
	}
	return access as RouteAccessRule;
};

export const evaluateRouteAccess = async (
	access: RouteAccess | undefined,
	ctx: Record<string, unknown>,
): Promise<boolean> => {
	const rule = extractAccessRule(access);
	if (rule === undefined) return true;
	if (typeof rule === "boolean") return rule;
	try {
		return await rule(ctx as any);
	} catch {
		return false;
	}
};

// ============================================================================
// JSON Route Execution
// ============================================================================

/**
 * Execute a JSON route with full context propagation.
 *
 * - Parses input via schema
 * - Runs access control
 * - Executes handler inside `runWithContext()` (ALS scope)
 * - Validates output if `outputSchema` is set
 * - Preserves request `accessMode` when provided; standalone execution defaults to system
 */
export async function executeJsonRoute<
	TInput,
	TOutput,
	TParams extends JsonRouteParams,
>(
	app: Questpie<any>,
	definition: JsonRouteDefinition<TInput, TOutput, TParams>,
	input: unknown,
	context?: RequestContext,
	request?: Request,
	params?: TParams,
): Promise<TOutput> {
	return executeJsonRouteInternal(
		app,
		definition,
		input,
		context,
		request,
		params,
	);
}

/**
 * @internal
 */
export async function executeJsonRouteInternal<
	TInput,
	TOutput,
	TParams extends JsonRouteParams,
>(
	app: Questpie<any>,
	definition: JsonRouteDefinition<TInput, TOutput, TParams>,
	input: unknown,
	context?: RouteExecutionContext,
	request?: Request,
	params?: TParams,
): Promise<TOutput> {
	const parsed = definition.schema.parse(input);
	const requestContext = unwrapRequestContext(context);
	const resolvedContext =
		requestContext ?? (await app.createContext({ accessMode: "system" }));
	const adapterContext = isRouteAdapterContext(context)
		? context
		: toRouteAdapterContext(resolvedContext);

	const services = extractAppServices(app, {
		db: resolvedContext.db ?? app.db,
		session: resolvedContext.session,
		locale: resolvedContext.locale,
	});

	// Access control — reject before handler runs
	const allowed = await evaluateRouteAccess(definition.access, {
		...services,
		locale: resolvedContext.locale,
		request,
		params,
	});
	if (!allowed) {
		throw ApiError.forbidden({
			operation: "read",
			resource: "route",
			reason: "Access denied",
		});
	}

	const result = await runWithContext(
		createRouteStoreContext(app, resolvedContext, adapterContext),
		() =>
			definition.handler({
				...services,
				...resolvedContext,
				app,
				input: parsed as TInput,
				request: request ?? new Request("http://questpie.local/"),
				locale: resolvedContext.locale,
				params: (params ?? {}) as TParams,
			} as any),
	);

	if (definition.outputSchema) {
		return definition.outputSchema.parse(result) as TOutput;
	}
	return result as TOutput;
}

// ============================================================================
// Raw Route Execution
// ============================================================================

/**
 * Execute a raw route with full context propagation.
 *
 * - Runs access control
 * - Calls handler with `(request, ctx)`
 * - Preserves request `accessMode` when provided; standalone execution defaults to system
 */
export async function executeRawRoute(
	app: Questpie<any>,
	definition: RawRouteDefinition<any>,
	request: Request,
	context?: RequestContext,
	params?: Record<string, string>,
): Promise<Response> {
	return executeRawRouteInternal(app, definition, request, context, params);
}

/**
 * @internal
 */
export async function executeRawRouteInternal(
	app: Questpie<any>,
	definition: RawRouteDefinition<any>,
	request: Request,
	context?: RouteExecutionContext,
	params?: Record<string, string>,
): Promise<Response> {
	const requestContext = unwrapRequestContext(context);
	const resolvedContext =
		requestContext ?? (await app.createContext({ accessMode: "system" }));
	const adapterContext = isRouteAdapterContext(context)
		? context
		: toRouteAdapterContext(resolvedContext);

	const services = extractAppServices(app, {
		db: resolvedContext.db ?? app.db,
		session: resolvedContext.session,
		locale: resolvedContext.locale,
	});

	// Access control — reject before handler runs
	const allowed = await evaluateRouteAccess(definition.access, {
		...services,
		locale: resolvedContext.locale,
		request,
		params,
	});
	if (!allowed) {
		throw ApiError.forbidden({
			operation: "read",
			resource: "route",
			reason: "Access denied",
		});
	}

	return runWithContext(
		createRouteStoreContext(app, resolvedContext, adapterContext),
		() =>
			definition.handler({
				...services,
				...resolvedContext,
				app,
				request,
				locale: resolvedContext.locale,
				params: params ?? {},
			} as any),
	);
}
