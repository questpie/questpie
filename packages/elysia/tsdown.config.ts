import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/server.ts", "src/client.ts"],
	outDir: "dist",
	format: ["esm"],
	clean: true,
	dts: true,
	shims: true,
});
