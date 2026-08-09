/**
 * HTTP Context Utilities
 *
 * Utilities for resolving session, locale, and creating adapter context.
 */

import { tryGetContext } from "../../config/context.js";
import { getInternalAdapterContext } from "../../config/internal-context.js";
import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import type {
	AdapterBaseContext,
	AdapterConfig,
	AdapterContext,
} from "../types.js";
import { resolveOAuthPrincipal } from "./oauth-principal.js";
import { getQueryParams, parseBoolean } from "./request.js";

type BetterAuthSessionApi = {
	getSession(input: {
		headers: Headers;
	}): Promise<{ user: any; session: any } | null | undefined>;
};

const FRESH_ADAPTER_CONTEXT = Symbol.for(
	"questpie.internal.freshAdapterContext",
);

type RefreshableAdapterContext = AdapterContext & {
	[FRESH_ADAPTER_CONTEXT]?: () => Promise<AdapterContext>;
};

const OMIT_NATIVE_CONTEXT_VALUE = Symbol("omit-native-context-value");

function detachNativeContextValue(
	value: unknown,
	seen: WeakMap<object, unknown>,
): unknown | typeof OMIT_NATIVE_CONTEXT_VALUE {
	if (typeof value === "function" || typeof value === "symbol") {
		return OMIT_NATIVE_CONTEXT_VALUE;
	}
	if (value === null || typeof value !== "object") return value;
	if (value instanceof Promise) return OMIT_NATIVE_CONTEXT_VALUE;

	const cached = seen.get(value);
	if (cached !== undefined) return cached;

	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		seen.set(value, copy);
		for (const entry of value) {
			const detached = detachNativeContextValue(entry, seen);
			copy.push(detached === OMIT_NATIVE_CONTEXT_VALUE ? undefined : detached);
		}
		return copy;
	}

	const prototype = Object.getPrototypeOf(value);
	if (prototype === Object.prototype || prototype === null) {
		const copy: Record<string, unknown> = {};
		seen.set(value, copy);
		for (const [key, entry] of Object.entries(value)) {
			const detached = detachNativeContextValue(entry, seen);
			if (detached !== OMIT_NATIVE_CONTEXT_VALUE) copy[key] = detached;
		}
		return copy;
	}

	const cloneableBuiltin =
		value instanceof Date ||
		value instanceof RegExp ||
		value instanceof Map ||
		value instanceof Set ||
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value);
	if (!cloneableBuiltin) return OMIT_NATIVE_CONTEXT_VALUE;

	try {
		return structuredClone(value);
	} catch {
		return OMIT_NATIVE_CONTEXT_VALUE;
	}
}

function detachNativeContextRecord(
	value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!value) return undefined;
	return detachNativeContextValue(value, new WeakMap()) as Record<
		string,
		unknown
	>;
}

/**
 * Create a detached, non-authoritative context view for native middleware.
 *
 * Framework resources such as `db` are intentionally excluded. Custom class
 * instances, promises, functions, and other non-cloneable extension values are
 * omitted instead of exposing their live references.
 */
export function createNativeAdapterContextView(
	context: AdapterContext,
): import("../../config/context.js").RequestContext {
	const source = context.appContext;
	const extensions = detachNativeContextRecord(source["~contextExtensions"]);
	const view: import("../../config/context.js").RequestContext = {
		accessMode: source.accessMode,
		locale: source.locale,
		localeFallback: source.localeFallback,
		stage: source.stage,
		requestId: source.requestId,
		traceId: source.traceId,
	};
	const seen = new WeakMap<object, unknown>();
	for (const key of ["session", "principal", "actor"] as const) {
		const detached = detachNativeContextValue(source[key], seen);
		if (detached !== OMIT_NATIVE_CONTEXT_VALUE) {
			(view as Record<string, unknown>)[key] = detached;
		}
	}
	if (extensions) {
		view["~contextExtensions"] = extensions;
		Object.assign(view, extensions);
	}
	return view;
}

function attachFreshAdapterContext(
	context: AdapterContext,
	resolveFresh: () => Promise<AdapterContext>,
): AdapterContext {
	Object.defineProperty(context, FRESH_ADAPTER_CONTEXT, {
		value: resolveFresh,
		enumerable: false,
		configurable: false,
		writable: false,
	});
	return context;
}

/** @internal Re-run session resolution and app context derivation for a route. */
export function refreshAdapterContext(
	context: AdapterContext,
): Promise<AdapterContext> {
	const resolveFresh = (context as RefreshableAdapterContext)[
		FRESH_ADAPTER_CONTEXT
	];
	if (!resolveFresh) {
		throw new Error("Fresh adapter context is unavailable");
	}
	return resolveFresh();
}

export const resolveSession = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
): Promise<{ user: any; session: any } | null> => {
	if (config.getSession) {
		return config.getSession(request, app);
	}

	if (!app.auth) {
		return null;
	}

	try {
		const authApi = app.auth.api as BetterAuthSessionApi;
		const result = await authApi.getSession({
			headers: request.headers,
		});
		// Better Auth returns { user, session } directly
		return result ?? null;
	} catch {
		return null;
	}
};

export const resolveLocale = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
	queryLocale?: string,
) => {
	if (queryLocale) {
		return queryLocale;
	}

	if (config.getLocale) {
		return config.getLocale(request, app);
	}

	const header = request.headers.get("accept-language");
	return header?.split(",")[0]?.trim() || undefined;
};

const createAdapterContextInternal = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig> = {},
	observability?: { requestId?: string; traceId?: string },
	oauthAudience?: string,
): Promise<AdapterContext> => {
	const parsedQuery = getQueryParams(new URL(request.url));
	const queryLocale =
		typeof parsedQuery.locale === "string" ? parsedQuery.locale : undefined;
	const queryStage =
		typeof parsedQuery.stage === "string" ? parsedQuery.stage : undefined;
	const localeFallback =
		parsedQuery.localeFallback !== undefined
			? parseBoolean(parsedQuery.localeFallback)
			: undefined;
	// Resolve identity by credential type. An OAuth 2.1 access token (a signed
	// JWT bound to the MCP audience) resolves to an `oauth` principal that carries
	// the real user + consented scopes; anything else (cookie / opaque bearer
	// session) takes the existing Better Auth session path. OAuth resolution is
	// skipped for explicitly trusted transports (`accessMode: "system"`, e.g.
	// stdio) — those must not be downgraded by, or depend on, a bearer token.
	// A `null` from `resolveOAuthPrincipal` always means "fall through": an
	// invalid/expired/forged token yields no session below (unauthenticated),
	// never an elevated context.
	const oauthPrincipal =
		config.accessMode === "system"
			? null
			: await resolveOAuthPrincipal(app, request, config, oauthAudience);

	const [resolvedSession, locale] = await Promise.all([
		oauthPrincipal
			? oauthPrincipal.session
			: resolveSession(app, request, config),
		resolveLocale(app, request, config, queryLocale),
	]);
	const sessionData = resolvedSession;

	const baseContext: AdapterBaseContext = {
		session: sessionData,
		locale,
		localeFallback,
		stage: queryStage,
		accessMode: config.accessMode ?? "user",
		...(observability?.requestId ? { requestId: observability.requestId } : {}),
		...(observability?.traceId ? { traceId: observability.traceId } : {}),
	};

	// Apply adapter-level extension (from adapter config) — transport-level,
	// flat-merged only. Derived context that must reach access rules and hooks
	// belongs in `appConfig({ context })`, which `app.createContext` resolves.
	const adapterExtension = config.extendContext
		? await config.extendContext({ request, app, context: baseContext })
		: undefined;

	// Pass `request` through so access functions can branch on URL/headers
	// (e.g. distinguish admin vs frontend calls). `createContext` is the single
	// derivation point for the appConfig({ context }) resolver.
	//
	// When an OAuth token authenticated the request, hand its `principal` to
	// `createContext` as the authoritative identity: `accessMode` then derives to
	// `"user"` (RBAC applies as that user — never `"system"`), and the scopes ride
	// along on `ctx.principal` for the MCP scope gate (MO8).
	const appContext = await app.createContext({
		...baseContext,
		...(adapterExtension ?? {}),
		...(oauthPrincipal ? { principal: oauthPrincipal.principal } : {}),
		request,
	});

	return attachFreshAdapterContext(
		{
			session: sessionData,
			locale: appContext.locale,
			localeFallback: appContext.localeFallback,
			stage: appContext.stage,
			appContext,
			...(typeof appContext.requestId === "string"
				? { requestId: appContext.requestId }
				: {}),
			...(typeof appContext.traceId === "string"
				? { traceId: appContext.traceId }
				: {}),
		},
		() =>
			createAdapterContextInternal(
				app,
				request,
				config,
				observability,
				oauthAudience,
			),
	);
};

export const createAdapterContext = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig> = {},
	observability?: { requestId?: string; traceId?: string },
): Promise<AdapterContext> =>
	createAdapterContextInternal(app, request, config, observability);

/**
 * Build the normal adapter context while binding OAuth JWT verification to an
 * explicit RFC 8707 resource audience instead of the default MCP audience.
 */
export const createAdapterContextForOAuthAudience = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
	oauthAudience: string,
	observability?: { requestId?: string; traceId?: string },
): Promise<AdapterContext> =>
	createAdapterContextInternal(
		app,
		request,
		config,
		observability,
		oauthAudience,
	);

export const resolveContext = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
	context?: AdapterContext,
	observability?: { requestId?: string; traceId?: string },
) => {
	if (context?.appContext) {
		return withObservability(context, observability);
	}

	const stored = tryGetContext();
	const storedAdapterContext = getInternalAdapterContext(stored) as
		| AdapterContext
		| undefined;
	if (stored?.app === app && storedAdapterContext?.appContext) {
		return withObservability(storedAdapterContext, observability);
	}

	return createAdapterContext(app, request, config, observability);
};

function withObservability(
	context: AdapterContext,
	observability?: { requestId?: string; traceId?: string },
): AdapterContext {
	const requestId =
		context.requestId ??
		context.appContext.requestId ??
		observability?.requestId;
	const traceId =
		context.traceId ?? context.appContext.traceId ?? observability?.traceId;

	if (!requestId && !traceId) {
		return context;
	}

	const refreshed = {
		...context,
		...(requestId ? { requestId } : {}),
		...(traceId ? { traceId } : {}),
		appContext: {
			...context.appContext,
			...(requestId ? { requestId } : {}),
			...(traceId ? { traceId } : {}),
		},
	};
	const resolveFresh = (context as RefreshableAdapterContext)[
		FRESH_ADAPTER_CONTEXT
	];
	return resolveFresh
		? attachFreshAdapterContext(refreshed, resolveFresh)
		: refreshed;
}
