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
					guardedRecords: Readonly<{
						mappedDelete(
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

// current-only validate: safe to interpret with `candidate: null` (delete)
// as well as with `current` populated (update). No `create` Policy is
// declared, so `current` is never null here (that null case is create-only).
const GUARDED_RECORDS_SOURCE = `import { codec, collection, constraint, defineCollection, definePolicy, field, operation, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const guardedRecords = defineCollection({
	name: "guardedRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
		locked: field.boolean({ nullable: false, default: false, server: false, immutable: false }),
	},
	issues: {
		cannotDeleteLocked: collection.issue(),
	},
	lifecycle: {
		validate: ({ current, issues }) => {
			if (current !== null && current.locked) throw issues.cannotDeleteLocked();
		},
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const guardedRecordPolicy = definePolicy(guardedRecords, {
	name: "guardedRecords.default",
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
		update: ({ current }) => ({
			id: current.id.equal(current.id),
			label: current.label.equal(current.label),
			locked: current.locked.equal(current.locked),
		}),
	},
});

export const mappedDelete = defineMutation({
	name: "guardedRecords.mappedDelete",
	network: true,
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {
		cannotDeleteLocked: operation.error({ code: "CANNOT_DELETE_LOCKED", status: 409 }),
	},
	issueMappings: {
		guardedRecords: { cannotDeleteLocked: "cannotDeleteLocked" },
	},
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.guardedRecords.delete({ key: { id: input.id } });
		return { deleted: deleted !== null };
	},
});
`;

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"F1/F2: delete interprets a Collection's validate phase against the locked current row",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-f1f2-validate-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/guarded-records.ts"),
				GUARDED_RECORDS_SOURCE,
			);
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			const planned = JSON.parse(
				runCli(temporary, [
					"migration",
					"plan",
					"--name",
					"add-guarded-records",
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

			const [{ id: openIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.guarded_records (id, label, locked) VALUES (gen_random_uuid(), 'open', false) RETURNING id`,
			);
			const [{ id: lockedIdRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.guarded_records (id, label, locked) VALUES (gen_random_uuid(), 'locked', true) RETURNING id`,
			);
			const openId = String(openIdRaw);
			const lockedId = String(lockedIdRaw);

			// validate passes (current.locked === false) -> deletes.
			const opened = await application.execution(root, ({ mutations }) =>
				mutations.guardedRecords.mappedDelete(
					{ id: openId },
					{ callId: "delete-open" },
				),
			);
			expect(opened).toEqual({ deleted: true });
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.guarded_records WHERE id = '${openId}'`,
				),
			).toEqual([]);

			// validate throws the mapped issue (current.locked === true) -> the
			// declared error surfaces and nothing is deleted.
			await expect(
				application.execution(root, ({ mutations }) =>
					mutations.guardedRecords.mappedDelete(
						{ id: lockedId },
						{ callId: "delete-locked" },
					),
				),
			).rejects.toThrow("CANNOT_DELETE_LOCKED");
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.guarded_records WHERE id = '${lockedId}'`,
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
