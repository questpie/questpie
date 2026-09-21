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
						deleteReferencedAfterTouch(
							input: Readonly<{
								touchId: string;
								deleteId: string;
								label: string;
							}>,
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

// F3: a Collection referenced by another Collection's relation.toOne with the
// default onDelete: "restrict" refuses a delete of a referenced row with a
// PostgreSQL 23503 (foreign_key_violation). There is no savepoint (the
// generated Mutation transaction has savepoints: "notAvailable"), so that
// error must doom and roll back the WHOLE enclosing Mutation transaction:
// an earlier write in the same call is undone, and a later ctx.data call
// never reaches PostgreSQL because the transaction is already aborted.
const SOURCE = `import { codec, constraint, defineCollection, definePolicy, field, policy, relation } from "questpie";

import { defineMutation } from "#questpie/app";

export const deletableRecords = defineCollection({
	name: "deletableRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
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
	update: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		candidate: ({ candidate, current }) => candidate.id.equal(current.id),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
	},
	fields: {
		update: ({ current }) => ({ id: current.id.equal(current.id), label: current.label.equal(current.label) }),
	},
});

export const deleteReferencedAfterTouch = defineMutation({
	name: "deletableRecords.deleteReferencedAfterTouch",
	input: codec.object({ touchId: codec.uuid(), deleteId: codec.uuid(), label: codec.text() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		await ctx.data.deletableRecords.update({
			key: { id: input.touchId },
			patch: { label: input.label },
		});
		const deleted = await ctx.data.deletableRecords.delete({ key: { id: input.deleteId } });
		// Never reached when the delete above throws: proves the enclosing
		// transaction is already doomed, not still open for a later write.
		await ctx.data.deletableRecords.update({
			key: { id: input.touchId },
			patch: { label: "unreachable" },
		});
		return { deleted: deleted !== null };
	},
});
`;

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"F3: an FK-refused delete dooms and rolls back the whole enclosing Mutation transaction",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-f3-abort-"),
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

			const [{ id: touchIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.deletable_records (id, label) VALUES (gen_random_uuid(), 'original') RETURNING id`,
			);
			const [{ id: referencedIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.deletable_records (id, label) VALUES (gen_random_uuid(), 'referenced') RETURNING id`,
			);
			const touchId = String(touchIdRaw);
			const referencedId = String(referencedIdRaw);
			await database!.unsafe(
				`INSERT INTO collaboration.deletable_record_notes (id, record_id) VALUES (gen_random_uuid(), '${referencedId}')`,
			);

			await expect(
				application.execution(root, ({ mutations }) =>
					mutations.deletableRecords.deleteReferencedAfterTouch(
						{ touchId, deleteId: referencedId, label: "touched" },
						{ callId: "f3-abort" },
					),
				),
			).rejects.toThrow();

			// Earlier write in the same Mutation transaction was rolled back.
			const touched = await database!.unsafe(
				`SELECT label FROM collaboration.deletable_records WHERE id = '${touchId}'`,
			);
			expect(touched).toEqual([{ label: "original" }]);
			// Referenced row and its note both survive (no partial state).
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
