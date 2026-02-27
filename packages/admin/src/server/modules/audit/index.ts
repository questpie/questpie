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

// Re-export collection for direct access
export { auditLogCollection } from "./collections/audit-log.collection.js";
