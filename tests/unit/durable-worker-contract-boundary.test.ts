import { expect, test } from "bun:test";
import { resolve } from "node:path";

// This test owns the private worker's contract-only dependency boundary.
test("durable worker does not load the Mutation adapter through its receipt error contract", () => {
	const repository = resolve(import.meta.dir, "../..");
	// Observe the compiler's real dependency graph in a fresh, mock-free process.
	const build = Bun.spawnSync(
		[
			"bun",
			"-e",
			`const bundle = await Bun.build({entrypoints:["./packages/runtime/src/durable/worker.ts"],target:"bun",write:false,metafile:true});
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
	expect(loaded.has("packages/runtime/src/durable/worker.ts")).toBe(true);
	expect(loaded.has("packages/runtime/src/mutation/index.ts")).toBe(false);
	expect(loaded.has("packages/runtime/src/mutation/postgres-database.ts")).toBe(
		false,
	);
});
