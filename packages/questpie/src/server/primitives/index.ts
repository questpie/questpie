/**
 * Primitives — Intentional re-export facade.
 *
 * This barrel provides a clean public API surface for the core primitive
 * factories. The original implementations remain in their canonical locations;
 * this file simply gathers them under a single import path.
 *
 * Do NOT move the source files here — this indirection is by design.
 */
export { collection } from "#questpie/server/collection/builder/collection-builder.js";
export { global } from "#questpie/server/global/builder/global-builder.js";
export { Field, field } from "#questpie/server/fields/field-class.js";
export { route } from "#questpie/server/routes/define-route.js";
export { service } from "#questpie/server/services/define-service.js";
export { module } from "#questpie/server/config/create-app.js";
