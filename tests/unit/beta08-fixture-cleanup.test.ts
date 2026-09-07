import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Isolated module substitution tests this test-helper's ownership only. It is
// deliberately not compiler, application startup, or PostgreSQL engine proof.
for (const phase of [
	"load",
	"application",
	"database",
	"principal",
	"cleanup",
] as const) {
	test(`BETA-08 fixture cleans acquired resources after ${phase} failure`, async () => {
		const root = await mkdtemp(join(tmpdir(), "questpie-fixture-cleanup-"));
		const helper = resolve(
			import.meta.dir,
			"../integration/postgres/helpers/beta08-durable.ts",
		);
		const preparer = resolve(
			import.meta.dir,
			"../integration/postgres/helpers/beta05-runtime.ts",
		);
		const postgres = resolve(
			import.meta.dir,
			"../../packages/runtime/src/postgres/index.ts",
		);
		const script = `
import { expect, mock } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
const phase = ${JSON.stringify(phase)};
const artifact = join(${JSON.stringify(root)}, "artifact");
await mkdir(artifact);
await writeFile(join(artifact, "reaction-projection.json"), "{}");
const primary = new Error("injected setup failure");
const appCleanup = new Error("application cleanup failure");
const dbCleanup = new Error("database cleanup failure");
const artifactCleanup = new Error("artifact cleanup failure");
const calls = { application: 0, database: 0, artifact: 0 };
const realPostgres = await import(${JSON.stringify(postgres)});
mock.module(${JSON.stringify(postgres)}, () => ({
  ...realPostgres,
  createPostgresDatabase() {
    if (phase === "database") throw primary;
    return { async close() {
      calls.database++;
      if (phase === "cleanup") throw dbCleanup;
    } };
  },
}));
mock.module(${JSON.stringify(preparer)}, () => ({
  beta05Ids: { principal: "principal", readerPrincipal: "reader" },
  beta05PostgresUrl: () => "postgres://localhost/fixture_cleanup",
  prepareBeta05RetainedApplication: () => { throw new Error("retained build must not start during setup"); },
  prepareBeta05PostgresApplication: async () => ({
    generated: {
      generatedRoot: artifact,
      framework: { principal: { user() { throw primary; } } },
      async loadInternal() {
        if (phase === "load") throw primary;
        return { async createApplication() {
          if (phase === "application") throw primary;
          return { async close() {
            calls.application++;
            if (phase === "cleanup") throw appCleanup;
          } };
        } };
      },
    },
    runtimeBuildBytes: JSON.stringify({ digest: "a".repeat(64) }),
    async dispose() {
      calls.artifact++;
      await rm(artifact, { recursive: true, force: true });
      if (phase === "cleanup") throw artifactCleanup;
    },
  }),
}));
const { beta08Harness, disposeBeta08Harness } = await import(${JSON.stringify(helper)});
let failure;
try { await beta08Harness({}); } catch (error) { failure = error; }
if (phase === "cleanup") {
  expect(failure).toBeInstanceOf(SuppressedError);
  expect(failure.suppressed).toBe(primary);
  expect(failure.error).toBeInstanceOf(AggregateError);
  expect(failure.error.errors).toEqual([appCleanup, dbCleanup, artifactCleanup]);
} else expect(failure).toBe(primary);
expect(calls).toEqual({
  application: ["database", "principal", "cleanup"].includes(phase) ? 1 : 0,
  database: ["principal", "cleanup"].includes(phase) ? 1 : 0,
  artifact: 1,
});
expect(existsSync(artifact)).toBe(false);
const beforeDispose = JSON.stringify(calls);
await disposeBeta08Harness();
await disposeBeta08Harness();
expect(JSON.stringify(calls)).toBe(beforeDispose);
console.log("fixture cleanup assertions passed");
`;
		try {
			const child = Bun.spawn([process.execPath, "-e", script], {
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					PGHOST: undefined,
					PGDATABASE: undefined,
					PG_DATABASE: undefined,
					PGPASSWORD: undefined,
				},
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);
			expect(code, stdout + stderr).toBe(0);
			expect(stdout).toContain("fixture cleanup assertions passed");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
