import { afterAll, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SQL } from "bun";

import {
	CleanupStack,
	eventually,
	waitForOutputLine,
} from "../../../packages/testkit/src";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 4 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function runCli(root: string, arguments_: readonly string[]): string {
	const result = Bun.spawnSync(["bun", cli, ...arguments_], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: postgresUrl() },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(
		result.exitCode,
		`${arguments_.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
	return result.stdout.toString();
}

type Child = Bun.Subprocess<"ignore", "pipe", "pipe">;

async function stop(child: Child, signal: NodeJS.Signals): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill(signal);
	await child.exited;
}

async function startHost(
	root: string,
	port: number,
	pauseWorker: boolean,
): Promise<Readonly<{ child: Child; port: number }>> {
	const child = Bun.spawn(["bun", "tracer/host.ts", `--port=${port}`], {
		cwd: root,
		env: {
			...process.env,
			DATABASE_URL: postgresUrl(),
			...(pauseWorker ? { QUESTPIE_TRACER_PAUSE_WORKER: "1" } : {}),
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const line = await waitForOutputLine(child.stdout, {
		accept: (candidate) => candidate.includes('"event":"ready"'),
		description: "collaboration tracer host readiness",
		timeoutMilliseconds: 30_000,
	});
	const ready = JSON.parse(line) as Readonly<{ port?: unknown }>;
	if (!Number.isSafeInteger(ready.port) || Number(ready.port) <= 0)
		throw new TypeError("collaboration tracer readiness port is invalid");
	return Object.freeze({ child, port: Number(ready.port) });
}

async function report(port: number): Promise<string | null> {
	try {
		const response = await fetch(
			`http://127.0.0.1:${port}/__questpie_tracer/report`,
		);
		if (!response.ok) return null;
		const body = (await response.json()) as Readonly<{ phase?: unknown }>;
		return typeof body.phase === "string" ? body.phase : null;
	} catch {
		return null;
	}
}

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

postgresTest(
	"runs compile, migrate, seed, Query, Mutation, browser Live Query, and Reaction recovery",
	async () => {
		const cleanup = new CleanupStack();
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-walking-skeleton-"),
		);
		cleanup.defer(() => rm(temporary, { force: true, recursive: true }));
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await installQuestpieForTracer(temporary);

			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			expect(runCli(temporary, ["seed", "apply"])).toContain(
				"2 new, 0 already applied",
			);
			expect(runCli(temporary, ["seed", "apply"])).toContain(
				"0 new, 2 already applied",
			);

			const first = await startHost(temporary, 0, true);
			cleanup.defer(() => stop(first.child, "SIGKILL"));
			const profile = join(temporary, "firefox-profile");
			await mkdir(profile);
			const body = `browser restart ${crypto.randomUUID()}`;
			const browser = Bun.spawn(
				[
					"/usr/bin/firefox",
					"--headless",
					"--no-remote",
					"--profile",
					profile,
					`http://127.0.0.1:${first.port}/?body=${encodeURIComponent(body)}`,
				],
				{
					env: { ...process.env, MOZ_HEADLESS: "1" },
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			cleanup.defer(() => stop(browser, "SIGKILL"));

			expect(
				await eventually(() => report(first.port), {
					accept: (phase) => phase === "mutation-observed",
					description: "browser-observed committed Mutation",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				}),
			).toBe("mutation-observed");

			await stop(first.child, "SIGKILL");
			const recovered = await startHost(temporary, first.port, false);
			cleanup.defer(() => stop(recovered.child, "SIGTERM"));

			expect(
				await eventually(() => report(recovered.port), {
					accept: (phase) => phase === "recovered",
					description: "browser Live Query reconnect",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				}),
			).toBe("recovered");

			const terminal = await eventually(
				async () => {
					const [row] = await database!.unsafe<
						readonly Readonly<{ state: string; delivered: number }>[]
					>(
						`SELECT runs.state,
  (SELECT count(*)::int
   FROM collaboration.message_events AS events
   WHERE events.message_id = (convert_from(intents.payload_bytes, 'UTF8')::jsonb->>'messageId')::uuid
     AND events.kind = 'delivered') AS delivered
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
ORDER BY runs.accepted_at DESC
LIMIT 1`,
					);
					return row ?? null;
				},
				{
					accept: (row) => row?.state === "succeeded" && row.delivered === 1,
					description: "restarted host Reaction recovery",
					intervalMilliseconds: 50,
					timeoutMilliseconds: 30_000,
				},
			);
			expect(terminal).toEqual({ state: "succeeded", delivered: 1 });
		} finally {
			await cleanup.dispose();
		}
	},
	180_000,
);
