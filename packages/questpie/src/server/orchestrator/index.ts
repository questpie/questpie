/**
 * Orchestrator — Runtime Execution
 *
 * Re-exports all runtime components that execute the defined schema:
 * - createApp, runtimeConfig (app lifecycle)
 * - Questpie class (runtime app instance)
 * - AppContext, Registry (type-safe context)
 * - Request scope, context factory
 * - Collection/Global CRUD operations
 * - HTTP adapter
 * - Integrated services (auth, kv, logger, mailer, queue, realtime, search, storage)
 *
 * These are the "how" — they instantiate and run the primitives.
 * For definitions/builders, see `primitives/`.
 */

// ── App Lifecycle ───────────────────────────────────────────
export * from "../config/create-app.js";
export * from "../config/questpie.js";
export * from "../config/types.js";
export * from "../config/module-types.js";

// ── Context & Registry ──────────────────────────────────────
export * from "../config/app-context.js";
export * from "../config/context.js";
export * from "../config/create-context-factory.js";
export * from "../config/request-scope.js";

// ── Collection CRUD ─────────────────────────────────────────
export * from "../collection/crud/index.js";

// ── Global CRUD ─────────────────────────────────────────────
export * from "../global/crud/index.js";

// ── HTTP Adapter ────────────────────────────────────────────
export * from "../adapters/http.js";

// ── Integrated Services ─────────────────────────────────────
export * from "../integrated/auth/index.js";
export * from "../integrated/kv/index.js";
export * from "../integrated/logger/index.js";
export * from "../integrated/mailer/index.js";
export * from "../integrated/queue/index.js";
export * from "../integrated/realtime/index.js";
export * from "../integrated/search/index.js";
