import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
	server: {
		port: 3000,
	},
	plugins: [
		mdx(await import("./source.config")),
		tailwindcss(),
		tsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tanstackStart({
			prerender: {
				enabled: process.env.DISABLE_PRERENDER !== "true",
				// Prerender landing page and docs routes for ISR
				routes: ["/", "/docs/*"],
				// Crawl links to discover all documentation pages
				crawlLinks: true,
			},
		}),
		nitro({ preset: "bun" }),
		react(),
	],
});
