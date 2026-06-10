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
	const [sessionData, locale] = await Promise.all([
		resolveSession(app, request, config),
		resolveLocale(app, request, config, queryLocale),
	]);

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
	const appContext = await app.createContext({
		...baseContext,
		...(adapterExtension ?? {}),
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
