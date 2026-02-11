import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
	plugins: [
		nitro({
			preset: "bun",
		}) as any,
		viteTsConfigPaths({
			projects: ["./tsconfig.json"],
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
	optimizeDeps: {
		exclude: ["drizzle-kit"],
	},
	build: {
		rollupOptions: {
			external: [
				"bun",
				/^drizzle-kit/,
				"postgres",
				"@vercel/postgres",
				"@neondatabase/serverless",
				"@aws-sdk/client-rds-data",
				"@planetscale/database",
			],
		},
	},
	resolve: {
		alias: {
			"react-resizable-panels":
				"react-resizable-panels/dist/react-resizable-panels.js",
		},
	},
});

export default config;
