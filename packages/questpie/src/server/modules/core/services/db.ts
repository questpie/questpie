import { service } from "#questpie/server/services/define-service.js";

/**
 * Database service — exposes the Drizzle client from the app instance.
 *
 * Namespace: null (top-level in AppContext as `db`).
 * Already bootstrapped by the Questpie constructor; this definition
 * registers it formally so it flows through the module service system.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ db }) => db,
});
