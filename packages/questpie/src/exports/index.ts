// Re-export everything from server
export * from "#questpie/server/index.js";

import { config } from "#questpie/cli/config.js";
// Standalone functions (backwards compat - prefer using q.collection(), q.job(), etc.)
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
// Import for q namespace
import {
  createCallableBuilder,
  questpie,
} from "#questpie/server/config/builder.js";
import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";
import { fn } from "#questpie/server/functions/define-function.js";
import { global } from "#questpie/server/global/builder/global-builder.js";
import { auth } from "#questpie/server/integrated/auth/config.js";
import { email } from "#questpie/server/integrated/mailer/template.js";
import { job } from "#questpie/server/integrated/queue/job.js";
import { starterModule } from "#questpie/server/modules/starter/index.js";
import { rpc } from "#questpie/server/rpc/factory.js";

// Create the base builder with default fields
const baseBuilder = questpie({ name: "questpie" }).fields(defaultFields);

// Create callable builder that can be used as both function and object
const callableQ = createCallableBuilder(baseBuilder);

/**
 * QUESTPIE - The main namespace for building your application
 *
 * `q` is a pre-configured callable QuestpieBuilder with all default fields registered.
 * It can be used in two ways:
 *
 * 1. **As a builder directly** - use `q.collection()`, `q.global()`, etc.
 * 2. **As a function** - call `q({ name: "my-app" })` to create a new builder
 *
 * @example
 * ```ts
 * import { q } from "questpie"
 *
 * // Define collections with type-safe fields
 * const posts = q.collection("posts").fields((f) => ({
 *   title: f.text({ required: true }),
 *   content: f.textarea(),
 *   publishedAt: f.datetime(),
 * }))
 *
 * // Define globals
 * const settings = q.global("settings").fields((f) => ({
 *   siteName: f.text({ required: true }),
 *   maintenanceMode: f.boolean({ default: false }),
 * }))
 *
 * // Define jobs
 * const sendEmail = q.job({
 *   name: "send-email",
 *   schema: z.object({ to: z.string().email() }),
 *   handler: async ({ payload, app }) => { ... }
 * })
 *
 * // Create new app builder (callable usage)
 * export const app = q({ name: "my-app" })
 *   .use(q.starter)
 *   .collections({ posts })
 *   .globals({ settings })
 *   .jobs({ sendEmail })
 *   .build({
 *     app: { url: "http://localhost:3000" },
 *     db: { url: DATABASE_URL },
 *     storage: { driver: s3Driver(...) },
 *   })
 * ```
 */
const q = Object.assign(callableQ, {
  /**
   * Starter module - opt-in "batteries included" module
   * Includes auth collections and assets with file upload support
   * @example q({ name: "app" }).use(q.starter).build({...})
   */
  starter: starterModule,

  /**
   * Define CLI configuration (questpie.config.ts)
   * @example export default q.config({ app: cms, cli: { migrations: { directory: "./migrations" } } })
   */
  config,

  /**
   * Create standalone RPC contract builder.
   */
  rpc,
});

export { q };

// Re-export standalone functions for backwards compatibility
// Prefer using q.collection(), q.job(), etc. for better type inference
export { collection, global, job, fn, email, auth, config, rpc };
