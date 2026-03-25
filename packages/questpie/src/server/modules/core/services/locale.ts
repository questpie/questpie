/**
 * Locale scoped service — resolves current locale per request.
 *
 * Sync lazy: reads from app config default locale.
 * Per-request locale overrides come from createContext() / adapter.
 */
import { service } from "#questpie/server/services/define-service.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";

export default service()
	.lifecycle("request")
	.namespace(null)
	.create((ctx: any) => {
		return ctx.app?.config?.locale?.defaultLocale ?? DEFAULT_LOCALE;
	});
