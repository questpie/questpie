import { service } from "#questpie/server/services/define-service.js";

/**
 * i18n translator service — exposes the `t()` function.
 *
 * Namespace: null (top-level in AppContext as `t`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ t }) => t,
});
