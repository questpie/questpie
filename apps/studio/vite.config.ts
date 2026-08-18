import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Studio is served as static assets by the application's own `app.fetch`, not
 * by a second server, so this is a client build with no SSR entry. Assets land
 * in `dist/` and the runtime mount serves them from there.
 *
 * The bundle deliberately stays out of the Runtime's own bundle: an application
 * that never opens Studio should not carry its interface.
 */
export default defineConfig({
	plugins: [react(), tailwindcss()],
	// Mirrors the design system's alias so the primitives copied from apps/docs
	// stay byte-identical rather than being edited on the way in.
	resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
	build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
});
