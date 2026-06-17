/**
 * Admin Configuration
 *
 * Re-exports the generated admin config.
 * Import directly from "./.generated/client" in new code.
 */
export { default as admin } from "./.generated/client";

export type AdminConfig = typeof import("./.generated/client").default;
