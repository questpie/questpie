// Re-export everything from server
export * from "#questpie/server/index.js";

import { config as cliConfig } from "#questpie/cli/config.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import {
	createCallableBuilder,
	questpie,
} from "#questpie/server/config/builder.js";
import {
	config,
	createApp,
	module,
	runtimeConfig,
} from "#questpie/server/config/create-app.js";
import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";
import { fn } from "#questpie/server/functions/define-function.js";
import { global } from "#questpie/server/global/builder/global-builder.js";
import { auth } from "#questpie/server/integrated/auth/config.js";
import { email } from "#questpie/server/integrated/mailer/template.js";
import { job } from "#questpie/server/integrated/queue/job.js";
import { migration } from "#questpie/server/migration/define-migration.js";
import { route } from "#questpie/server/routes/define-route.js";
import { seed } from "#questpie/server/seed/define-seed.js";

// Create the base builder with default fields
const baseBuilder = questpie({ name: "questpie" }).fields(defaultFields);

// Create callable builder that can be used as both function and object
const callableQ = createCallableBuilder(baseBuilder);

/**
 * QUESTPIE - Internal builder namespace.
 *
 * `q` is a pre-configured callable QuestpieBuilder with all default fields registered.
 * It is used internally by admin module and module construction code.
 *
 * For new projects, use the standalone factories:
 * - `collection("name")` — define a collection
 * - `global("name")` — define a global
 * - `fn({...})` — define a function
 * - `job({...})` — define a job
 * - `config({...})` — define app config
 * - `module({...})` — define a module
 * - `createApp(config)` — build the app
 *
 * @internal Used by `@questpie/admin` module construction
 */
const q = Object.assign(callableQ, {
	/**
	 * Define CLI configuration (questpie.config.ts)
	 * @example export default q.config({ app: app, cli: { migrations: { directory: "./migrations" } } })
	 */
	config: cliConfig,
});

export { q };

// Re-export standalone functions
import { service } from "#questpie/server/services/define-service.js";

export {
	auth,
	collection,
	config,
	createApp,
	email,
	fn,
	global,
	job,
	migration,
	module,
	route,
	runtimeConfig,
	seed,
	service,
};
