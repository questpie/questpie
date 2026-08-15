import { expect, test } from "bun:test";
import { resolve } from "node:path";

type TurboTask = Readonly<{
	taskId: string;
	dependencies: readonly string[];
}>;

test("builds workspace dependencies before dependent private packages", async () => {
	const repositoryRoot = new URL("../..", import.meta.url).pathname;
	const process = Bun.spawn(
		[
			resolve(repositoryRoot, "node_modules/.bin/turbo"),
			"run",
			"types:check",
			"--dry=json",
		],
		{ cwd: repositoryRoot, stdout: "pipe" },
	);
	const output = await new Response(process.stdout).json();
	expect(await process.exited).toBe(0);
	const runtimeBuild = (output.tasks as readonly TurboTask[]).find(
		(task) => task.taskId === "@questpie/runtime#build",
	);
	expect(runtimeBuild?.dependencies).toContain("questpie#build");
});
