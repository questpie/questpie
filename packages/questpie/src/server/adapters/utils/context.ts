/**
 * HTTP Context Utilities
 *
 * Utilities for resolving session, locale, and creating adapter context.
 */

import type { Questpie } from "../../config/cms.js";
import type { QuestpieConfig } from "../../config/types.js";
import type {
	AdapterBaseContext,
	AdapterConfig,
	AdapterContext,
} from "../types.js";
import { getQueryParams, parseBoolean } from "./request.js";

export const resolveSession = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	cms: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
): Promise<{ user: any; session: any } | null> => {
	if (config.getSession) {
		return config.getSession(request, cms);
	}

	if (!cms.auth) {
		return null;
	}

	try {
		const result = await cms.auth.api.getSession({
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
	cms: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
	queryLocale?: string,
) => {
	if (queryLocale) {
		return queryLocale;
	}

	if (config.getLocale) {
		return config.getLocale(request, cms);
	}

	const header = request.headers.get("accept-language");
	return header?.split(",")[0]?.trim() || undefined;
};

export const createAdapterContext = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	cms: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig> = {},
): Promise<AdapterContext> => {
	const parsedQuery = getQueryParams(new URL(request.url));
	const queryLocale =
		typeof parsedQuery.locale === "string" ? parsedQuery.locale : undefined;
	const localeFallback =
		parsedQuery.localeFallback !== undefined
			? parseBoolean(parsedQuery.localeFallback)
			: undefined;
	const [sessionData, locale] = await Promise.all([
		resolveSession(cms, request, config),
		resolveLocale(cms, request, config, queryLocale),
	]);

	const baseContext: AdapterBaseContext = {
		session: sessionData,
		locale,
		localeFallback,
		accessMode: config.accessMode ?? "user",
	};

	// 1. Apply adapter-level extension (from adapter config)
	const adapterExtension = config.extendContext
		? await config.extendContext({ request, cms, context: baseContext })
		: undefined;

	// 2. Apply CMS-level context resolver (from .context() on builder)
	// This is where custom headers like x-tenant-id are extracted
	let cmsExtension: Record<string, any> | undefined;
	const contextResolver = cms.config.contextResolver;
	if (contextResolver) {
		cmsExtension = await contextResolver({
			request,
			session: sessionData,
			db: cms.db,
		});
	}

	// Merge all extensions into context
	const cmsContext = await cms.createContext({
		...baseContext,
		...(adapterExtension ?? {}),
		...(cmsExtension ?? {}),
	});

	return {
		session: sessionData,
		locale: cmsContext.locale,
		localeFallback: cmsContext.localeFallback,
		cmsContext,
	};
};

export const resolveContext = async <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	cms: Questpie<TConfig>,
	request: Request,
	config: AdapterConfig<TConfig>,
	context?: AdapterContext,
) => {
	if (context?.cmsContext) {
		return context;
	}

	return createAdapterContext(cms, request, config);
};
