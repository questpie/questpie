/**
 * Primitives — Builder Definitions
 *
 * Re-exports all builder/definition primitives that define the schema:
 * - Collection builder (structure, fields, versioning, workflow)
 * - Global builder (structure, fields)
 * - Field system (field class, field types, operators)
 * - Route builder (define-route, route-builder)
 * - Service definitions (define-service)
 * - Seed definitions (define-seed)
 * - Migration definitions (define-migration)
 *
 * These are the "what" — they describe the data model and API surface.
 * For runtime execution, see `orchestrator/`.
 */

// ── Collection Builder ──────────────────────────────────────
export * from "../collection/builder/index.js";

// ── Global Builder ──────────────────────────────────────────
export * from "../global/builder/index.js";

// ── Field System ────────────────────────────────────────────
export * from "../fields/index.js";

// ── Route Builder ───────────────────────────────────────────
export * from "../routes/index.js";

// ── Service Definitions ─────────────────────────────────────
export * from "../services/define-service.js";

// ── Seed Definitions ────────────────────────────────────────
export * from "../seed/index.js";

// ── Migration Definitions ───────────────────────────────────
export * from "../migration/index.js";

// ── Builder Utilities ───────────────────────────────────────
export * from "../utils/builder-extensions.js";
export * from "../utils/callback-proxies.js";
