import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("a bundled queue adapter validates its SDK without runtime node_modules", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-queue-bundle-"));
	try {
		const adapterPath = fileURLToPath(
			new URL(
				"../../src/server/modules/core/integrated/queue/adapters/pg-boss.ts",
				import.meta.url,
			),
		);
		const entry = join(directory, "entry.ts");
		await writeFile(
			entry,
			`import { PgBossAdapter } from ${JSON.stringify(adapterPath)};
const adapter = new PgBossAdapter({ connectionString: "postgres://localhost:1/not-used" });
if (!adapter.capabilities.longRunningConsumer) throw new Error("Missing queue capability");
console.log("queue-constructor-ok");
`,
		);
		const builder = join(directory, "build.ts");
		const buildOptions = {
			entrypoints: [entry],
			target: "node",
			packages: "bundle",
			outdir: directory,
			naming: "worker.mjs",
		};
		await writeFile(
			builder,
			`const result = await Bun.build(${JSON.stringify(buildOptions)});
if (!result.success) throw new AggregateError(result.logs, "Queue fixture compilation failed");
`,
		);
		const compilation = Bun.spawn([process.execPath, builder], {
			cwd: fileURLToPath(new URL("../../", import.meta.url)),
			stdout: "pipe",
			stderr: "pipe",
		});
		const [buildExit, buildError] = await Promise.all([
			compilation.exited,
			new Response(compilation.stderr).text(),
		]);
		if (buildExit !== 0) throw new Error(buildError);

		const child = Bun.spawn(["node", join(directory, "worker.mjs")], {
			cwd: directory,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(stderr).toBe("");
		expect(exitCode).toBe(0);
		expect(stdout).toContain("queue-constructor-ok");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);
