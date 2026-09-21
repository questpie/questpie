import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	loadCommittedMigration,
} from "@questpie/compiler";
import type { RenameIdentityV1, SchemaProjectionV1 } from "@questpie/compiler";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import {
	APPEND_ONLY_SQLSTATE,
	assertPostgresImmutabilityGuards,
	projectPostgresImmutabilityGuards,
	renderAddAppendOnlyGuard,
	renderAddWriteOnceGuard,
	renderDropAppendOnlyGuard,
	renderDropWriteOnceGuard,
	WRITE_ONCE_FIELD_SQLSTATE,
} from "../../packages/compiler/src/schema/postgres/append-only";
import { installQuestpieForTracer } from "../support/beta12-packed-questpie";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

function baseSchema(): SchemaProjectionV1 {
	return {
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
				fields: [
					{
						identity: "collection:evidence/field:id",
						path: ["id"],
						postgresName: "id",
						type: { kind: "uuid" },
						nullable: false,
						default: { kind: "randomUuid" },
					},
					{
						identity: "collection:evidence/field:kind",
						path: ["kind"],
						postgresName: "kind",
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
	} as unknown as SchemaProjectionV1;
}

describe("ADR-0048 database immutability guards", () => {
	test("projects one append-only guard and one write-once guard with the reserved SQLSTATE codes", () => {
		const schema = baseSchema();
		const projection = projectPostgresImmutabilityGuards(schema);
		expect(projection.appendOnlyCollections).toHaveLength(1);
		expect(projection.writeOnceFields).toHaveLength(1);
		expect(projection.catalog).toHaveLength(3); // row guard + truncate guard + field guard
		const appendOnlySql = renderAddAppendOnlyGuard(
			projection,
			"collection:evidence",
		);
		expect(appendOnlySql).toContain("BEFORE UPDATE OR DELETE ON");
		expect(appendOnlySql).toContain("BEFORE TRUNCATE ON");
		expect(appendOnlySql).toContain(`ERRCODE = '${APPEND_ONLY_SQLSTATE}'`);
		expect(appendOnlySql).toContain(
			"Collection collection:evidence is append-only",
		);
		expect(appendOnlySql).toContain("REVOKE ALL ON FUNCTION");
		expect(appendOnlySql).toContain("SECURITY INVOKER");
		expect(appendOnlySql).toContain("ENABLE ALWAYS TRIGGER");
		expect(projection.catalog.every((row) => row.triggerEnabled === "A")).toBe(
			true,
		);

		const writeOnceSql = renderAddWriteOnceGuard(
			projection,
			"collection:evidence/field:kind",
		);
		expect(writeOnceSql).toContain("BEFORE UPDATE ON");
		expect(writeOnceSql).toContain(`ERRCODE = '${WRITE_ONCE_FIELD_SQLSTATE}'`);
		expect(writeOnceSql).toContain("IS DISTINCT FROM OLD");
		expect(writeOnceSql).toContain("is database-immutable");

		expect(renderDropAppendOnlyGuard(projection, "collection:evidence")).toBe(
			`DROP TRIGGER "${projection.appendOnlyCollections[0]!.rowGuardTrigger}" ON "adr0048"."evidence";\n` +
				`DROP TRIGGER "${projection.appendOnlyCollections[0]!.truncateGuardTrigger}" ON "adr0048"."evidence";\n` +
				`DROP FUNCTION "adr0048"."${projection.appendOnlyCollections[0]!.functionName}"();`,
		);
		expect(
			renderDropWriteOnceGuard(projection, "collection:evidence/field:kind"),
		).toContain("DROP TRIGGER");
	});

	test("the two reserved SQLSTATE codes fall in PostgreSQL's implementation-defined class range and are distinct", () => {
		// PostgreSQL Appendix A: a SQLSTATE class code (first two characters)
		// is standard-defined only when its first character is a digit 0-4 or
		// a letter A-H. Classes whose first character is a digit 5-9 or a
		// letter I-Z are reserved for implementation/application use. "Q" is
		// in the I-Z range.
		for (const code of [APPEND_ONLY_SQLSTATE, WRITE_ONCE_FIELD_SQLSTATE]) {
			expect(code).toMatch(/^[A-Z0-9]{5}$/);
			const first = code[0]!;
			const isStandardDefined =
				(first >= "0" && first <= "4") || (first >= "A" && first <= "H");
			expect(isStandardDefined).toBe(false);
		}
		expect(APPEND_ONLY_SQLSTATE).not.toBe(WRITE_ONCE_FIELD_SQLSTATE);
	});

	test("fingerprint changes when the guard set changes and is stable otherwise", () => {
		const schema = baseSchema();
		const a = projectPostgresImmutabilityGuards(schema);
		const b = projectPostgresImmutabilityGuards(baseSchema());
		expect(a.fingerprint).toBe(b.fingerprint);
		const withoutGuard = baseSchema();
		(withoutGuard.collections[0] as { appendOnly?: boolean }).appendOnly =
			false;
		const c = projectPostgresImmutabilityGuards(withoutGuard);
		expect(c.fingerprint).not.toBe(a.fingerprint);
		expect(c.appendOnlyCollections).toHaveLength(0);
	});

	test("assertPostgresImmutabilityGuards reports QP-SCHEMA-028 changedObject when the catalog was dropped out of band", () => {
		const projection = projectPostgresImmutabilityGuards(baseSchema());
		expect(() => assertPostgresImmutabilityGuards(projection, [])).toThrowError(
			CompilerDiagnosticError,
		);
		try {
			assertPostgresImmutabilityGuards(projection, []);
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect((error as CompilerDiagnosticError).code).toBe("QP-SCHEMA-028");
			expect((error as CompilerDiagnosticError).diagnosticClass).toBe(
				"changedObject",
			);
		}
		// present and matching: does not throw
		expect(() =>
			assertPostgresImmutabilityGuards(projection, projection.catalog),
		).not.toThrow();
	});

	test("declares an append-only Collection and a write-once Field through the authoring DSL end to end", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-immutability-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/message-events.ts"),
				`import {
	collection,
	constraint,
	defineCollection,
	field,
	relation,
} from "questpie";

import { messages } from "./messages";

export const messageEvents = defineCollection({
	name: "messageEvents",
	appendOnly: true,
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		messageId: field.uuid({ nullable: false }),
		kind: field.text({ nullable: false, minLength: 1, maxLength: 32, immutable: "database" }),
		occurredAt: field.timestamp({ nullable: false, withTimezone: true }),
	},
	issues: {
		invalidKind: collection.issue(),
	},
	lifecycle: {
		validate: ({ candidate, issues }) => {
			if (candidate.kind !== "published" && candidate.kind !== "delivered")
				throw issues.invalidKind();
		},
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	relations: {
		message: relation.toOne({
			target: messages,
			fields: ["messageId"],
			references: ["id"],
		}),
	},
});
`,
			);
			const compilation = await compileApplication({
				applicationRoot: temporary,
			});
			const schema = JSON.parse(
				compilation.generatedFiles["schema-projection.json"] ?? "null",
			);
			const collection = schema.collections.find(
				(value: { identity: string }) =>
					value.identity === "collection:messageEvents",
			);
			expect(collection.appendOnly).toBe(true);
			const kindField = collection.fields.find(
				(value: { identity: string }) =>
					value.identity === "collection:messageEvents/field:kind",
			);
			expect(kindField.databaseImmutable).toBe(true);
			// `immutable: "database"` is a strict superset of `immutable: true`:
			// the kernel-only provenance projection (data-contract-projection,
			// ADR-0030) carries the plain `immutable` flag, not the schema
			// projection used for DDL planning.
			const manifest = JSON.parse(
				compilation.generatedFiles["manifest.json"] ?? "null",
			);
			const dataCollection = manifest.data.collections.find(
				(value: { identity: string }) =>
					value.identity === "collection:messageEvents",
			);
			const dataField = dataCollection.fields.find(
				(value: { identity: string }) =>
					value.identity === "collection:messageEvents/field:kind",
			);
			expect(dataField.immutable).toBe(true);
			expect(schema.immutabilityGuards.appendOnlyCollections).toEqual([
				expect.objectContaining({ identity: "collection:messageEvents" }),
			]);
			expect(schema.immutabilityGuards.writeOnceFields).toEqual([
				expect.objectContaining({
					identity: "collection:messageEvents/field:kind",
				}),
			]);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	test("plans safe add and destructive remove for append-only and write-once declarations, and idempotent no-op otherwise", async () => {
		const frozen = await loadCommittedMigration(
			resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
		);
		const baseSchemaValue = structuredClone(
			frozen.targetSchema,
		) as SchemaProjectionV1;
		const targetSchemaValue = structuredClone(baseSchemaValue);
		const messagesCollection = (
			targetSchemaValue.collections as Array<Record<string, unknown>>
		).find((collection) => collection.identity === "collection:messages");
		if (!messagesCollection)
			throw new Error("messages fixture Collection is missing");
		(messagesCollection as { appendOnly?: boolean }).appendOnly = true;
		const bodyField = (
			messagesCollection.fields as Array<Record<string, unknown>>
		).find((field) => (field.path as string[])[0] === "body");
		if (!bodyField) throw new Error("body fixture Field is missing");
		(bodyField as { databaseImmutable?: boolean }).databaseImmutable = true;
		(targetSchemaValue as { immutabilityGuards?: unknown }).immutabilityGuards =
			projectPostgresImmutabilityGuards(targetSchemaValue);

		function commitDelta(
			base: SchemaProjectionV1,
			target: SchemaProjectionV1,
			slug: string,
			renames: readonly Readonly<{
				from: RenameIdentityV1;
				to: RenameIdentityV1;
			}>[],
			acceptDestructive?: boolean,
		) {
			const genesisPlan = createMigrationPlan({
				targetSchema: base,
				slug: "create-adr0048-fixture",
			});
			const genesis = createCommittedMigration({
				plan: genesisPlan.plan,
				baseSchema: genesisPlan.baseSchema,
				targetSchema: base,
				currentSchema: base,
				planDigest: genesisPlan.digest,
				localMigrations: [],
			});
			const planned = createMigrationPlan({
				baseMigration: genesis.identity,
				baseSchema: base,
				targetSchema: target,
				slug,
				renames,
			});
			if (planned.status !== "planned") throw new Error("plan disappeared");
			return {
				planned,
				genesis,
				commit: () =>
					createCommittedMigration({
						plan: planned.plan,
						baseSchema: base,
						targetSchema: target,
						currentSchema: target,
						planDigest: planned.digest,
						localMigrations: [genesis],
						...(acceptDestructive ? { acceptDestructive: planned.digest } : {}),
					}),
			};
		}

		const install = commitDelta(
			baseSchemaValue,
			targetSchemaValue,
			"install-immutability-guards",
			[],
			true,
		);
		expect(install.planned.plan.classification).toBe("safe");
		expect(install.planned.plan.steps.map((step) => step.kind)).toEqual(
			expect.arrayContaining(["addAppendOnlyGuard", "addWriteOnceGuard"]),
		);
		const installed = install.commit();
		expect(installed.files["up.sql"]).toContain("BEFORE UPDATE OR DELETE");
		expect(installed.files["up.sql"]).toContain(APPEND_ONLY_SQLSTATE);
		expect(installed.files["up.sql"]).toContain(WRITE_ONCE_FIELD_SQLSTATE);

		// idempotent: diffing the same target against itself plans nothing
		// (createMigrationPlan reports "noChanges" rather than an empty step
		// list when base and target are byte-identical).
		const noopPlan = createMigrationPlan({
			baseMigration: install.genesis.identity,
			baseSchema: targetSchemaValue,
			targetSchema: structuredClone(targetSchemaValue),
			slug: "noop-immutability-guards",
			renames: [],
		});
		expect(noopPlan.status).toBe("noChanges");

		// removing the declaration is destructive and requires acknowledgment
		const removeWithoutAck = commitDelta(
			targetSchemaValue,
			baseSchemaValue,
			"remove-immutability-guards",
			[],
			false,
		);
		expect(removeWithoutAck.planned.plan.classification).toBe("destructive");
		expect(
			removeWithoutAck.planned.plan.steps.map((step) => step.kind),
		).toEqual(
			expect.arrayContaining(["dropAppendOnlyGuard", "dropWriteOnceGuard"]),
		);
		expect(() => removeWithoutAck.commit()).toThrowError(
			CompilerDiagnosticError,
		);
		try {
			removeWithoutAck.commit();
			throw new Error("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect((error as CompilerDiagnosticError).code).toBe("QP-SCHEMA-020");
		}
		const removeWithAck = commitDelta(
			targetSchemaValue,
			baseSchemaValue,
			"remove-immutability-guards-ack",
			[],
			true,
		);
		const removed = removeWithAck.commit();
		expect(removed.files["up.sql"]).toContain("DROP TRIGGER");
		expect(removed.files["up.sql"]).toContain("DROP FUNCTION");
	});

	test("refuses update and delete Mutation members on an append-only Collection as a compiler diagnostic", async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-immutability-capability-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await installQuestpieForTracer(temporary);
			const messagesSource = await Bun.file(
				join(temporary, "src/messages.ts"),
			).text();
			await writeFile(
				join(temporary, "src/messages.ts"),
				messagesSource.replace(
					'defineCollection({\n\tname: "messages",',
					'defineCollection({\n\tname: "messages",\n\tappendOnly: true,',
				),
			);
			await writeFile(
				join(temporary, "src/message-operations.ts"),
				`import { defineCollectionOperations, mutation } from "questpie";

import { channelMessagePage } from "./message-page";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,
	list: { data: channelMessagePage },
	get: { select: { id: true, body: true, createdAt: true } },
	update: {
		input: ["body"],
		values: ({ operationTime }) => ({
			createdAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, body: true, createdAt: true },
	},
});
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-013",
				diagnosticClass: "structuralTypeError",
				message: expect.stringContaining(
					"messages.update is not offered: Collection collection:messages is append-only",
				),
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	test("refuses a delete Mutation member on an append-only Collection as a compiler diagnostic", async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-immutability-capability-delete-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await installQuestpieForTracer(temporary);
			const messagesSource = await Bun.file(
				join(temporary, "src/messages.ts"),
			).text();
			await writeFile(
				join(temporary, "src/messages.ts"),
				messagesSource.replace(
					'defineCollection({\n\tname: "messages",',
					'defineCollection({\n\tname: "messages",\n\tappendOnly: true,',
				),
			);
			await writeFile(
				join(temporary, "src/message-operations.ts"),
				`import { defineCollectionOperations } from "questpie";

import { channelMessagePage } from "./message-page";
import { messagePolicy } from "./message-policy";
import { messages } from "./messages";

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,
	list: { data: channelMessagePage },
	get: { select: { id: true, body: true, createdAt: true } },
	delete: { select: { id: true } },
});
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-013",
				diagnosticClass: "structuralTypeError",
				message: expect.stringContaining(
					"messages.delete is not offered: Collection collection:messages is append-only",
				),
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});
});
