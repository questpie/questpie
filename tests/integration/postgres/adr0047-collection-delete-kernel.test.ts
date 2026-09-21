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
const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test.serial : test.skip;

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

const DELETABLE_RECORDS_SOURCE = `import { codec, constraint, defineCollection, definePolicy, field, operation, policy, relation } from "questpie";

import { defineMutation } from "#questpie/app";

export const deletableRecords = defineCollection({
	name: "deletableRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
		locked: field.boolean({ nullable: false, default: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const deletableRecordNotes = defineCollection({
	name: "deletableRecordNotes",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		recordId: field.uuid({ nullable: false, server: false, immutable: true }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {
		record: relation.toOne({
			target: deletableRecords,
			fields: ["recordId"],
			references: ["id"],
		}),
	},
});

export const deletableRecordPolicy = definePolicy(deletableRecords, {
	name: "deletableRecords.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
	update: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		candidate: ({ candidate, current }) => candidate.id.equal(current.id),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.locked.equal(false),
	},
	fields: {
		create: ({ candidate }) => ({
			id: candidate.id.equal(candidate.id),
			label: candidate.label.equal(candidate.label),
			locked: candidate.locked.equal(candidate.locked),
		}),
		update: ({ current }) => ({
			id: current.id.equal(current.id),
			label: current.label.equal(current.label),
			locked: current.locked.equal(current.locked),
		}),
	},
});

export const deleteRecord = defineMutation({
	name: "deletableRecords.deleteRecord",
	network: true,
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {
		recordUnavailable: operation.error({
			code: "RECORD_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.deletableRecords.delete({
			key: { id: input.id },
		});
		return { deleted: deleted !== null };
	},
});
`;

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"executes the Collection delete kernel through a named Mutation against PostgreSQL",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-delete-integration-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/deletable-records.ts"),
				DELETABLE_RECORDS_SOURCE,
			);
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			// Apply the fixture's existing baseline migrations first so the
			// "collaboration" schema exists; only then can "migration plan" diff
			// the newly-added Collections against a deployed baseline.
			runCli(temporary, ["migration", "apply"]);
			const planned = JSON.parse(
				runCli(temporary, [
					"migration",
					"plan",
					"--name",
					"add-deletable-records",
				]),
			);
			expect(planned.status).toBe("planned");
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

			// Seed three rows directly: one plain (deletable), one locked
			// (Policy-denied), and one referenced by a deletableRecordNotes row
			// (FK-restrict, no ON DELETE CASCADE declared).
			const [{ id: plainIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.deletable_records (id, label, locked) VALUES (gen_random_uuid(), 'plain', false) RETURNING id`,
			);
			const [{ id: lockedIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.deletable_records (id, label, locked) VALUES (gen_random_uuid(), 'locked', true) RETURNING id`,
			);
			const [{ id: referencedIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.deletable_records (id, label, locked) VALUES (gen_random_uuid(), 'referenced', false) RETURNING id`,
			);
			const plainId = String(plainIdRaw);
			const lockedId = String(lockedIdRaw);
			const referencedId = String(referencedIdRaw);
			await database!.unsafe(
				`INSERT INTO collaboration.deletable_record_notes (id, record_id) VALUES (gen_random_uuid(), '${referencedId}')`,
			);
			const missingId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61aa";

			// 1. Success: the row is gone.
			const deleted = await application.execution(root, ({ mutations }) =>
				mutations.deletableRecords.deleteRecord(
					{ id: plainId },
					{ callId: "delete-plain" },
				),
			);
			expect(deleted).toEqual({ deleted: true });
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.deletable_records WHERE id = '${plainId}'`,
				),
			).toEqual([]);

			// 2. Missing row: neutral false, no error.
			const missing = await application.execution(root, ({ mutations }) =>
				mutations.deletableRecords.deleteRecord(
					{ id: missingId },
					{ callId: "delete-missing" },
				),
			);
			expect(missing).toEqual({ deleted: false });

			// 3. Policy-denied: neutral false, nothing deleted.
			const denied = await application.execution(root, ({ mutations }) =>
				mutations.deletableRecords.deleteRecord(
					{ id: lockedId },
					{ callId: "delete-locked" },
				),
			);
			expect(denied).toEqual({ deleted: false });
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.deletable_records WHERE id = '${lockedId}'`,
				),
			).toHaveLength(1);

			// 4. Referenced row (FK restrict, no cascade declared): refused, not
			// a partial state — the row and its referencing note both survive.
			await expect(
				application.execution(root, ({ mutations }) =>
					mutations.deletableRecords.deleteRecord(
						{ id: referencedId },
						{ callId: "delete-referenced" },
					),
				),
			).rejects.toThrow();
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.deletable_records WHERE id = '${referencedId}'`,
				),
			).toHaveLength(1);
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.deletable_record_notes WHERE record_id = '${referencedId}'`,
				),
			).toHaveLength(1);
		} finally {
			await application?.close();
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await rm(temporary, { force: true, recursive: true });
		}
	},
	60_000,
);
