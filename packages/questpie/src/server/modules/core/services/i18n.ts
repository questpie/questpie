import { service } from "#questpie/server/services/define-service.js";
import { createTranslator } from "#questpie/server/i18n/translator.js";

/**
 * i18n translator service — creates the `t()` function from app config.
 *
 * Namespace: null (top-level in AppContext as `t`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => createTranslator(app.config.translations),
});
