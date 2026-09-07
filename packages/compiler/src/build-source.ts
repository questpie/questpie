import { readFile } from "node:fs/promises";

import type { BunPlugin } from "bun";

/** Physical source reads belong to each build, independently of host module evaluation. */
export const compilerSourceFiles: BunPlugin = {
	name: "questpie-compiler-source-files",
	setup(builder) {
		// Bun's host module cache can retain descriptors that an earlier build closed.
		// Preserve extension-inferred loaders and leave virtual/other namespaces alone.
		builder.onLoad(
			{ filter: /\.(?:[cm]?[jt]s|[jt]sx|json)$/, namespace: "file" },
			async ({ path }) => ({ contents: await readFile(path) }),
		);
	},
};
