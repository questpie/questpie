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
					tenantScopedRecords: Readonly<{
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

// F4: a tenant-scoped delete Policy (`current.companyId.equal(tenant.id)`)
// is the realistic shape, not the fixture's `current.locked.equal(false)`.
// Cross-tenant delete-by-key must be neutral (null), leave the row in
// place, and record no change-ledger fact (the DELETE statement never
// executes when the Policy's row-scope check excludes the row).
const SOURCE = `import { codec, constraint, defineCollection, definePolicy, field, policy } from "questpie";

import { defineMutation } from "#questpie/app";

export const tenantScopedRecords = defineCollection({
	name: "tenantScopedRecords",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		companyId: field.uuid({ nullable: false, server: false, immutable: true }),
		label: field.text({ nullable: false, server: false, immutable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const tenantScopedRecordPolicy = definePolicy(tenantScopedRecords, {
	name: "tenantScopedRecords.default",
	delete: {
		admit: policy.authenticated(),
		rows: ({ current, tenant }) => current.companyId.equal(tenant.id),
	},
});

export const deleteRecord = defineMutation({
	name: "tenantScopedRecords.deleteRecord",
	input: codec.object({ id: codec.uuid() }),
	output: codec.object({ deleted: codec.boolean() }),
	policy: policy.authenticated(),
	errors: {},
	handler: async ({ input, ctx }) => {
		const deleted = await ctx.data.tenantScopedRecords.delete({ key: { id: input.id } });
		return { deleted: deleted !== null };
	},
});
`;

afterAll(async () => database?.close({ timeout: 0 }));

postgresTest(
	"F4: cross-tenant delete-by-key is neutral, leaves the row, and records no change-ledger fact",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-f4-tenancy-"),
		);
		let application: GeneratedApplication | undefined;
		try {
			await database!.unsafe(
				'DROP SCHEMA IF EXISTS "collaboration" CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE;',
			);
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(join(temporary, "src/tenant-scoped-records.ts"), SOURCE);
			const questpieEntry = await installQuestpieForTracer(temporary);
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);
			const planned = JSON.parse(
				runCli(temporary, [
					"migration",
					"plan",
					"--name",
					"add-tenant-scoped-records",
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
			const tenantA = tracerIds.company;
			const tenantB = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61bb";
			await database!.unsafe(
				`INSERT INTO collaboration.companies (id, name) VALUES ('${tenantB}', 'Tenant B') ON CONFLICT (id) DO NOTHING`,
			);
			await database!.unsafe(
				`INSERT INTO collaboration.memberships (company_id, id, principal_id) VALUES ('${tenantB}', gen_random_uuid(), '${tracerIds.principal}') ON CONFLICT DO NOTHING`,
			);
			const rootAsTenantB = {
				principal: principal.user({ id: tracerIds.principal }),
				context: { companyId: tenantB },
			};

			const [{ id: idRaw }] = await database!.unsafe(
				`INSERT INTO collaboration.tenant_scoped_records (id, company_id, label) VALUES (gen_random_uuid(), '${tenantA}', 'tenant-a-row') RETURNING id`,
			);
			const id = String(idRaw);

			// Tenant B attempts to delete tenant A's row by key: neutral null,
			// the same as a missing row or a locked/denied one.
			const denied = await application.execution(
				rootAsTenantB,
				({ mutations }) =>
					mutations.tenantScopedRecords.deleteRecord(
						{ id },
						{ callId: "f4-cross-tenant-delete" },
					),
			);
			expect(denied).toEqual({ deleted: false });
			expect(
				await database!.unsafe(
					`SELECT id FROM collaboration.tenant_scoped_records WHERE id = '${id}'`,
				),
			).toHaveLength(1);
			// The DELETE statement never ran for this row (the Policy's
			// row-scope check excluded it before the write), so no
			// change-ledger fact exists for it.
			expect(
				await database!.unsafe(
					`SELECT fact_id FROM questpie_internal.change_ledger WHERE collection_identity = 'collection:tenantScopedRecords' AND change_kind = 'delete' AND (old_key->>'id') = '${id}'`,
				),
			).toEqual([]);
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
