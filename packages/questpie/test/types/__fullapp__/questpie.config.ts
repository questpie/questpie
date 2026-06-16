/**
 * Full-app gate fixture — runtime config (the `_runtime` source for the
 * generated index). Minimal: db + app only, no adapters — the fixture is
 * type-only and never instantiated at runtime.
 */
import { runtimeConfig } from "#questpie/server/config/create-app.js";

export default runtimeConfig({
	app: { url: "http://localhost:3000" },
	db: { url: "postgres://localhost/fixture" },
});
