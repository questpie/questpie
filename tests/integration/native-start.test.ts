import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("a full-source generated client builds and typechecks through native Start", async () => {
	const child = Bun.spawn(
		[
			process.execPath,
			resolve(import.meta.dir, "../support/native-start-run.ts"),
			"build",
		],
		{ stdout: "pipe", stderr: "pipe", timeout: 120_000 },
	);
	const [exit, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exit !== 0)
		throw new Error(`Native Start consumer failed:\n${out}\n${err}`);
	expect(out).toContain('"scenario":"native-start-build"');
}, 130_000);
