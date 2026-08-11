import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, type PluginOption } from "vite";

export default defineConfig({
	server: {
		port: 3000,
	},
	plugins: [
		mdx(await import("./source.config")),
		nitro({ preset: "bun" }) as unknown as PluginOption,
		tailwindcss(),
		tanstackStart({
			prerender: {
				// Keep TanStack's prerender route plugin enabled: disabling it makes
				// the current client bundle initialize the router without its stores.
				// Skip the actual render pass until Nitro's Bun stream can run inside
				// the Node-based prerender worker.
				enabled: true,
				filter: () => false,
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
