import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");

function command(args: string[], cwd = root): void {
	const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0)
		throw new Error(
			`${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
		);
}

const temporary = mkdtempSync(join(tmpdir(), "questpie-p6r1-portable-"));
const bundle = join(temporary, "authority.bundle");
const clone = join(temporary, "checkout");
try {
	command(["git", "bundle", "create", bundle, "HEAD"]);
	command(["git", "clone", "--quiet", bundle, clone]);
	command(
		[
			process.execPath,
			"run",
			"docs/v4/prototypes/p6-postcommit-outcome/check.ts",
		],
		clone,
	);
} finally {
	await rm(temporary, { recursive: true, force: true });
}

console.log("P6R1 post-commit outcome portable bundle PASS");
