/**
 * Questpie CLI Configuration
 *
 * Re-exports the server config for CLI commands (migrate, generate, seed).
 * The CLI auto-resolves .generated/index.ts for the app instance.
 */
export { default } from "./src/questpie/server/questpie.config";
