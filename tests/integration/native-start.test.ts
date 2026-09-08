import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { runNativeStartProcess } from "../support/native-start-process";

test("a full-source generated client builds and typechecks through native Start", async () => {
	const result = await runNativeStartProcess(
		resolve(import.meta.dir, "../support/native-start-run.ts"),
		["build"],
		120_000,
	);
	if (result.timedOut || result.exit !== 0)
		throw new Error(
			`Native Start consumer failed:\n${result.stdout}\n${result.stderr}`,
		);
	expect(result.stdout).toContain('"scenario":"native-start-build"');
}, 130_000);
