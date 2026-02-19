import { z } from "zod";
import { assetsCollection } from "#questpie/server/collection/defaults/assets.js";
import {
  accountsCollection,
  apiKeysCollection,
  sessionsCollection,
  usersCollection,
  verificationsCollection,
} from "#questpie/server/collection/defaults/auth.js";
import { QuestpieBuilder } from "#questpie/server/config/builder.js";
import { coreAuthOptions } from "#questpie/server/integrated/auth/index.js";
import { coreBackendMessages } from "./messages.js";

/**
 * Starter module - opt-in "batteries included" module for common app setups.
 *
 * Includes:
 * - Auth collections (users, sessions, accounts, verifications, apikeys)
 * - Assets collection with file upload support (.upload() enabled)
 * - Default access control: requires authenticated session for all CRUD operations
 * - Scheduled realtime outbox cleanup job (when queue worker is running)
 * - Core auth options (Better Auth configuration)
 * - Core backend messages (error messages, validation messages, etc.)
 *
 * **Access Control:**
 * The starter module sets `defaultAccess` to require an authenticated session
 * for all operations (read, create, update, delete). This means collections and
 * globals without explicit `.access()` rules will deny unauthenticated requests.
 *
 * To make a specific collection publicly readable, override on the collection:
 * ```ts
 * const posts = q.collection("posts")
 *   .access({ read: true })  // Public reads, other ops inherit defaultAccess
 *   .fields((f) => ({ ... }));
 * ```
 *
 * To override the default for all collections, call `.defaultAccess()` after `.use()`:
 * ```ts
 * const app = q({ name: "my-app" })
 *   .use(starterModule)
 *   .defaultAccess({ read: true, ... })  // Overrides starterModule's default
 *   .build({ ... });
 * ```
 *
 * This module is meant to be used with .use() for projects that want
 * the standard experience with authentication and file uploads.
 *
 * @example
 * ```ts
 * import { questpie, starterModule } from "@questpie/server";
 *
 * const app = questpie({ name: "my-app" })
 *   .use(starterModule)
 *   .collections({
 *     posts: postsCollection,
 *   })
 *   .build({
 *     db: { url: process.env.DATABASE_URL },
 *     storage: { driver: s3Driver(...) },
 *   });
 *
 * // Upload files to assets collection
 * const asset = await app.api.collections.assets.upload(file, context);
 * console.log(asset.url); // Typed URL
 *
 * // Use typed translations
 * app.t("error.notFound"); // Type-safe!
 *
 * // HTTP Routes available:
 * // POST /assets/upload
 * // GET /assets/files/:key
 * ```
 *
 * @example
 * ```ts
 * // Extend assets collection with custom fields
 * import { questpie, starterModule, collection } from "@questpie/server";
 *
 * const app = questpie({ name: "my-app" })
 *   .use(starterModule)
 *   .collections({
 *     // Override assets with additional fields
 *     assets: starterModule.$inferApp.api.collections.assets.merge(
 *       collection("assets").fields({
 *         folder: varchar("folder", { length: 255 }),
 *         tags: varchar("tags", { length: 1000 }),
 *       })
 *     ),
 *   })
 *   .build({ ... });
 * ```
 */
const starterBase = QuestpieBuilder.empty("questpie-starter");

const realtimeCleanupJob = starterBase.job({
  name: "questpie.realtime.cleanup",
  schema: z.object({}),
  options: {
    cron: "0 * * * *",
  },
  handler: async ({ app }) => {
    await app.realtime.cleanupOutbox(true);
  },
});

export const starterModule = starterBase
  .collections({
    assets: assetsCollection,
    user: usersCollection,
    session: sessionsCollection,
  })
  .collections({
    account: accountsCollection,
    verification: verificationsCollection,
    apikey: apiKeysCollection,
  })
  .defaultAccess({
    read: ({ session }) => !!session,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
    delete: ({ session }) => !!session,
  })
  .jobs({
    realtimeCleanup: realtimeCleanupJob,
  })
  .auth(coreAuthOptions)
  .messages(coreBackendMessages);
