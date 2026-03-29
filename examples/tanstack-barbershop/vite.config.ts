import babel from "@rolldown/plugin-babel";
import { iconifyPreload } from "@questpie/vite-plugin-iconify";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig(({ mode }) => ({
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
		tailwindcss(),
		tanstackStart(),
		viteReact(),
		// React Compiler is slow in dev — only enable for production builds
		...(mode === "development"
			? []
			: [babel({ presets: [reactCompilerPreset()] })]),
	],
	optimizeDeps: {
		exclude: ["bun", "drizzle-kit"],
		include: [
			"react",
			"react-dom",
			"react/jsx-runtime",
			"react/jsx-dev-runtime",
			"@iconify/react",
			"@tanstack/react-query",
			"@tanstack/react-router",
			"zod",
		],
	},
	resolve: {
		tsconfigPaths: true,
		dedupe: ["drizzle-orm", "react", "react-dom"],
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
}));

export default config;
