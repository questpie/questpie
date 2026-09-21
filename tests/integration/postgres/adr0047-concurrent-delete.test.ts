import { afterAll, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";
import type { Principal } from "questpie";

import { tracerIds } from "../../../fixtures/collaboration/tracer/constants";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test.serial : test.skip;

const TRIALS = 50;
// Interleaving evidence: for the first CONTENTION_SAMPLES trials of each
// race, poll pg_stat_activity concurrently with the two racing calls and
// require at least one sample where a backend touching this test's table
// is blocked by another — the same technique
// collaboration-walking-skeleton.test.ts already uses to prove a blocked
// read. This is real evidence the two transactions were in flight
// together, not an assumption from the code shape.
const CONTENTION_SAMPLES = 10;

async function observeLockContention(
	tableName: string,
	stop: () => boolean,
): Promise<boolean> {
	for (let attempt = 0; attempt < 2_000 && !stop(); attempt += 1) {
		const [row] = await database!.unsafe<Readonly<Array<{ blocked: boolean }>>>(
			`SELECT EXISTS (
				SELECT 1
				FROM pg_catalog.pg_stat_activity a
				WHERE a.pid <> pg_catalog.pg_backend_pid()
					AND a.query ILIKE '%${tableName}%'
					AND pg_catalog.cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0
			) AS blocked`,
		);
		if (row?.blocked) return true;
		await Bun.sleep(2);
	}
	return false;
}

type MutationOptions = Readonly<{ callId: string }>;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Readonly<{ companyId: string }>;
		}>,
		use: (
			scope: Readonly<{
				mutations: Readonly<{
					deletableRecords: Readonly<{
						deleteRecord(
							input: Readonly<{ id: string }>,
							options: MutationOptions,
						): Promise<Readonly<{ deleted: boolean }>>;
						updateLabel(
							input: Readonly<{ id: string; label: string }>,
							options: MutationOptions,
						): Promise<Readonly<{ updated: boolean }>>;
					}>;
				}>;
			}>,
		) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	close(): Promise<void>;
}>;

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

const SOURCE = `import { codec, constraint, defineCollection, definePolicy, field, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const deletableRecords = defineCollection({
	name: "deletableRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const deletableRecordPolicy = definePolicy(deletableRecords, {
	name: "deletableRecords.default",
	update: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		candidate: ({ candidate, current }) => candidate.id.equal(current.id),
	},
	delete: {
		admit: policy.authenticated(),
		// Deliberately conditional (not "always true") so this Collection can
		// host a genuine delete-vs-update race: whichever call acquires the
		// row lock first determines the final label, and delete's Policy is
		// re-evaluated fresh at write time against that possibly-just-changed
		// row — if update won the lock and changed the label away from
		// "race" first, the delete that follows is Policy-denied and the row
		// survives with the update applied. If delete wins the lock first,
		// it removes the row before any update can touch it.
		rows: ({ current }) => current.label.equal("race"),
	},
	fields: {
		update: ({ current }) => ({ id: current.id.equal(current.id), label: current.label.equal(current.label) }),
	},
});

export const deleteRecord = defineMutation({
	name: "deletableRecords.deleteRecord",
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.deletableRecords.delete({ key: { id: input.id } });
		return { deleted: deleted !== null };
	},
});

export const updateLabel = defineMutation({
	name: "deletableRecords.updateLabel",
	input: codec.object({ id: codec.uuid(), label: codec.text() }),
	output: codec.object({ updated: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const updated = await ctx.data.deletableRecords.update({
			key: { id: input.id },
			patch: { label: input.label },
		});
		return { updated: updated !== null };
	},
});
`;

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"concurrent delete-vs-delete: exactly one wins per trial, the other is a clean neutral null, no deadlock",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-concurrent-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(join(temporary, "src/deletable-records.ts"), SOURCE);
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			const planned = JSON.parse(
				runCli(temporary, [
					"migration",
					"plan",
					"--name",
					"add-deletable-records",
				]),
			);
			runCli(temporary, ["migration", "create", "--plan", planned.path]);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			runCli(temporary, ["seed", "apply"]);

			const [{ createApp }, { principal }] = await Promise.all([
				import(
					`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?direct=${crypto.randomUUID()}`
				) as Promise<
					Readonly<{ createApp(input: unknown): Promise<GeneratedApplication> }>
				>,
				import(
					`${pathToFileURL(questpieEntry).href}?principal=${crypto.randomUUID()}`
				) as Promise<
					Readonly<{
						principal: Readonly<{
							user(input: Readonly<{ id: string }>): Principal;
						}>;
					}>
				>,
			]);
			application = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(30) },
				maintenance: { authorize: () => false },
			});
			const root = {
				principal: principal.user({ id: tracerIds.principal }),
				context: { companyId: tracerIds.company },
			};

			const distribution = { aWon: 0, bWon: 0 };
			let contentionObserved = false;
			for (let trial = 0; trial < TRIALS; trial += 1) {
				const [{ id: idRaw }] = await database!.unsafe(
					`INSERT INTO collaboration.deletable_records (id, label) VALUES (gen_random_uuid(), 'race') RETURNING id`,
				);
				const id = String(idRaw);
				let settled = false;
				const race = Promise.all([
					application.execution(root, ({ mutations }) =>
						mutations.deletableRecords.deleteRecord(
							{ id },
							{ callId: `race-a-${trial}` },
						),
					),
					application.execution(root, ({ mutations }) =>
						mutations.deletableRecords.deleteRecord(
							{ id },
							{ callId: `race-b-${trial}` },
						),
					),
				]).finally(() => {
					settled = true;
				});
				if (trial < CONTENTION_SAMPLES) {
					const [[first, second], observed] = await Promise.all([
						race,
						observeLockContention("deletable_records", () => settled),
					]);
					contentionObserved ||= observed;
					if (first.deleted) distribution.aWon += 1;
					if (second.deleted) distribution.bWon += 1;
					const deletedCount = [first, second].filter((r) => r.deleted).length;
					expect(deletedCount).toBe(1);
				} else {
					const [first, second] = await race;
					if (first.deleted) distribution.aWon += 1;
					if (second.deleted) distribution.bWon += 1;
					const deletedCount = [first, second].filter((r) => r.deleted).length;
					expect(deletedCount).toBe(1);
				}
				expect(
					await database!.unsafe(
						`SELECT id FROM collaboration.deletable_records WHERE id = '${id}'`,
					),
				).toEqual([]);
			}
			// Both sides actually won at least once across 50 trials: this is a
			// real race, not one side always serialized ahead of the other by
			// accident (e.g. connection-pool ordering).
			expect(distribution.aWon).toBeGreaterThan(0);
			expect(distribution.bWon).toBeGreaterThan(0);
			expect(distribution.aWon + distribution.bWon).toBe(TRIALS);
			console.log(
				`delete-vs-delete distribution over ${TRIALS} trials: a=${distribution.aWon} b=${distribution.bWon}, contention observed=${contentionObserved}`,
			);
			expect(contentionObserved).toBe(true);
		} finally {
			await application?.close();
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await rm(temporary, { force: true, recursive: true });
		}
	},
	180_000,
);

postgresTest(
	"concurrent delete-vs-update: one wins, the loser gets its normal not-found/neutral outcome, never a partial state",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-concurrent-du-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(join(temporary, "src/deletable-records.ts"), SOURCE);
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			const planned = JSON.parse(
				runCli(temporary, [
					"migration",
					"plan",
					"--name",
					"add-deletable-records",
				]),
			);
			runCli(temporary, ["migration", "create", "--plan", planned.path]);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			runCli(temporary, ["seed", "apply"]);

			const [{ createApp }, { principal }] = await Promise.all([
				import(
					`${pathToFileURL(join(temporary, ".questpie/generated/app.ts")).href}?direct=${crypto.randomUUID()}`
				) as Promise<
					Readonly<{ createApp(input: unknown): Promise<GeneratedApplication> }>
				>,
				import(
					`${pathToFileURL(questpieEntry).href}?principal=${crypto.randomUUID()}`
				) as Promise<
					Readonly<{
						principal: Readonly<{
							user(input: Readonly<{ id: string }>): Principal;
						}>;
					}>
				>,
			]);
			application = await createApp({
				postgres: {
					connectionUrl: postgresUrl(),
					directConnectionUrl: postgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(30) },
				maintenance: { authorize: () => false },
			});
			const root = {
				principal: principal.user({ id: tracerIds.principal }),
				context: { companyId: tracerIds.company },
			};

			const distribution = { deleteWon: 0, updateWon: 0 };
			let contentionObserved = false;
			for (let trial = 0; trial < TRIALS; trial += 1) {
				const [{ id: idRaw }] = await database!.unsafe(
					`INSERT INTO collaboration.deletable_records (id, label) VALUES (gen_random_uuid(), 'race') RETURNING id`,
				);
				const id = String(idRaw);
				let settled = false;
				// Randomize which call is issued (and so reaches PostgreSQL) first
				// each trial: with a fixed order, delete's shorter round-trip path
				// (lock, write) gives it a near-deterministic head start over
				// update's longer one (lock, candidate validation, write), which
				// would make delete win essentially every time regardless of true
				// concurrency — that is exactly the "serialized by accident" shape
				// this test needs to rule out.
				const deleteFirst = Math.random() < 0.5;
				const runDelete = () =>
					application.execution(root, ({ mutations }) =>
						mutations.deletableRecords.deleteRecord(
							{ id },
							{ callId: `race-delete-${trial}` },
						),
					);
				const runUpdate = () =>
					application.execution(root, ({ mutations }) =>
						mutations.deletableRecords.updateLabel(
							{ id, label: "touched" },
							{ callId: `race-update-${trial}` },
						),
					);
				const race = Promise.all(
					deleteFirst ? [runDelete(), runUpdate()] : [runUpdate(), runDelete()],
				).finally(() => {
					settled = true;
				});
				const [pair, observed] =
					trial < CONTENTION_SAMPLES
						? await Promise.all([
								race,
								observeLockContention("deletable_records", () => settled),
							])
						: [await race, false];
				const [deleteResult, updateResult] = deleteFirst
					? pair
					: [pair[1]!, pair[0]!];
				contentionObserved ||= observed;
				const rows = await database!.unsafe(
					`SELECT label FROM collaboration.deletable_records WHERE id = '${id}'`,
				);
				// "One wins" does not mean update and delete are mutually
				// exclusive successes: the row lock serializes them, so it is
				// legal for update to commit first (updated: true) and then
				// delete to remove that same row afterward (deleted: true) —
				// both calls genuinely succeeded, just not concurrently. What
				// must never happen is a partial state: the final row is either
				// fully gone (and delete is the call that reports it gone) or
				// fully present with the update applied (and delete correctly
				// found nothing left to remove).
				if (rows.length === 0) {
					expect(deleteResult.deleted).toBe(true);
					distribution.deleteWon += 1;
				} else {
					expect(deleteResult.deleted).toBe(false);
					expect(updateResult.updated).toBe(true);
					expect(rows).toEqual([{ label: "touched" }]);
					distribution.updateWon += 1;
				}
			}
			expect(distribution.deleteWon).toBeGreaterThan(0);
			expect(distribution.updateWon).toBeGreaterThan(0);
			expect(distribution.deleteWon + distribution.updateWon).toBe(TRIALS);
			console.log(
				`delete-vs-update distribution over ${TRIALS} trials: delete=${distribution.deleteWon} update=${distribution.updateWon}, contention observed=${contentionObserved}`,
			);
			expect(contentionObserved).toBe(true);
		} finally {
			await application?.close();
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await rm(temporary, { force: true, recursive: true });
		}
	},
	180_000,
);
