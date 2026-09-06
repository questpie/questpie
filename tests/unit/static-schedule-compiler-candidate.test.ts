import { expect, setDefaultTimeout, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "../../packages/compiler/src";

setDefaultTimeout(120_000);
const fixture = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "00000000-0000-4000-8000-000000000001";

async function candidate(run: (root: string, source: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "questpie-schedule-compiler-"));
	try {
		await cp(fixture, root, { recursive: true });
		const source = await readFile(
			join(root, "src/company-digest-job.ts"),
			"utf8",
		);
		await run(
			root,
			source.replace("codec, durable", "codec, durable, principal"),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function compile(
	root: string,
	source: string,
	cron: string,
	actor = 'principal.service({ name: "sweep" })',
) {
	await writeFile(
		join(root, "src/company-digest-job.ts"),
		source.replace(
			'\tname: "reports.companyDigest",',
			`\tname: "reports.companyDigest",\n\tschedule: { cron: ${JSON.stringify(cron)}, execution: { principal: ${actor}, context: { companyId: "${companyId}" } }, input: { companyId: "${companyId}" } },`,
		),
	);
	return (await compileApplication({ applicationRoot: root })).generatedFiles;
}

test("candidate compiles equivalent cron and independent schedule/Job/build identities", async () => {
	await candidate(async (root, source) => {
		const first = await compile(root, source, "*/2 * * * *");
		const equivalent = await compile(root, source, "0-59/2 0-23 1-31 1-12 0-6");
		const changed = await compile(root, source, "*/3 * * * *");
		const a = JSON.parse(first["job-schedules.json"]!);
		const b = JSON.parse(equivalent["job-schedules.json"]!);
		const c = JSON.parse(changed["job-schedules.json"]!);
		expect(a.schedules).toEqual(b.schedules);
		expect(a.digest).toBe(b.digest);
		expect(a.digest).not.toBe(c.digest);
		expect(first["job-projection.json"]).toBe(changed["job-projection.json"]);
		expect(first["runtime-build.json"]).not.toBe(changed["runtime-build.json"]);
		expect(a.compilerRuntimeBuildDigest).toBe(
			JSON.parse(first["runtime-build.json"]!).compilerRuntimeBuildDigest,
		);
		expect(a.jobProjectionDigest).toBe(
			JSON.parse(first["runtime-build.json"]!).later.jobDigest,
		);
		expect(a.schedules[0].principal).toEqual({ kind: "service", id: "sweep" });
		expect(JSON.parse(a.schedules[0].contextJson)).toEqual({ companyId });
		for (const path of [
			"client.ts",
			"operation-contracts.json",
			"mcp-projection.json",
		])
			expect(first[path]).not.toContain('"sweep"');
	});
});

test("candidate rejects forged and non-service Principals before JSON loses provenance", async () => {
	await candidate(async (root, source) => {
		for (const actor of [
			'{ ...principal.service({ name: "sweep" }) }',
			'{ questpiePrincipal: true, kind: "service", id: "sweep" } as any',
			'principal.user({ id: "sweep" })',
			"principal.anonymous()",
		]) {
			await expect(
				compile(root, source, "* * * * *", actor),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-013",
				details: {
					origin: {
						path: "src/company-digest-job.ts",
						exportName: "companyDigest",
					},
				},
			});
		}
	});
});

test("candidate validates static Context/Job values and exact schedule grammar at Origins", async () => {
	await candidate(async (root, source) => {
		for (const cron of [
			"0 0 31 2 *",
			"* * 1 * 1",
			"@daily",
			"* * * * 7",
			"1/2 * * * *",
			"* * * * * *",
			"60 * * * *",
		]) {
			await expect(compile(root, source, cron)).rejects.toMatchObject({
				code: "QP-COMPOSE-013",
				details: {
					origin: {
						logicalPath: "src/company-digest-job.ts",
						exportName: "companyDigest",
					},
				},
			});
		}
		const valid = `schedule: {cron:"* * * * *",execution:{principal:principal.service({name:"sweep"}),context:{companyId:"${companyId}"}},input:{companyId:"${companyId}"}}`;
		for (const invalid of [
			valid.replace("cron:", 'timeZone:"UTC",cron:'),
			valid.replace("execution:{", 'execution:{tenant:"forbidden",'),
			valid.replace(`context:{companyId:"${companyId}"}`, "context:{}"),
			valid.replace(`input:{companyId:"${companyId}"}`, "input:{companyId:1}"),
			valid.replace(`input:{companyId:"${companyId}"}`, "input:{}"),
		]) {
			await writeFile(
				join(root, "src/company-digest-job.ts"),
				source.replace(
					'\tname: "reports.companyDigest",',
					`\tname: "reports.companyDigest",\n${invalid},`,
				),
			);
			await expect(
				compileApplication({ applicationRoot: root }),
			).rejects.toMatchObject({ code: "QP-COMPOSE-013" });
		}
	});
});

test("candidate encodes nested timestamp and optional inputs through existing codecs", async () => {
	await candidate(async (root) => {
		await writeFile(
			join(root, "src/static-date-job.ts"),
			`import {codec,durable,principal} from "questpie";
import {defineJob} from "#questpie/app";
import type {JobSchedule} from "#questpie/app";
export const staticDate = defineJob({name:"schedule.date", input:codec.object({nested:codec.object({at:codec.timestamp(),label:codec.optional(codec.text())})}), output:codec.object({}),
runAs:durable.caller({whenDenied:"fail"}),retry:durable.retry({maximumAttempts:2,initialDelay:"1s",backoff:"exponential",maximumDelay:"60s",jitter:"full",horizon:"24h"}),
schedule:{cron:"* * * * *",execution:{principal:principal.service({name:"dateSweep"}),context:{companyId:"${companyId}"}},input:{nested:{at:new Date("2026-09-06T00:00:00.000Z")}}},handler:()=>({})});
function typeProof(schedule: JobSchedule<"schedule.date">) {
const at: Date = schedule.input.nested.at;
const company: string = schedule.execution.context.companyId;
// @ts-expect-error Context input is inferred from the existing application Context
const wrongContext: number = schedule.execution.context.companyId;
// @ts-expect-error Job timestamp value remains Date
const wrongTimestamp: string = schedule.input.nested.at;
return {at,company,wrongContext,wrongTimestamp};
}
void typeProof;
`,
		);
		const files = (await compileApplication({ applicationRoot: root }))
			.generatedFiles;
		const artifact = JSON.parse(files["job-schedules.json"]!);
		expect(JSON.parse(artifact.schedules[0].inputJson)).toEqual({
			nested: { at: "2026-09-06T00:00:00.000Z" },
		});
	});
});

test("candidate schedule programs relocate and remain independent of handler edits", async () => {
	await candidate(async (root, source) => {
		const first = await compile(root, source, "* * * * *");
		const relocated = await mkdtemp(
			join(tmpdir(), "questpie-schedule-relocated-"),
		);
		try {
			await cp(root, relocated, { recursive: true });
			const second = (await compileApplication({ applicationRoot: relocated }))
				.generatedFiles;
			expect(first["job-schedules.json"]).toBe(second["job-schedules.json"]);
		} finally {
			await rm(relocated, { recursive: true, force: true });
		}
		const edited = await compile(
			root,
			source.replace(
				"const invocationId = crypto.randomUUID();",
				"const invocationId = crypto.randomUUID(); void input.companyId;",
			),
			"* * * * *",
		);
		expect(JSON.parse(first["job-schedules.json"]!).digest).toBe(
			JSON.parse(edited["job-schedules.json"]!).digest,
		);
		expect(first["job-projection.json"]).toBe(edited["job-projection.json"]);
		expect(first["runtime-build.json"]).not.toBe(edited["runtime-build.json"]);
	});
});

test("candidate rejects unsupported Package schedule authoring before a duplicate Context binding", async () => {
	await candidate(async (root) => {
		const path = join(root, "packages/audit/src/questpie.ts");
		await writeFile(
			path,
			(await readFile(path, "utf8")) +
				`
import {codec,durable,principal} from "questpie";
import {defineJob} from "#questpie/package";
export const packageJob = defineJob({name:"package.sweep",input:codec.object({}),output:codec.object({}),runAs:durable.caller({whenDenied:"fail"}),retry:durable.retry({maximumAttempts:2,initialDelay:"1s",backoff:"exponential",maximumDelay:"60s",jitter:"full",horizon:"24h"}),schedule:{cron:"* * * * *",execution:{principal:principal.service({name:"sweep"}),context:{}},input:{}},handler:()=>({})});
`,
		);
		await expect(
			compileApplication({ applicationRoot: root }),
		).rejects.toMatchObject({
			code: "QP-COMPOSE-013",
			details: { origin: { exportName: "packageJob" } },
		});
	});
});

test("candidate enforces the compiled schedule set byte bound", async () => {
	await candidate(async (root, source) => {
		await compile(root, source, "* * * * *");
		const path = join(root, "src/company-digest-job.ts");
		const scheduled = await readFile(path, "utf8");
		await writeFile(
			path,
			scheduled.replace(
				`input: { companyId: "${companyId}" }`,
				`input: { companyId: "${companyId}", restartProbe: ${JSON.stringify("x".repeat(262_144))} }`,
			),
		);
		await expect(
			compileApplication({ applicationRoot: root }),
		).rejects.toMatchObject({ code: "QP-COMPOSE-013" });
	});
});
