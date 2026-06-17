/**
 * App Instance
 *
 * Re-exports the app from the generated entrypoint.
 * Run `questpie generate` to regenerate .generated/index.ts.
 *
 * If .generated/ does not exist yet, run: bun questpie generate
 */

export { type App, type AppConfig, app } from "./.generated/index";
