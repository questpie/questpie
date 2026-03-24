/**
 * Default auth config for the starter module.
 * Includes the admin plugin (role/ban management) and bearer token plugin.
 *
 * User projects can override or extend via their own `config/auth.ts`.
 * Plugins are deduped by ID during merge, so duplicates are safe.
 */
import { admin, bearer } from "better-auth/plugins";

export default {
	plugins: [admin(), bearer()],
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
};
