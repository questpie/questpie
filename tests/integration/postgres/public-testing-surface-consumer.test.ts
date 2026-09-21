// Proves ADR-0045 (docs/adr/0045-freeze-public-testing-surface.md): an
// application outside this repository, using only the published `questpie`
// and `questpie/testing` specifiers, can boot its own compiled app against a
// real PostgreSQL, get an isolated database with migrations and Seeds
// applied and torn down, obtain a trusted Principal through the same seam
// the application's credential resolver uses, call a generated Query and
// Mutation in-process and a Route over HTTP, and drain a Job deterministically.
//
// This orchestrator only sets up the fixture copy (compiled once, through
// the installed CLI binary — never a repo-relative dist path) and then runs
// the actual proof as its own `bun test` subprocess *inside* that copy
// (tests/support/public-testing-cases/collaboration-consumer.case.ts). That
// is deliberate: a bare `import ... from "questpie/testing"` written in
// *this* file would resolve through this repository's own workspace
// node_modules, not through the fixture copy's — which, under
// QUESTPIE_PACKED_TARBALL, is a real extracted npm tarball. Only a process
// whose own module resolution root is the fixture copy proves the packed
// artifact is actually what gets imported.
import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const postgresTest = process.env.PGHOST ? test : test.skip;

async function resolveInstalledCliPath(
	applicationRoot: string,
): Promise<string> {
	const manifestPath = join(
		applicationRoot,
		"node_modules/questpie/package.json",
	);
	const manifest = JSON.parse(
		await readFile(manifestPath, "utf8"),
	) as Readonly<{
		bin?: string | Readonly<Record<string, string>>;
	}>;
	const binRelative =
		typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.questpie;
	if (!binRelative)
		throw new Error(
			`${manifestPath}: installed questpie package does not declare a CLI binary`,
		);
	return join(applicationRoot, "node_modules/questpie", binRelative);
}

async function run(command: readonly string[], cwd: string): Promise<string> {
	const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	const output = stdout + stderr;
	if (exitCode !== 0)
		throw new Error(`${command.join(" ")} (cwd=${cwd}) failed:\n${output}`);
	return output;
}

postgresTest(
	"an external consumer of questpie/testing boots, isolates, authenticates, calls, and drains a Job",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-public-testing-surface-"),
		);
		try {
			await cp(fixtureRoot, temporary, {
				recursive: true,
				filter: (path) =>
					!path
						.split("/")
						.some((part) => part === "node_modules" || part === ".questpie"),
			});

			// Selects the real packed tarball under QUESTPIE_PACKED_TARBALL, or a
			// dev symlink to workspace source otherwise — the same choice every
			// other tracer test in this repository makes.
			await installQuestpieForTracer(temporary);

			// Resolved through the installed package's own declared `bin`, not a
			// repo-relative packages/questpie/dist/cli.js path: this is the step
			// an external consumer's own `bunx questpie build` performs. `build`
			// touches no PostgreSQL, so no DATABASE_URL is set for it.
			const cliPath = await resolveInstalledCliPath(temporary);
			await run(["bun", cliPath, "build"], temporary);

			await cp(
				resolve(
					repositoryRoot,
					"tests/support/public-testing-cases/collaboration-consumer.case.ts",
				),
				join(temporary, "public-testing-proof.test.ts"),
			);

			const output = await run(
				["bun", "test", "public-testing-proof.test.ts", "--timeout=30000"],
				temporary,
			);
			expect(output).toContain("1 pass");
			expect(output).toContain("0 fail");
			expect(output).toContain("5 expect() calls");
		} finally {
			await rm(temporary, { force: true, recursive: true });
		}
	},
	60_000,
);
