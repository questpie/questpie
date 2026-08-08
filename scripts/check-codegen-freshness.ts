import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const GENERATED_PATHSPEC = ":(glob)**/.generated/**";

function gitOutput(args: string[]): Uint8Array {
	const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: ROOT });
	if (result.exitCode === 0) return result.stdout;
	process.stderr.write(result.stderr);
	process.exit(result.exitCode);
}

function generatedState(): Uint8Array {
	const diff = gitOutput([
		"diff",
		"--binary",
		"HEAD",
		"--",
		GENERATED_PATHSPEC,
	]);
	const status = gitOutput([
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
		"--",
		GENERATED_PATHSPEC,
	]);
	const state = new Uint8Array(diff.length + status.length);
	state.set(diff);
	state.set(status, diff.length);
	return state;
}

function generate(force = false): void {
	const cmd = ["bunx", "turbo", "run", "questpie:generate"];
	if (force) cmd.push("--force");
	const result = Bun.spawnSync({
		cmd,
		cwd: ROOT,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0) process.exit(result.exitCode);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.length === right.length &&
		left.every((byte, index) => byte === right[index])
	);
}

const before = generatedState();
generate();
const afterFirst = generatedState();
generate(true);
const afterSecond = generatedState();

if (!equalBytes(before, afterFirst) || !equalBytes(afterFirst, afterSecond)) {
	console.error(
		"✗ generated output is stale or nondeterministic; run bunx turbo run questpie:generate and review the generated diff",
	);
	process.exit(1);
}

console.log("✓ generated output is current and deterministic");
