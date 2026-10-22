/**
 * Route Execution Engine
 *
 * Unified execution for JSON and raw routes with full context propagation.
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import { is } from "drizzle-orm";
import { PgTransaction, type PgTransactionConfig } from "drizzle-orm/pg-core";

import { deriveRequestContextOnDb } from "#questpie/server/adapters/utils/context.js";
import {
	isInTransaction,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import {
	type RequestContext,
	runWithContext,
} from "#questpie/server/config/context.js";
import { attachInternalAdapterContext } from "#questpie/server/config/internal-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { runInFreshRequestScope } from "#questpie/server/config/request-scope.js";
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
	requestId?: string;
	traceId?: string;
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
		...(context.requestId ? { requestId: context.requestId } : {}),
		...(context.traceId ? { traceId: context.traceId } : {}),
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
			principal: resolvedContext.principal,
			actor: resolvedContext.actor,
			db: resolvedContext.db ?? app.db,
			locale: resolvedContext.locale,
			accessMode: resolvedContext.accessMode ?? "system",
			stage: resolvedContext.stage,
			"~contextExtensions": resolvedContext["~contextExtensions"],
			...(resolvedContext.requestId
				? { requestId: resolvedContext.requestId }
				: {}),
			...(resolvedContext.traceId ? { traceId: resolvedContext.traceId } : {}),
		},
		adapterContext,
	);
}

/**
 * The context without the flat copies `createContext` makes of its
 * `appConfig({ context })` results, so spreading it after the framework
 * services cannot let a colliding extension key replace them.
 */
function withoutExtensionCopies(context: RequestContext): RequestContext {
	const extensions = context["~contextExtensions"];
	if (!extensions) return context;
	return Object.fromEntries(
		Object.entries(context).filter(
			([key, value]) =>
				!(Object.hasOwn(extensions, key) && extensions[key] === value),
		),
	) as RequestContext;
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
 * - Runs access control with the parsed input
 * - Executes handler inside `runWithContext()` (ALS scope)
 * - Validates output if `outputSchema` is set
 * - Preserves request `accessMode` when provided; standalone execution defaults to system
 * - Runs `.query()` routes on a read-only snapshot; they require a context
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
	// Output-only routes (`.outputSchema()` with no `.schema()`) are valid JSON
	// routes with `unknown` input (route-builder.ts) — their `schema` is undefined,
	// so pass the raw input through rather than crashing on `.parse`.
	// Only client input failures become VALIDATION_ERROR; a ZodError thrown by a
	// handler or by output validation stays raw, so it is reported as a server error.
	let parsed = input;
	if (definition.schema) {
		const result = definition.schema.safeParse(input);
		if (!result.success) throw ApiError.fromZodError(result.error);
		parsed = result.data;
	}
	const requestContext = unwrapRequestContext(context);
	if (definition.query) {
		return executeQueryRoute(
			app,
			definition,
			parsed as TInput,
			requestContext,
			request,
			params,
		);
	}
	const resolvedContext =
		requestContext ?? (await app.createContext({ accessMode: "system" }));
	const adapterContext = isRouteAdapterContext(context)
		? context
		: toRouteAdapterContext(resolvedContext);

	return runWithContext(
		createRouteStoreContext(app, resolvedContext, adapterContext),
		() =>
			runJsonRoute(
				app,
				definition,
				parsed as TInput,
				resolvedContext,
				request,
				params,
			),
	);
}

/** Access, handler and output validation of one JSON route evaluation. */
async function runJsonRoute<TInput, TOutput, TParams extends JsonRouteParams>(
	app: Questpie<any>,
	definition: JsonRouteDefinition<TInput, TOutput, TParams>,
	input: TInput,
	context: RequestContext,
	request?: Request,
	params?: TParams,
): Promise<TOutput> {
	const services = extractAppServices(app, {
		db: context.db ?? app.db,
		session: context.session,
		locale: context.locale,
		accessMode: context.accessMode,
		principal: context.principal,
	});

	// Framework arguments win over a colliding extension key.
	const extensions = context["~contextExtensions"] ?? {};
	const allowed = await evaluateRouteAccess(definition.access, {
		...extensions,
		...services,
		locale: context.locale,
		request,
		params,
		input,
	});
	if (!allowed) {
		throw ApiError.forbidden({
			operation: "read",
			resource: "route",
			reason: "Access denied",
		});
	}

	const result = await definition.handler({
		...extensions,
		...services,
		...withoutExtensionCopies(context),
		app,
		input,
		...(request ? { request } : {}),
		locale: context.locale,
		params: (params ?? {}) as TParams,
	} as any);
	if (definition.outputSchema) {
		return definition.outputSchema.parse(result) as TOutput;
	}
	return result as TOutput;
}

// ============================================================================
// Query Route Execution
// ============================================================================

const QUERY_SNAPSHOT: PgTransactionConfig = {
	isolationLevel: "repeatable read",
	accessMode: "read only",
};

/**
 * Evaluate a `.query()` route on one read-only repeatable-read snapshot.
 *
 * Context facts derived from the request, access, handler and output
 * validation all read that transaction, and request services are created fresh
 * for it. A query never falls back to system authority and never joins a
 * transaction it does not own.
 */
async function executeQueryRoute<
	TInput,
	TOutput,
	TParams extends JsonRouteParams,
>(
	app: Questpie<any>,
	definition: JsonRouteDefinition<TInput, TOutput, TParams>,
	input: TInput,
	context: RequestContext | undefined,
	request?: Request,
	params?: TParams,
): Promise<TOutput> {
	if (context?.accessMode !== "user" && context?.accessMode !== "system") {
		throw new Error(
			"[QUESTPIE] Query routes require a request context with an explicit accessMode",
		);
	}
	const db = context.db ?? app.db;
	// An outer transaction may hold uncommitted writes, and its isolation and
	// access mode are already fixed.
	if (isInTransaction() || is(db, PgTransaction)) {
		throw new Error(
			"[QUESTPIE] Query routes cannot run inside an existing transaction",
		);
	}

	const snapshot = {
		transaction: (run: (tx: unknown) => Promise<TOutput>) =>
			db.transaction(run, QUERY_SNAPSHOT),
	};
	return withTransaction(snapshot, (tx) =>
		runInFreshRequestScope(app, async () => {
			const snapshotContext = (await deriveRequestContextOnDb(
				app,
				context,
				tx,
			)) ?? { ...context, db: tx };
			return runWithContext(
				createRouteStoreContext(
					app,
					snapshotContext,
					toRouteAdapterContext(snapshotContext),
				),
				() =>
					runJsonRoute(
						app,
						definition,
						input,
						snapshotContext,
						request,
						params,
					),
			);
		}),
	);
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

	return runWithContext(
		createRouteStoreContext(app, resolvedContext, adapterContext),
		async () => {
			const services = extractAppServices(app, {
				db: resolvedContext.db ?? app.db,
				session: resolvedContext.session,
				locale: resolvedContext.locale,
				accessMode: resolvedContext.accessMode,
				principal: resolvedContext.principal,
			});

			const extensions = resolvedContext["~contextExtensions"] ?? {};
			const allowed = await evaluateRouteAccess(definition.access, {
				...extensions,
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

			return definition.handler({
				...extensions,
				...services,
				...withoutExtensionCopies(resolvedContext),
				app,
				request,
				locale: resolvedContext.locale,
				params: params ?? {},
			} as any);
		},
	);
}
