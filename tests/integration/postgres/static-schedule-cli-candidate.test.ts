import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

import { Client } from "pg";

import { waitForOutputLine } from "../../../packages/testkit/src";
import { expectPostgresMajor } from "./helpers/postgres-major";

const repository = resolve(import.meta.dir, "../../..");
const postgres = process.env.PGHOST ? test : test.skip;

postgres(
	"packed schedule activation verifies local artifacts and database readiness, replays exactly, and fences stale deployments without Services",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-schedule-cli-"));
		const name = `qp_schedule_cli_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new Client({ database: "postgres" });
		await admin.connect();
		let created = false;
		const url = new URL("postgres://localhost/");
		url.hostname = process.env.PGHOST!;
		url.port = process.env.PGPORT ?? "5432";
		url.username = process.env.PGUSER ?? "postgres";
		if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
		url.pathname = `/${name}`;
		async function run(
			command: string[],
			cwd: string,
			environment: Record<string, string> = {},
		) {
			const child = Bun.spawn(command, {
				cwd,
				env: {
					...process.env,
					DATABASE_URL: url.href,
					QUESTPIE_REALTIME_HMAC_KEY: "",
					...environment,
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			return { code, stdout, stderr };
		}
		async function ok(command: string[], cwd: string) {
			const result = await run(command, cwd);
			expect(result.code, result.stdout + result.stderr).toBe(0);
			return result.stdout;
		}
		try {
			await admin.query(
				`CREATE DATABASE "${name}" TEMPLATE template0 LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
			);
			created = true;
			const probe = new Client({ connectionString: url.href });
			await probe.connect();
			try {
				const facts = await probe.query(
					"SELECT current_database() AS name, current_setting('server_version_num')::integer AS version",
				);
				expect(facts.rows[0].name).toBe(name);
				expectPostgresMajor(facts.rows[0].version);
			} finally {
				await probe.end();
			}
			const packageRoot = join(repository, "packages/questpie");
			await ok(["bun", "run", "build"], packageRoot);
			await ok(
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
			const archive = (await readdir(temporary)).find((file) =>
				file.endsWith(".tgz"),
			);
			expect(archive).toBeDefined();
			const consumer = join(temporary, "consumer");
			await cp(join(repository, "fixtures/collaboration"), consumer, {
				recursive: true,
			});
			await writeFile(
				join(consumer, "package.json"),
				JSON.stringify({
					name: "schedule-activation-proof",
					private: true,
					type: "module",
					dependencies: { questpie: `file:${join(temporary, archive!)}` },
				}),
			);
			await writeFile(
				join(consumer, "src/cli-schedule.ts"),
				`import {codec,durable,principal} from "questpie";
import {defineJob} from "#questpie/app";
export const cliSweep=defineJob({name:"cli.sweep",input:codec.object({}),output:codec.object({}),runAs:durable.caller({whenDenied:"fail"}),retry:durable.retry({maximumAttempts:2,initialDelay:"1s",backoff:"exponential",maximumDelay:"60s",jitter:"full",horizon:"24h"}),schedule:{cron:"* * * * *",execution:{principal:principal.service({name:"cliSweep"}),context:{companyId:"00000000-0000-4000-8000-000000000001"}},input:{}},handler:async()=>{throw new Error("ACTIVATION_MUST_NOT_EXECUTE_JOB");}});
`,
			);
			await ok(["bun", "install", "--ignore-scripts"], consumer);
			const cli = join(consumer, "node_modules/.bin/questpie");
			await ok([cli, "build"], consumer);
			const command = [cli, "schedule", "activate", "--expect-revision", "0"];
			const notReady = await run(command, consumer);
			expect(notReady.code).toBe(1);
			expect(notReady.stderr).toContain("SCHEDULE_DATABASE_NOT_READY");
			await ok(
				[cli, "migration", "apply", "--allow-non-rolling-protocol-v9"],
				consumer,
			);
			await ok([cli, "seed", "apply"], consumer);
			// Only the CLI host polls. The second generated application accepts and inspects.
			await writeFile(
				join(consumer, "worker-probe.ts"),
				`import {principal} from "questpie";
import {createApplication} from "./.questpie/generated/internal/application.js";
const app=await createApplication({postgres:{connectionUrl:process.env.DATABASE_URL,directConnectionUrl:process.env.DATABASE_URL},realtime:{hmacKey:new Uint8Array(32)},maintenance:{authorize:()=>false}});
try {
const receipt=await app.execution({principal:principal.user({id:"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4"}),context:{companyId:"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0"}},({jobs})=>jobs.reports.companyDigest.accept({companyId:"018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0"},{idempotencyKey:"cli-worker-proof"}));
const deadline=Date.now()+10000;
for(;;){const view=await app.durable.inspect(receipt.runId);if(view?.state==="succeeded"){console.log("CLI_WORKER_SUCCEEDED");break;}if(Date.now()>=deadline)throw new Error("CLI_WORKER_DID_NOT_POLL");await Bun.sleep(100);}
} finally {await app.close();}
`,
			);
			const host = Bun.spawn([cli, "start", "--port", "0"], {
				cwd: consumer,
				env: {
					...process.env,
					DATABASE_URL: url.href,
					QUESTPIE_REALTIME_HMAC_KEY: "a".repeat(64),
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			try {
				await waitForOutputLine(host.stdout, {
					accept: (line) => line.includes("questpie: listening on"),
					timeoutMilliseconds: 30000,
				});
				expect(await ok(["bun", "worker-probe.ts"], consumer)).toContain(
					"CLI_WORKER_SUCCEEDED",
				);
				host.kill("SIGTERM");
				expect(await host.exited).toBe(0);
			} finally {
				if (host.exitCode === null) {
					host.kill("SIGKILL");
					await host.exited;
				}
			}
			// Starting an ordinary worker did not activate the schedule: revision is still zero.
			const receipt = JSON.parse(await ok(command, consumer));
			expect(receipt.acceptedRevision).toBe("1");
			expect(receipt.replayed).toBe(false);
			const replay = JSON.parse(await ok(command, consumer));
			expect(replay).toEqual({ ...receipt, replayed: true });
			const stale = await run(
				[cli, "schedule", "activate", "--expect-revision", "2"],
				consumer,
			);
			expect(stale.code).toBe(1);
			expect(stale.stderr).toContain("SCHEDULE_ACTIVATION_STALE");
			expect(stale.stderr).toContain('"revision":"1"');
			expect(stale.stderr).not.toContain("cliSweep");
			let connections = 0;
			const trap = Bun.listen({
				hostname: "127.0.0.1",
				port: 0,
				socket: {
					open(socket) {
						connections += 1;
						socket.end();
					},
					data() {},
				},
			});
			try {
				const environment = {
					DATABASE_URL: `postgres://postgres@127.0.0.1:${trap.port}/unreachable`,
				};
				const invalid = await run(
					[cli, "schedule", "activate"],
					consumer,
					environment,
				);
				expect(invalid.stderr).toContain("SCHEDULE_ARGUMENTS_INVALID");
				const artifactPath = join(
					consumer,
					".questpie/generated/job-schedules.json",
				);
				const validBytes = await readFile(artifactPath, "utf8");
				await writeFile(artifactPath, `${validBytes} `);
				const corrupt = await run(command, consumer, environment);
				expect(corrupt.code).toBe(1);
				expect(corrupt.stderr).toContain("SCHEDULE_ARTIFACT_INVALID");
				// A repaired outer checksum does not bypass the full Runtime Build inventory.
				const checksumPath = join(
					consumer,
					".questpie/generated/internal/checksums.json",
				);
				const checksumBytes = await readFile(checksumPath, "utf8");
				const checksums = JSON.parse(checksumBytes);
				checksums.files.find(
					(entry: { path: string }) => entry.path === "job-schedules.json",
				).digest = createHash("sha256").update(`${validBytes} `).digest("hex");
				await writeFile(checksumPath, JSON.stringify(checksums));
				const crossPin = await run(command, consumer, environment);
				expect(crossPin.stderr).toContain("SCHEDULE_ARTIFACT_INVALID");
				await writeFile(artifactPath, validBytes);
				await writeFile(checksumPath, checksumBytes);
				await writeFile(
					join(consumer, ".questpie/generated/unlisted.json"),
					"{}",
				);
				const unlisted = await run(command, consumer, environment);
				expect(unlisted.stderr).toContain("SCHEDULE_ARTIFACT_INVALID");
				expect(connections).toBe(0);
			} finally {
				trap.stop(true);
			}
		} finally {
			if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
			await admin.end();
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);
