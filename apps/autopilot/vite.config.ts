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
		// "ai" is deduped because @ai-sdk/react's isolated install resolves its
		// own ai@…-canary.170 sibling while the app pins …-canary.173 — without
		// dedupe the client bundle ships two 16k-line copies of the SDK.
		// "@tanstack/react-query" is deduped because bun's isolated installs give
		// @questpie/admin its own copy — app-page useQuery instances otherwise
		// subscribe in a different QueryClient universe and never re-render.
		dedupe: ["drizzle-orm", "react", "react-dom", "ai", "@tanstack/react-query"],
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
