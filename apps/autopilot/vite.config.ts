import babel from "@rolldown/plugin-babel";
import { iconifyPreload } from "@questpie/vite-plugin-iconify";
import tailwindcss from "@tailwindcss/vite";
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
				"../../packages/workflows/src/**/*.{ts,tsx}",
			],
		}),
		nitro({
			preset: "bun",
		}) as any,
		tailwindcss(),
		tanstackStart(),
		viteReact(),
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
				/^drizzle-kit/,
				/^@aws-sdk\//,
			],
		},
	},
}));

export default config;
