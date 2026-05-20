import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type PluginOption } from "vite";

import { iconifyPreload } from "@questpie/vite-plugin-iconify";

export default defineConfig({
	server: {
		port: 3000,
	},
	plugins: [
		iconifyPreload({
			scan: ["src/**/*.{ts,tsx}", "../../packages/admin/src/**/*.{ts,tsx}"],
		}),
		mdx(await import("./source.config")),
		nitro({ preset: "bun" }) as unknown as PluginOption,
		tailwindcss(),
		tanstackStart({
			prerender: {
				enabled: process.env.DISABLE_PRERENDER !== "true",
				routes: ["/"],
				crawlLinks: false,
			},
			sitemap: {
				host: "https://questpie.com",
			},
		} as Parameters<typeof tanstackStart>[0]),
		viteReact(),
		babel({
			presets: [reactCompilerPreset()],
		}),
	],
	resolve: {
		tsconfigPaths: true,
		dedupe: ["react", "react-dom"],
		alias: {
			tslib: "tslib/tslib.es6.mjs",
		},
	},
	ssr: {
		noExternal: [/^@radix-ui\//, "@fumadocs/ui", "fumadocs-ui", "next-themes"],
	},
});
