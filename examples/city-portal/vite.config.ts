import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type PluginOption } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
	plugins: [
		devtools(),
		nitro({
			preset: "bun",
		}) as unknown as PluginOption,
		// this is the plugin that enables path aliases
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
				// drizzle-kit and its optional dependencies (used only at dev/migration time)
				/^drizzle-kit/,
				// Files SDK S3 adapters import @aws-sdk packages as optional peer deps
				/^@aws-sdk\//,
			],
		},
	},
});

export default config;
