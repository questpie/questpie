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
import type { Questpie } from "#questpie/server/config/questpie.js";
import { ApiError } from "#questpie/server/errors/index.js";

import type {
	JsonRouteDefinition,
	RawRouteDefinition,
	RouteAccess,
	RouteAccessRule,
} from "./types.js";

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
 * - Default `accessMode: "system"`
 */
export async function executeJsonRoute<TInput, TOutput>(
	app: Questpie<any>,
	definition: JsonRouteDefinition<TInput, TOutput>,
	input: unknown,
	context?: RequestContext,
): Promise<TOutput> {
	const parsed = definition.schema.parse(input);
	const resolvedContext =
		context ?? (await app.createContext({ accessMode: "system" }));

	const services = extractAppServices(app, {
		db: resolvedContext.db ?? app.db,
		session: resolvedContext.session,
	});

	// Access control — reject before handler runs
	const allowed = await evaluateRouteAccess(definition.access, {
		...services,
		locale: resolvedContext.locale,
	});
	if (!allowed) {
		throw ApiError.forbidden({
			operation: "read",
			resource: "route",
			reason: "Access denied",
		});
	}

	const result = await runWithContext(
		{
			app,
			session: resolvedContext.session,
			db: resolvedContext.db ?? app.db,
			locale: resolvedContext.locale,
			accessMode: "system",
			stage: resolvedContext.stage,
		},
		() =>
			definition.handler({
				...services,
				input: parsed as TInput,
				locale: resolvedContext.locale,
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
 * - Default `accessMode: "system"`
 */
export async function executeRawRoute(
	app: Questpie<any>,
	definition: RawRouteDefinition,
	request: Request,
	context?: RequestContext,
	params?: Record<string, string>,
): Promise<Response> {
	const resolvedContext =
		context ?? (await app.createContext({ accessMode: "system" }));

	const services = extractAppServices(app, {
		db: resolvedContext.db ?? app.db,
		session: resolvedContext.session,
	});

	// Access control — reject before handler runs
	const allowed = await evaluateRouteAccess(definition.access, {
		...services,
		locale: resolvedContext.locale,
		request,
	});
	if (!allowed) {
		throw ApiError.forbidden({
			operation: "read",
			resource: "route",
			reason: "Access denied",
		});
	}

	return runWithContext(
		{
			app,
			session: resolvedContext.session,
			db: resolvedContext.db ?? app.db,
			locale: resolvedContext.locale,
			accessMode: "system",
			stage: resolvedContext.stage,
		},
		() =>
			definition.handler({
				...services,
				app,
				request,
				locale: resolvedContext.locale,
				params: params ?? {},
			} as any),
	);
}
