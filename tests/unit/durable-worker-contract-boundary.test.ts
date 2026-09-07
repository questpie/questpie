import { expect, test } from "bun:test";
import { resolve } from "node:path";

// This test owns the private durable consumers' contract-only dependency boundary.
test.each([
	"durable/worker.ts",
	"durable/checkpoint.ts",
	"durable/schedule/index.ts",
	"durable/schedule/artifact.ts",
	"mutation/contract.ts",
])(
	"%s does not load the Mutation adapter through its contract",
	(entrypoint) => {
		const repository = resolve(import.meta.dir, "../..");
		// Observe the compiler's real dependency graph in a fresh, mock-free process.
		const build = Bun.spawnSync(
			[
				"bun",
				"-e",
				`const bundle = await Bun.build({entrypoints:[${JSON.stringify(`./packages/runtime/src/${entrypoint}`)}],target:"bun",write:false,metafile:true});
console.log(JSON.stringify({success:bundle.success,inputs:Object.keys(bundle.metafile.inputs)}));`,
			],
			{
				cwd: repository,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(build.exitCode, build.stderr.toString()).toBe(0);
		const bundle = JSON.parse(build.stdout.toString()) as {
			success: boolean;
			inputs: string[];
		};
		const loaded = new Set(bundle.inputs);
		expect(bundle.success).toBe(true);
		expect(loaded.has(`packages/runtime/src/${entrypoint}`)).toBe(true);
		expect(loaded.has("packages/runtime/src/mutation/contract.ts")).toBe(true);
		expect(loaded.has("packages/runtime/src/mutation/index.ts")).toBe(false);
		expect(
			loaded.has("packages/runtime/src/mutation/postgres-database.ts"),
		).toBe(false);
		if (entrypoint === "mutation/contract.ts") {
			// A pure Mutation contract cannot point back at any of its durable callers.
			expect(
				bundle.inputs.some((path) =>
					path.startsWith("packages/runtime/src/durable/"),
				),
			).toBe(false);
		}
	},
);
