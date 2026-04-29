/**
 * Audit Module
 *
 * Automatic audit logging for all mutations across collections and globals.
 *
 * Exports:
 * - `auditModule` — static module definition
 * - `AuditModule` — type of the static module
 * - `auditLogCollection` — raw collection builder
 */

// Static module + type
export type { AuditModule } from "./.generated/module.js";
export { default as auditModule } from "./.generated/module.js";

// Re-export collection and its name constant for direct access
export {
	AUDIT_LOG_COLLECTION,
	auditLogCollection,
} from "./collections/audit-log.js";
