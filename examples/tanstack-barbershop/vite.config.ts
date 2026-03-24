import babel from "@rolldown/plugin-babel";
import { iconifyPreload } from "@questpie/vite-plugin-iconify";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
	plugins: [
		iconifyPreload({
			scan: [
				"src/**/*.{ts,tsx}",
				"../../packages/admin/src/**/*.{ts,tsx}",
			],
		}),
		devtools(),
		nitro({
			preset: "bun",
		}) as any,
		// this is the plugin that enables path aliases
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		babel({
			presets: [reactCompilerPreset()],
		}),
	],
	optimizeDeps: {
		exclude: ["bun", "drizzle-kit"],
	},
	resolve: {
		tsconfigPaths: true,
		dedupe: ["drizzle-orm"],
	},
	build: {
		rollupOptions: {
			external: [
				"bun",
				// drizzle-kit and its optional dependencies (used only at dev/migration time)
				/^drizzle-kit/,
				// flydrive S3 driver imports @aws-sdk/client-s3 which is an optional peer dep
				/^@aws-sdk\//,
			],
		},
	},
});

export default config;
