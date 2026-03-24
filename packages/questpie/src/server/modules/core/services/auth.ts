import { service } from "#questpie/server/services/define-service.js";

/**
 * Auth service — exposes the Better Auth instance.
 *
 * Namespace: null (top-level in AppContext as `auth`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ auth }) => auth,
});
