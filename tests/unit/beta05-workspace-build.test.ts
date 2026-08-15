import { expect, test } from "bun:test";

type TurboTask = Readonly<{
	taskId: string;
	dependencies: readonly string[];
}>;

test("builds workspace dependencies before dependent private packages", async () => {
	const process = Bun.spawn(
		["bunx", "turbo", "run", "types:check", "--dry=json"],
		{ cwd: new URL("../..", import.meta.url).pathname, stdout: "pipe" },
	);
	const output = await new Response(process.stdout).json();
	expect(await process.exited).toBe(0);
	const runtimeBuild = (output.tasks as readonly TurboTask[]).find(
		(task) => task.taskId === "@questpie/runtime#build",
	);
	expect(runtimeBuild?.dependencies).toContain("questpie#build");
});
