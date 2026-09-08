import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { prepareFactoryClients } from "./factory-seam-render";

const directory = await mkdtemp(join(import.meta.dir, "factory-seam-output-"));
try {
	await prepareFactoryClients(directory);
	const config = join(directory, "tsconfig.json");
	await Bun.write(
		config,
		JSON.stringify({
			extends: join(import.meta.dir, "tsconfig.json"),
			compilerOptions: {
				paths: {
					"#questpie/client": [join(directory, "client.ts")],
					"#factory-seam/page-client": [join(directory, "page-client.ts")],
					"questpie/react-query": [join(import.meta.dir, "factory-seam.ts")],
				},
			},
			include: [
				join(import.meta.dir, "factory-seam.types.ts"),
				join(import.meta.dir, "factory-seam.test.ts"),
			],
		}),
	);
	const process = Bun.spawn(
		[
			"bun",
			resolve(import.meta.dir, "node_modules/typescript/bin/tsc"),
			"-p",
			config,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	if ((await process.exited) !== 0)
		throw new Error("FACTORY_SEAM_TYPES_FAILED");
	console.log("factory-seam: strict native public-factory types PASS");
} finally {
	await rm(directory, { recursive: true, force: true });
}
