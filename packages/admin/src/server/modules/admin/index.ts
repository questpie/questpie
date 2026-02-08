/**
 * Admin Module
 *
 * Complete backend module for running the QuestPie admin panel.
 * This is the main entry point for setting up the admin backend.
 *
 * Includes:
 * - Auth collections (users, sessions, accounts, verifications, apikeys)
 * - Assets collection with file upload support
 * - Admin saved views collection (named view configurations)
 * - Admin preferences collection (user-specific view state)
 * - Setup functions for bootstrapping first admin
 * - Core auth options (Better Auth configuration)
 *
 * @example
 * ```ts
 * import { q } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .collections({
 *     posts: postsCollection,
 *   })
 *   .build({
 *     db: { url: process.env.DATABASE_URL },
 *     storage: { driver: s3Driver(...) },
 *   });
 * ```
 */

import { q, rpc, starterModule } from "questpie";
// Side-effect imports: apply runtime patches and type augmentation
import "../../augmentation.js";
import "../../patch.js";
import { adminFields } from "../../fields/index.js";
import { adminPreferencesCollection } from "../admin-preferences/collections/admin-preferences.collection.js";
import { savedViewsCollection } from "../admin-preferences/collections/saved-views.collection.js";
import { adminConfigFunctions } from "./functions/admin-config.js";
import { actionFunctions } from "./functions/execute-action.js";
import { localeFunctions } from "./functions/locales.js";
import { previewFunctions } from "./functions/preview.js";
import { setupFunctions } from "./functions/setup.js";
import { translationFunctions } from "./functions/translations.js";
import { widgetDataFunctions } from "./functions/widget-data.js";

// Re-export admin preferences collection
export { adminPreferencesCollection } from "../admin-preferences/collections/admin-preferences.collection.js";
// Re-export saved views types
export {
  type FilterOperator,
  type FilterRule,
  type SortConfig,
  savedViewsCollection,
  type ViewConfiguration,
} from "../admin-preferences/collections/saved-views.collection.js";
// Re-export admin config functions
export {
  adminConfigFunctions,
  getAdminConfig,
} from "./functions/admin-config.js";
// Re-export action functions
export {
  actionFunctions,
  type ExecuteActionRequest,
  type ExecuteActionResponse,
  executeAction,
  executeActionFn,
  getActionsConfig,
  getActionsConfigFn,
} from "./functions/execute-action.js";
// Re-export locale functions for individual use
export { getContentLocales, localeFunctions } from "./functions/locales.js";
// Re-export server-only preview functions (crypto-based token verification)
// For browser-safe utilities (isDraftMode, createDraftModeCookie, etc.), use @questpie/admin/shared
export {
  createPreviewFunctions,
  createPreviewTokenVerifier,
  type PreviewTokenPayload,
  previewFunctions,
  verifyPreviewTokenDirect,
} from "./functions/preview.js";
// Re-export setup functions for individual use
export {
  createFirstAdmin,
  isSetupRequired,
  setupFunctions,
} from "./functions/setup.js";
// Re-export translation functions for individual use
export {
  getAdminLocales,
  getAdminTranslations,
  translationFunctions,
} from "./functions/translations.js";
// Re-export widget data functions
export {
  fetchWidgetData,
  widgetDataFunctions,
} from "./functions/widget-data.js";

const r = rpc();

export const adminRpc = r.router({
  ...setupFunctions,
  ...localeFunctions,
  ...previewFunctions,
  ...adminConfigFunctions,
  ...actionFunctions,
  ...translationFunctions,
  ...widgetDataFunctions,
});

/**
 * Admin Module - the complete backend for QuestPie admin panel.
 *
 * This module provides everything needed to run the admin panel:
 * - User authentication (Better Auth) - from starterModule
 * - File uploads (assets) - from starterModule
 * - Saved views for collection filters (named configurations)
 * - User preferences (view state synced across devices)
 * - Setup flow for first admin creation
 *
 * @example
 * ```ts
 * import { q } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .collections({
 *     posts: postsCollection,
 *   })
 *   .build({
 *     db: { url: process.env.DATABASE_URL },
 *   });
 * ```
 *
 * @example
 * ```ts
 * // Extend assets collection with custom fields
 * import { q, collection, varchar } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .collections({
 *     // Override assets with additional fields
 *     assets: adminModule.state.collections.assets.merge(
 *       collection("assets").fields({
 *         folder: varchar("folder", { length: 255 }),
 *         tags: varchar("tags", { length: 1000 }),
 *       })
 *     ),
 *   })
 *   .build({ ... });
 * ```
 */
export const adminModule = q({ name: "questpie-admin" })
  // Include all starterModule functionality (auth, assets)
  .use(starterModule)
  // Register admin-specific field types (richText, blocks)
  .fields(adminFields)
  // Add admin-specific collections with admin UI config
  .collections({
    // Override auth collections with admin UI config
    user: starterModule.state.collections.user
      .admin(({ c }) => ({
        label: { key: "defaults.users.label" },
        icon: c.icon("ph:users"),
        description: { key: "defaults.users.description" },
        group: "administration",
      }))
      .list(({ v, f, a }) =>
        v.table({
          columns: [f.name, f.email, f.role, f.banned],
          searchable: [f.name, f.email],
          defaultSort: { field: f.name, direction: "asc" },
          actions: {
            header: { primary: [a.create] },
            bulk: [a.deleteMany],
          },
        }),
      )
      .form(({ v, f }) =>
        v.form({
          sections: [
            {
              label: { key: "defaults.users.sections.basicInfo" },
              fields: [f.name, f.email],
            },
            {
              label: { key: "defaults.users.sections.permissions" },
              fields: [f.role, f.emailVerified],
            },
            {
              label: { key: "defaults.users.sections.accessControl" },
              fields: [f.banned, f.banReason],
            },
          ],
        }),
      ),

    assets: starterModule.state.collections.assets.admin(({ c }) => ({
      label: { key: "defaults.assets.label" },
      icon: c.icon("ph:image"),
      description: { key: "defaults.assets.description" },
      group: "administration",
    })),

    // Hide internal auth collections
    session: starterModule.state.collections.session.admin({ hidden: true }),
    account: starterModule.state.collections.account.admin({ hidden: true }),
    verification: starterModule.state.collections.verification.admin({
      hidden: true,
    }),
    apikey: starterModule.state.collections.apikey.admin({ hidden: true }),

    // Admin-specific collections (hidden from sidebar)
    adminSavedViews: savedViewsCollection.admin({ hidden: true }),
    adminPreferences: adminPreferencesCollection.admin({ hidden: true }),
  })
  // Default sidebar
  .sidebar(({ s, c }) =>
    s.sidebar({
      sections: [
        s.section({
          id: "administration",
          title: { key: "defaults.sidebar.administration" },
          items: [
            {
              type: "collection",
              collection: "user",
              icon: c.icon("ph:users"),
            },
            {
              type: "collection",
              collection: "assets",
              icon: c.icon("ph:image"),
            },
          ],
        }),
      ],
    }),
  );
