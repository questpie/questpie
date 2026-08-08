/**
 * Audit Module
 *
 * Automatic audit logging for all mutations across collections and globals.
 *
 * Exports:
 * - `auditModule` — static module definition
 * - `AuditModule` — type of the static module
 * - `auditLogCollection` — raw collection builder
 * - `logAuditEntry` — public helper for writing custom audit entries
 */

// Static module + type
export type { AuditModule } from "./.generated/module.js";
// Named category types — re-exported so the app index can enumerate this
// module's contributors via `interface AppX extends AuditX …` (pure static
// register, never a fold). Empty categories are `Record<never, never>`.
export type {
	AuditBlocks,
	AuditCollections,
	AuditComponents,
	AuditFieldTypes,
	AuditGlobals,
	AuditJobs,
	AuditRoutes,
	AuditViews,
} from "./.generated/module.js";
export { default as auditModule } from "./.generated/module.js";

// Re-export collection and its name constant for direct access
export {
	AUDIT_LOG_COLLECTION,
	auditLogCollection,
} from "./collections/audit-log.js";

// Public API for custom audit entries
export {
	logAuditEntry,
	type AuditContext,
	type LogAuditEntryOptions,
} from "./log-audit-entry.js";

export type {
	AuditActorIdentity,
	AuditActorType,
	AuditDeliveryMode,
	AuditFieldPolicy,
	AuditPolicy,
	CanonicalAuditEvent,
	PersistedAuditEvent,
} from "./policy.js";
export { toCanonicalAuditEvent } from "./policy.js";
