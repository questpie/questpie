import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SRC_CLI_ENTRY = resolve(import.meta.dirname, "../../src/exports/cli.ts");

/**
 * Regression tests for the double-parse incident: questpie.config.ts files
 * import "questpie/cli" for packageConfig. In the workspace that import
 * resolves to src/exports/cli.ts — a second module instance next to the
 * dist/cli.mjs the bin already loaded — and a top-level program.parse()
 * side effect started the in-flight generate a second time. Two concurrent
 * generates wrote the same .generated/module.ts files and corrupted them
 * (truncated output ending in NUL bytes).
 */
describe("questpie/cli import side effects", () => {
	it("importing questpie/cli never executes a command, even with a command-shaped argv", async () => {
		const dir = await mkdtemp(join(tmpdir(), "questpie-cli-import-"));
		const script = join(dir, "import-cli.ts");
		await writeFile(
			script,
			[
				// Simulate the incident: a generate is in flight, so argv carries
				// the command while the config file imports "questpie/cli".
				`process.argv = [process.argv[0], "questpie", "generate", "--verbose"];`,
				`await import(${JSON.stringify(SRC_CLI_ENTRY)});`,
				`console.log("IMPORT_OK");`,
			].join("\n"),
			"utf-8",
		);

		const proc = Bun.spawn(["bun", script], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(code).toBe(0);
		expect(stdout.trim()).toBe("IMPORT_OK");
	}, 30000);

	it("running src/exports/cli.ts as the process entry still parses", async () => {
		const proc = Bun.spawn(["bun", SRC_CLI_ENTRY, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(code).toBe(0);
		expect(stdout).toContain("Usage: questpie");
	}, 30000);
});
