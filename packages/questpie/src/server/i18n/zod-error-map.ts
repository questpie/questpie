/**
 * Zod Error Map for Backend i18n
 *
 * Re-exports the shared Zod error map with backend-specific types.
 * The actual implementation is in questpie/shared/i18n/zod-error-map.ts
 */

// Re-export everything from shared
export {
	createZodErrorMap,
	i18nParams,
	type ZodErrorMapFn,
	type ZodIssue,
} from "#questpie/shared/i18n/index.js";

// Re-export types that backend uses
export type { BackendTranslateFn } from "./types.js";
