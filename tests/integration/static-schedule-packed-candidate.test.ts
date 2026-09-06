import { expect, test } from "bun:test";
import {
	cp,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");
const packageRoot = join(repository, "packages/questpie");

function run(command: string[], cwd: string): void {
	const result = Bun.spawnSync(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(
		result.exitCode,
		result.stdout.toString() + result.stderr.toString(),
	).toBe(0);
}

test("packed candidate compiles static schedules and inert checkpoint references through embedded compiler", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-static-schedule-pack-"),
	);
	try {
		run(["bun", "run", "build"], packageRoot);
		run(
			[
				"bun",
				"pm",
				"pack",
				"--destination",
				temporary,
				"--ignore-scripts",
				"--quiet",
			],
			packageRoot,
		);
		const archive = (await readdir(temporary)).find((path) =>
			path.endsWith(".tgz"),
		);
		expect(archive).toBeDefined();
		const consumer = join(temporary, "consumer");
		await cp(join(repository, "fixtures/collaboration"), consumer, {
			recursive: true,
		});
		await writeFile(
			join(consumer, "package.json"),
			JSON.stringify({
				name: "static-schedule-packed-candidate",
				private: true,
				type: "module",
				dependencies: { questpie: `file:${join(temporary, archive!)}` },
			}),
		);
		await writeFile(
			join(consumer, "src/packed-static-job.ts"),
			`import {codec,durable,principal} from "questpie";
import {defineJob} from "#questpie/app";
export const packedSweep=defineJob({name:"packed.sweep",input:codec.object({}),output:codec.object({}),runAs:durable.caller({whenDenied:"fail"}),retry:durable.retry({maximumAttempts:2,initialDelay:"1s",backoff:"exponential",maximumDelay:"60s",jitter:"full",horizon:"24h"}),schedule:{cron:"* * * * *",execution:{principal:principal.service({name:"packedSweep"}),context:{companyId:"00000000-0000-4000-8000-000000000001"}},input:{}},handler:async({ctx})=>{await ctx.run.step.mutation("sweep",ctx.mutations.message.requestDigest,{companyId:ctx.tenant.id});return {};}});
`,
		);
		run(["bun", "install", "--ignore-scripts"], consumer);
		run([join(consumer, "node_modules/.bin/questpie"), "build"], consumer);
		const schedules = JSON.parse(
			await readFile(
				join(consumer, ".questpie/generated/job-schedules.json"),
				"utf8",
			),
		);
		expect(schedules.schedules).toHaveLength(1);
		expect(schedules.schedules[0].principal).toEqual({
			kind: "service",
			id: "packedSweep",
		});
		const installed = join(
			consumer,
			"node_modules/questpie/dist/internal/compiler/job",
		);
		for (const file of ["discovery.js", "schedules.js"])
			expect(await readFile(join(installed, file), "utf8")).not.toContain(
				'"@questpie/runtime/',
			);
		expect(
			await readFile(join(consumer, ".questpie/generated/client.ts"), "utf8"),
		).not.toContain("packedSweep");
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 120_000);
