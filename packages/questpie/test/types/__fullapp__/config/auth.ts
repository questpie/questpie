/**
 * Full-app gate fixture — app-local `authConfig({ additionalFields })` carrier.
 *
 * Exercises `_AppSession` / `AppSessionUser` (Invariant-2): a Better Auth
 * `admin()` plugin from the nested starter module contributes `role` to the
 * user, and this app-local config contributes a custom `department` field. Both
 * must survive into the inferred session shape (not collapse to `any`).
 * `authConfig()` threads the resolved Better Auth session type through its
 * `__questpieSessionType__` channel.
 */
import { authConfig } from "#questpie/server/config/factories.js";

export default authConfig({
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			department: { type: "string", required: false },
		},
	},
});
