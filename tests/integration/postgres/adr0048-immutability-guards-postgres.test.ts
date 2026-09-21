import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SQL } from "bun";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import {
	APPEND_ONLY_SQLSTATE,
	ensureInternalProtocolV3,
	projectPostgresChangeCapture,
	projectPostgresImmutabilityGuards,
	renderAddAppendOnlyGuard,
	renderAddWriteOnceGuard,
	verifyPostgresImmutabilityGuards,
	WRITE_ONCE_FIELD_SQLSTATE,
} from "../../../packages/compiler/src/schema";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<{ name: string }[]>`
		select current_database() as name
	`;
	await ensureInternalProtocolV3(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

async function expectSqlstate(
	query: PromiseLike<unknown>,
	sqlstate: string,
	messageContains: string,
): Promise<void> {
	let rejected: unknown;
	try {
		await query;
	} catch (error) {
		rejected = error;
	}
	expect(rejected).toMatchObject({ errno: sqlstate });
	expect(
		String((rejected as { message?: string } | undefined)?.message),
	).toContain(messageContains);
}

function runCli(
	root: string,
	arguments_: readonly string[],
	expected = 0,
): string {
	const result = Bun.spawnSync(["bun", cli, ...arguments_], {
		cwd: root,
		env: { ...process.env, DATABASE_URL: postgresUrl() },
		stdout: "pipe",
		stderr: "pipe",
	});
	expect(
		result.exitCode,
		`${arguments_.join(" ")}\n${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(expected);
	return result.stdout.toString();
}

beforeEach(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS adr0048 CASCADE;
DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
});

afterAll(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS adr0048 CASCADE;
DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
	await database?.close({ timeout: 0 });
});

describe.skipIf(!database)(
	"ADR-0048 database immutability guards on PostgreSQL",
	() => {
		postgresTest(
			"refuses direct UPDATE/DELETE/TRUNCATE on an append-only table, allows INSERT, isolates a write-once column, and still records change capture for a committed INSERT but not a refused write",
			async () => {
				await ensure(database!);
				await database!.unsafe(`CREATE SCHEMA adr0048;
CREATE TABLE adr0048.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
);
CREATE TABLE adr0048.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  note text NOT NULL
);`);

				const changeCapture = projectPostgresChangeCapture({
					applicationName: "adr0048",
					postgresSchema: "adr0048",
					collections: [
						{
							identity: "collection:evidence",
							postgresName: "evidence",
							keyColumns: ["id"],
						},
					],
				});
				await database!.unsafe(changeCapture.sql);

				const schema = {
					format: "questpie.schema-projection",
					version: 1,
					application: { name: "adr0048", postgresSchema: "adr0048" },
					requiredPostgres: {
						minimumMajor: 17,
						databaseCollation: "C.UTF-8",
						databaseCType: "C.UTF-8",
						extensions: [],
					},
					collections: [
						{
							identity: "collection:evidence",
							postgresName: "evidence",
							appendOnly: true,
							fields: [],
							constraints: [],
							indexes: [],
							relations: [],
						},
						{
							identity: "collection:notes",
							postgresName: "notes",
							fields: [
								{
									identity: "collection:notes/field:label",
									path: ["label"],
									postgresName: "label",
									type: { kind: "text" },
									nullable: false,
									default: null,
									databaseImmutable: true,
								},
							],
							constraints: [],
							indexes: [],
							relations: [],
						},
					],
					// biome-ignore lint: test fixture cast
				} as unknown as Parameters<typeof projectPostgresImmutabilityGuards>[0];
				const guards = projectPostgresImmutabilityGuards(schema);
				await database!.unsafe(
					renderAddAppendOnlyGuard(guards, "collection:evidence"),
				);
				await database!.unsafe(
					renderAddWriteOnceGuard(guards, "collection:notes/field:label"),
				);

				// kernel-equivalent INSERT succeeds and is captured
				const [inserted] = await database!<{ id: string }[]>`
				insert into adr0048.evidence (kind) values ('published') returning id
			`;
				expect(inserted).toBeTruthy();
				const [afterInsert] = await database!<{ count: number }[]>`
				select count(*)::integer as count from questpie_internal.change_ledger
				where application_name = 'adr0048' and collection_identity = 'collection:evidence'
			`;
				expect(afterInsert!.count).toBe(1);

				// direct UPDATE is refused before change capture ever sees it
				await expectSqlstate(
					database!.unsafe(
						`update adr0048.evidence set kind = 'tampered' where id = '${inserted!.id}'`,
					),
					APPEND_ONLY_SQLSTATE,
					"Collection collection:evidence is append-only",
				);
				const [afterRefusedUpdate] = await database!<{ count: number }[]>`
				select count(*)::integer as count from questpie_internal.change_ledger
				where application_name = 'adr0048' and collection_identity = 'collection:evidence'
			`;
				expect(afterRefusedUpdate!.count).toBe(1); // unchanged: no fact for a refused write

				// direct DELETE and TRUNCATE are refused with the same SQLSTATE
				await expectSqlstate(
					database!.unsafe(
						`delete from adr0048.evidence where id = '${inserted!.id}'`,
					),
					APPEND_ONLY_SQLSTATE,
					"Collection collection:evidence is append-only",
				);
				await expectSqlstate(
					database!.unsafe("truncate adr0048.evidence"),
					APPEND_ONLY_SQLSTATE,
					"Collection collection:evidence is append-only",
				);

				// write-once column: the guarded column refuses a direct UPDATE,
				// but a different column on the same (non-append-only) row updates freely
				const [note] = await database!<{ id: string }[]>`
				insert into adr0048.notes (label, note) values ('original', 'first') returning id
			`;
				await expectSqlstate(
					database!.unsafe(
						`update adr0048.notes set label = 'changed' where id = '${note!.id}'`,
					),
					WRITE_ONCE_FIELD_SQLSTATE,
					"is database-immutable",
				);
				await database!.unsafe(
					`update adr0048.notes set note = 'revised' where id = '${note!.id}'`,
				);
				const [row] = await database!<{ label: string; note: string }[]>`
				select label, note from adr0048.notes where id = ${note!.id}
			`;
				expect(row).toEqual({ label: "original", note: "revised" });

				// the guard fires under session_replication_role = replica too
				// (logical-replication apply workers and, on PG15+, any role
				// granted SET ON PARAMETER session_replication_role run with
				// this set without needing superuser; a trigger created with
				// PostgreSQL's default firing status ('O') would be silently
				// skipped)
				const [second] = await database!<{ id: string }[]>`
					insert into adr0048.evidence (kind) values ('published') returning id
				`;
				await database!.unsafe("set session_replication_role = 'replica'");
				try {
					await expectSqlstate(
						database!.unsafe(
							`update adr0048.evidence set kind = 'tampered' where id = '${second!.id}'`,
						),
						APPEND_ONLY_SQLSTATE,
						"Collection collection:evidence is append-only",
					);
					await expectSqlstate(
						database!.unsafe(
							`delete from adr0048.evidence where id = '${second!.id}'`,
						),
						APPEND_ONLY_SQLSTATE,
						"Collection collection:evidence is append-only",
					);
					await expectSqlstate(
						database!.unsafe("truncate adr0048.evidence"),
						APPEND_ONLY_SQLSTATE,
						"Collection collection:evidence is append-only",
					);
				} finally {
					await database!.unsafe("reset session_replication_role");
				}

				// out-of-band DROP TRIGGER is detected as drift
				await verifyPostgresImmutabilityGuards(database!, guards);
				await database!.unsafe(
					`drop trigger "${guards.appendOnlyCollections[0]!.rowGuardTrigger}" on adr0048.evidence`,
				);
				await expect(
					verifyPostgresImmutabilityGuards(database!, guards),
				).rejects.toMatchObject({ code: "QP-SCHEMA-028" });

				// flipping a guard's firing status back to origin-only ('O') out
				// of band -- e.g. an operator running ALTER TABLE ... ENABLE
				// TRIGGER <name> instead of ENABLE ALWAYS TRIGGER -- is also drift
				await database!.unsafe(
					`alter table adr0048.notes enable trigger "${guards.writeOnceFields[0]!.triggerName}"`,
				);
				await expect(
					verifyPostgresImmutabilityGuards(database!, guards),
				).rejects.toMatchObject({ code: "QP-SCHEMA-028" });
			},
			120_000,
		);

		postgresTest(
			"a parent's DELETE is refused by ON DELETE RESTRICT before it can reach an append-only child's guard",
			async () => {
				await ensure(database!);
				await database!.unsafe(`CREATE SCHEMA adr0048;
CREATE TABLE adr0048.parents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE adr0048.children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES adr0048.parents(id) ON DELETE RESTRICT
);`);
				const schema = {
					application: { postgresSchema: "adr0048" },
					collections: [
						{
							identity: "collection:children",
							postgresName: "children",
							appendOnly: true,
							fields: [],
						},
					],
					// biome-ignore lint: test fixture cast
				} as unknown as Parameters<typeof projectPostgresImmutabilityGuards>[0];
				const guards = projectPostgresImmutabilityGuards(schema);
				await database!.unsafe(
					renderAddAppendOnlyGuard(guards, "collection:children"),
				);
				const [parent] = await database!<{ id: string }[]>`
					insert into adr0048.parents default values returning id
				`;
				await database!.unsafe(
					`insert into adr0048.children (parent_id) values ('${parent!.id}')`,
				);
				// ON DELETE RESTRICT refuses the parent delete with the standard
				// PostgreSQL foreign-key SQLSTATE, never reaching (and therefore
				// never needing) the child's append-only guard -- this is the
				// database behavior a relation owned by an append-only Collection
				// must declare (onDelete: "restrict"); onDelete: "cascade" or
				// "setNull" would instead try to touch the guarded child row and
				// get refused by the guard itself, which is exactly the
				// compose-time diagnostic this ADR now raises instead.
				let rejected: unknown;
				try {
					await database!.unsafe(
						`delete from adr0048.parents where id = '${parent!.id}'`,
					);
				} catch (error) {
					rejected = error;
				}
				expect(rejected).toMatchObject({ errno: "23503" });
			},
			60_000,
		);

		postgresTest(
			"migration plan -> migration create -> migration apply installs the guard, apply is idempotent, and removing the declaration requires --accept-destructive",
			async () => {
				const temporary = await mkdtemp(
					join(tmpdir(), "questpie-adr0048-cli-"),
				);
				try {
					await cp(fixtureRoot, temporary, { recursive: true });
					await installQuestpieForTracer(temporary);
					await writeFile(
						join(temporary, "src/evidence-log.ts"),
						`import { collection, constraint, defineCollection, field } from "questpie";

export const evidenceLog = defineCollection({
	name: "evidenceLog",
	appendOnly: true,
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		kind: field.text({ nullable: false, minLength: 1, maxLength: 32, immutable: "database" }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
`,
					);

					runCli(temporary, ["build"]);
					runCli(temporary, ["migration", "apply"]);

					const planned = JSON.parse(
						runCli(temporary, [
							"migration",
							"plan",
							"--name",
							"add-evidence-log",
						]),
					);
					expect(planned.status).toBe("planned");
					// "guarded" comes from the new primary key constraint scan on the
					// brand-new evidenceLog table, not from the guard itself: adding
					// appendOnly/immutable: "database" plans as its own "safe" steps
					// (asserted below via the step kinds).
					expect(["safe", "guarded"]).toContain(planned.classification);
					expect(
						(planned.plan.steps as Array<{ kind: string }>).map((s) => s.kind),
					).toEqual(
						expect.arrayContaining(["addAppendOnlyGuard", "addWriteOnceGuard"]),
					);
					const created = JSON.parse(
						runCli(temporary, ["migration", "create", "--plan", planned.path]),
					);
					expect(created.status).toBe("created");

					const applied = runCli(temporary, ["migration", "apply"]);
					expect(applied).toContain("committed migrations applied");
					const reapplied = runCli(temporary, ["migration", "apply"]);
					expect(reapplied).toContain("committed migrations already applied");

					const [guardTrigger] = await database!<{ name: string }[]>`
					select t.tgname as name
					from pg_catalog.pg_trigger t
					join pg_catalog.pg_class c on c.oid = t.tgrelid
					join pg_catalog.pg_namespace n on n.oid = c.relnamespace
					where n.nspname = 'collaboration' and c.relname = 'evidence_log'
					  and t.tgname like '%append_only%' and not t.tgisinternal
				`;
					expect(guardTrigger).toBeTruthy();

					// kernel-equivalent INSERT still works on an append-only Collection
					await database!.unsafe(
						"insert into collaboration.evidence_log (kind) values ('published')",
					);

					// evidenceLog.kind is both on an append-only Collection and itself
					// database-immutable; both BEFORE ROW triggers exist on this table
					// and PostgreSQL fires same-timing/same-event triggers in trigger
					// name order (evidence_log_kind_questpie_write_once_* sorts before
					// evidence_log_questpie_append_only_* because "k" < "q"), so the
					// write-once guard raises first. Either refusal proves the update
					// never reaches the row; the append-only guard's own SQLSTATE is
					// proven in isolation (no competing write-once guard) by the raw
					// SQL test above.
					let rejected: unknown;
					try {
						await database!.unsafe(
							"update collaboration.evidence_log set kind = 'changed'",
						);
					} catch (error) {
						rejected = error;
					}
					expect([APPEND_ONLY_SQLSTATE, WRITE_ONCE_FIELD_SQLSTATE]).toContain(
						(rejected as { errno?: string } | undefined)?.errno,
					);

					// removing the declaration is destructive: refused without acknowledgment
					await writeFile(
						join(temporary, "src/evidence-log.ts"),
						`import { collection, constraint, defineCollection, field } from "questpie";

export const evidenceLog = defineCollection({
	name: "evidenceLog",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		kind: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
`,
					);
					const removePlan = JSON.parse(
						runCli(temporary, [
							"migration",
							"plan",
							"--name",
							"remove-evidence-log-guard",
						]),
					);
					expect(removePlan.status).toBe("planned");
					expect(removePlan.classification).toBe("destructive");
					const unacknowledged = Bun.spawnSync(
						["bun", cli, "migration", "create", "--plan", removePlan.path],
						{
							cwd: temporary,
							env: { ...process.env, DATABASE_URL: postgresUrl() },
							stdout: "pipe",
							stderr: "pipe",
						},
					);
					expect(unacknowledged.exitCode).not.toBe(0);
					expect(unacknowledged.stderr.toString()).toContain("QP-SCHEMA-020");

					const removeCreated = JSON.parse(
						runCli(temporary, [
							"migration",
							"create",
							"--plan",
							removePlan.path,
							"--accept-destructive",
							removePlan.digest,
						]),
					);
					expect(removeCreated.status).toBe("created");
					runCli(temporary, ["migration", "apply"]);
					await database!.unsafe(
						"update collaboration.evidence_log set kind = 'now-mutable'",
					);
				} finally {
					await rm(temporary, { recursive: true, force: true });
				}
			},
			120_000,
		);

		postgresTest(
			"a second Seed's idempotent upsert of an already-seeded append-only row succeeds; a conflicting upsert is a clear Seed diagnostic, not QP001",
			async () => {
				const temporary = await mkdtemp(
					join(tmpdir(), "questpie-adr0048-seed-"),
				);
				try {
					await cp(fixtureRoot, temporary, { recursive: true });
					await installQuestpieForTracer(temporary);
					await writeFile(
						join(temporary, "src/ledger-entries.ts"),
						`import { collection, constraint, defineCollection, field } from "questpie";

export const ledgerEntries = defineCollection({
	name: "ledgerEntries",
	appendOnly: true,
	fields: {
		id: field.uuid({ nullable: false }),
		note: field.text({ nullable: false, minLength: 1, maxLength: 64 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
`,
					);
					await writeFile(
						join(temporary, "src/ledger-seed-one.ts"),
						`import { defineSeed, seed } from "questpie";
import { ledgerEntries } from "./ledger-entries";

export const ledgerSeedOne = defineSeed({
	name: "ledgerEntries.seedOne",
	steps: [
		seed.upsert(ledgerEntries, {
			key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200" },
			create: { note: "shared baseline" },
			update: { note: "shared baseline" },
		}),
	],
});
`,
					);

					runCli(temporary, ["build"]);
					runCli(temporary, ["migration", "apply"]);
					const planned = JSON.parse(
						runCli(temporary, ["migration", "plan", "--name", "add-ledger"]),
					);
					const created = JSON.parse(
						runCli(temporary, ["migration", "create", "--plan", planned.path]),
					);
					expect(created.status).toBe("created");
					runCli(temporary, ["migration", "apply"]);
					runCli(temporary, ["seed", "create"]);
					const applyOne = runCli(temporary, ["seed", "apply"]);
					expect(applyOne).toContain("already applied");

					// a second, different Seed re-asserting the same key with the
					// same resulting values must succeed (idempotent upsert intent),
					// not QP001
					await writeFile(
						join(temporary, "src/ledger-seed-two.ts"),
						`import { defineSeed, seed } from "questpie";
import { ledgerEntries } from "./ledger-entries";

export const ledgerSeedTwo = defineSeed({
	name: "ledgerEntries.seedTwo",
	steps: [
		seed.upsert(ledgerEntries, {
			key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200" },
			create: { note: "shared baseline" },
			update: { note: "shared baseline" },
		}),
	],
});
`,
					);
					runCli(temporary, ["seed", "create"]);
					const applyTwo = runCli(temporary, ["seed", "apply"]);
					expect(applyTwo).toContain("1 new, ");

					// a THIRD Seed upserting the same key with a DIFFERENT value is a
					// genuine conflict: a clear Seed diagnostic, not a raw QP001
					await writeFile(
						join(temporary, "src/ledger-seed-three.ts"),
						`import { defineSeed, seed } from "questpie";
import { ledgerEntries } from "./ledger-entries";

export const ledgerSeedThree = defineSeed({
	name: "ledgerEntries.seedThree",
	steps: [
		seed.upsert(ledgerEntries, {
			key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200" },
			create: { note: "conflicting value" },
			update: { note: "conflicting value" },
		}),
	],
});
`,
					);
					runCli(temporary, ["seed", "create"]);
					const failure = Bun.spawnSync(["bun", cli, "seed", "apply"], {
						cwd: temporary,
						env: { ...process.env, DATABASE_URL: postgresUrl() },
						stdout: "pipe",
						stderr: "pipe",
					});
					expect(failure.exitCode).not.toBe(0);
					const failureOutput =
						failure.stdout.toString() + failure.stderr.toString();
					expect(failureOutput).toContain("QP-SEED-015");
					expect(failureOutput).not.toContain("QP001");
				} finally {
					await rm(temporary, { recursive: true, force: true });
				}
			},
			120_000,
		);
	},
);
