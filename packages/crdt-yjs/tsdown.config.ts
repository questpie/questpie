import { defineConfig } from "tsdown";

export default defineConfig({
	entry: {
		server: "src/exports/server.ts",
		client: "src/exports/client.ts",
		"worker-entry": "src/worker-entry.ts",
	},
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: { sourcemap: false },
	shims: true,
	external: ["questpie/crdt", "yjs"],
	exports: {
		devExports: true,
		customExports: async (generated, { isPublish }) =>
			Object.fromEntries(
				Object.entries(generated)
					.filter(([key]) => key !== "./worker-entry")
					.map(([key, value]) => {
						if (key === "./package.json") return [key, value];

						const entryName = key.slice(2);
						const types = isPublish
							? `./dist/${entryName}.d.mts`
							: `./src/exports/${entryName}.ts`;

						return [
							key,
							{
								types,
								default: value,
							},
						];
					}),
			),
	},
});
