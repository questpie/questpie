/**
 * Orchestrator — Intentional re-export facade.
 *
 * This barrel provides a clean public API surface for app creation and
 * request handling. The original implementations remain in their canonical
 * locations; this file simply gathers them under a single import path.
 *
 * Do NOT move the source files here — this indirection is by design.
 */
export { createApp } from "#questpie/server/config/create-app.js";
export { Questpie } from "#questpie/server/config/questpie.js";
export { createFetchHandler } from "#questpie/server/adapters/http.js";
