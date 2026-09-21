// Cross-feature rule from the 2026-09-22 integration of ADR-0047 (the
// Collection `delete` kernel) and ADR-0048 (compiler-owned database-level
// immutability). Proves, against a real PostgreSQL database, that for an
// append-only Collection: (a) the compiler emits no `delete` kernel, and
// (b) a direct SQL `DELETE` against the applied table is refused with
// QP001 (`APPEND_ONLY_SQLSTATE`) — the framework never relies on the
// missing kernel alone; the database-level guard from ADR-0048 is the
// actual enforcement boundary. Mirrors the CLI-driven flow in
// `tests/integration/postgres/adr0048-immutability-guards-postgres.test.ts`
// ("migration plan -> migration create -> migration apply installs the
// guard...") and the compiler-level check in
// `tests/unit/adr0047-adr0048-delete-append-only-refusal.test.ts`.

import { beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { SQL } from "bun";

import { compileApplication } from "@questpie/compiler";

import { APPEND_ONLY_SQLSTATE } from "../../../packages/compiler/src/schema/postgres/append-only";
import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const fixtureRoot = resolve(repositoryRoot, "fixtures/collaboration");
const cli = resolve(repositoryRoot, "packages/questpie/dist/cli.js");
const database = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
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

const EVIDENCE_LOG_SOURCE = `import { constraint, defineCollection, definePolicy, field, policy } from "questpie";

export const evidenceLog = defineCollection({
	name: "evidenceLog",
	appendOnly: true,
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		kind: field.text({ nullable: false, minLength: 1, maxLength: 32 }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});

export const evidenceLogPolicy = definePolicy(evidenceLog, {
	name: "evidenceLog.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
	fields: {
		create: ({ candidate }) => ({
			id: candidate.id.equal(candidate.id),
			kind: candidate.kind.equal(candidate.kind),
		}),
	},
});
`;

beforeEach(async () => {
	await database?.unsafe(`DROP SCHEMA IF EXISTS collaboration CASCADE;
DROP SCHEMA IF EXISTS questpie_internal CASCADE;`);
});

postgresTest(
	"an append-only Collection's applied table has no delete kernel and refuses a direct SQL DELETE with QP001",
	async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-adr0047-adr0048-delete-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await installQuestpieForTracer(temporary);
			await writeFile(
				join(temporary, "src/evidence-log.ts"),
				EVIDENCE_LOG_SOURCE,
			);

			// Compiler-level: no `delete` (and no `update`) kernel is projected
			// for evidenceLog.
			const compilation = await compileApplication({
				applicationRoot: temporary,
			});
			const operationPrograms = JSON.parse(
				compilation.generatedFiles["collection-operation-programs.json"] ??
					"null",
			) as { operations: Array<{ identity: string }> };
			const kernelIdentities = operationPrograms.operations
				.map((entry) => entry.identity)
				.filter((identity) => identity.includes("evidenceLog"));
			expect(kernelIdentities).toContain(
				"mutation:__collectionKernel.evidenceLog.create",
			);
			expect(
				kernelIdentities.some((identity) => identity.includes(".delete")),
			).toBe(false);
			expect(
				kernelIdentities.some((identity) => identity.includes(".update")),
			).toBe(false);

			// Runtime-level: apply the migration against real PostgreSQL and
			// prove the database-level guard, not the missing kernel, is what
			// actually refuses a delete.
			runCli(temporary, ["build"]);
			runCli(temporary, ["migration", "apply"]);

			const planned = JSON.parse(
				runCli(temporary, ["migration", "plan", "--name", "add-evidence-log"]),
			);
			expect(planned.status).toBe("planned");
			const created = JSON.parse(
				runCli(temporary, ["migration", "create", "--plan", planned.path]),
			);
			expect(created.status).toBe("created");
			runCli(temporary, ["migration", "apply"]);

			const [inserted] = await database!<{ id: string }[]>`
				insert into collaboration.evidence_log (kind) values ('published')
				returning id
			`;
			expect(inserted).toBeTruthy();

			let rejected: unknown;
			try {
				await database!.unsafe(
					`delete from collaboration.evidence_log where id = '${inserted!.id}'`,
				);
			} catch (error) {
				rejected = error;
			}
			expect(rejected).toMatchObject({ errno: APPEND_ONLY_SQLSTATE });
			expect(
				String((rejected as { message?: string } | undefined)?.message),
			).toContain("Collection collection:evidenceLog is append-only");

			const [stillThere] = await database!<{ count: number }[]>`
				select count(*)::integer as count from collaboration.evidence_log
				where id = ${inserted!.id}
			`;
			expect(stillThere!.count).toBe(1);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
);
