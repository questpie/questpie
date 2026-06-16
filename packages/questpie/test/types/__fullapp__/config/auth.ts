/**
 * Full-app gate fixture — `authConfig({ additionalFields, plugins })` carrier.
 *
 * Exercises `_AppSession` / `AppSessionUser` (Invariant-2): a Better Auth
 * `admin()` plugin contributes `role` to the user, and `additionalFields`
 * contributes a custom `department` field — both must survive into the inferred
 * session shape (not collapse to `any`). `authConfig()` threads the resolved
 * Better Auth session type through its `__questpieSessionType__` channel.
 */
import { admin } from "better-auth/plugins";

import { authConfig } from "#questpie/server/config/factories.js";

export default authConfig({
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			department: { type: "string", required: false },
		},
	},
	plugins: [admin()],
});
