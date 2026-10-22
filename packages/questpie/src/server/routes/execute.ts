/**
 * Route Execution Engine
 *
 * Unified execution for JSON and raw routes with full context propagation.
 *
 * @see QUE-158 (Unified route() builder + URL flattening)
 */

import { types as nodeTypes } from "node:util";

import { is, sql } from "drizzle-orm";
import { PgTransaction, type PgTransactionConfig } from "drizzle-orm/pg-core";
import { ZodError } from "zod";

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
import { captureRealtimeWatermark } from "#questpie/server/modules/core/integrated/realtime/snapshot.js";

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
	return prepareJsonRoute(app, definition, input, request, params).execute(
		context,
	);
}

/**
 * Parse route input once, then execute access, handler and output validation
 * under the supplied context. Query executions retain their own snapshot.
 * Adapters must verify credentials before preparing application input.
 */
export function prepareJsonRoute<
	TInput,
	TOutput,
	TParams extends JsonRouteParams,
>(
	app: Questpie<any>,
	definition: JsonRouteDefinition<TInput, TOutput, TParams>,
	input: unknown,
	request?: Request,
	params?: TParams,
) {
	// Output-only routes (`.outputSchema()` with no `.schema()`) are valid JSON
	// routes with `unknown` input (route-builder.ts) — their `schema` is undefined,
	// so pass the raw input through rather than crashing on `.parse`.
	// Only client input failures become VALIDATION_ERROR; a ZodError thrown by a
	// handler or by output validation stays raw, so it is reported as a server error.
	let parsed = input;
	if (definition.schema) {
		let result: ReturnType<typeof definition.schema.safeParse>;
		try {
			result = definition.schema.safeParse(input);
		} catch (error) {
			if (!nodeTypes.isProxy(error) && error instanceof ZodError)
				throw ApiError.fromZodError(error);
			throw error;
		}
		if (!result.success) throw ApiError.fromZodError(result.error);
		parsed = result.data;
	}
	return {
		input: parsed as TInput,
		snapshot: (
			context: RouteExecutionContext,
		): Promise<{ data: TOutput; upToDate: string }> => {
			if (!definition.query)
				throw new Error("Only query routes have coherent snapshots");
			const requestContext = unwrapRequestContext(context);
			return executeQueryRoute(
				app,
				definition,
				parsed as TInput,
				requestContext,
				requestContext?.request instanceof Request
					? requestContext.request
					: request,
				params,
				true,
			) as Promise<{ data: TOutput; upToDate: string }>;
		},
		execute: async (context?: RouteExecutionContext): Promise<TOutput> => {
			const requestContext = unwrapRequestContext(context);
			if (definition.query) {
				return (
					await executeQueryRoute(
						app,
						definition,
						parsed as TInput,
						requestContext,
						request,
						params,
					)
				).data;
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
		},
	};
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
		actor: context.actor,
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
	captureWatermark = false,
): Promise<{ data: TOutput; upToDate?: string }> {
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
		transaction: (
			run: (tx: unknown) => Promise<{ data: TOutput; upToDate?: string }>,
		) => db.transaction(run, QUERY_SNAPSHOT),
	};
	return withTransaction(snapshot, (tx) =>
		runInFreshRequestScope(app, async () => {
			const evaluate = async (evaluationRequest = request) => {
				// The visibility watermark must establish the snapshot before facts or reads.
				const upToDate = captureWatermark
					? await captureRealtimeWatermark({ db: tx })
					: undefined;
				if (captureWatermark)
					await tx.execute(
						sql`select set_config('statement_timeout', '30000', true)`,
					);
				const snapshotContext = (await deriveRequestContextOnDb(
					app,
					{
						...context,
						...(evaluationRequest ? { request: evaluationRequest } : {}),
					},
					tx,
				)) ?? { ...context, db: tx };
				const data = await runWithContext(
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
							evaluationRequest,
							params,
						),
				);
				return { data, ...(upToDate === undefined ? {} : { upToDate }) };
			};
			if (!captureWatermark) return evaluate();
			// Bound the transaction callback even if application JavaScript stalls.
			// PostgreSQL statement_timeout also bounds an outstanding SQL statement;
			// arbitrary JavaScript must cooperate with request.signal to stop its work.
			const controller = new AbortController();
			const signal = request
				? AbortSignal.any([request.signal, controller.signal])
				: controller.signal;
			if (signal.aborted) return Promise.reject(signal.reason);
			let timer: ReturnType<typeof setTimeout>;
			let onAbort: () => void;
			const deadline = new Promise<never>((_, reject) => {
				onAbort = () =>
					reject(signal.reason ?? new Error("Route query cancelled"));
				signal.addEventListener("abort", onAbort, { once: true });
				timer = setTimeout(
					() => controller.abort(new Error("Route query exceeded 30000ms")),
					30_000,
				);
				if (signal.aborted) onAbort();
			});
			return Promise.race([
				evaluate(request ? new Request(request, { signal }) : undefined),
				deadline,
			]).finally(() => {
				clearTimeout(timer!);
				signal.removeEventListener("abort", onAbort!);
			});
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
