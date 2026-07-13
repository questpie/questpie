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

export const createAdapterContext = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig> = {},
	observability?: { requestId?: string; traceId?: string },
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
			: await resolveOAuthPrincipal(app, request, config);

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

	return {
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
	};
};

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

	return {
		...context,
		...(requestId ? { requestId } : {}),
		...(traceId ? { traceId } : {}),
		appContext: {
			...context.appContext,
			...(requestId ? { requestId } : {}),
			...(traceId ? { traceId } : {}),
		},
	};
}
