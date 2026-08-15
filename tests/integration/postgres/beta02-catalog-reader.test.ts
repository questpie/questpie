import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { digest } from "../../../packages/compiler/src/canonical";
import { bootstrap } from "../../../packages/compiler/src/schema";
import { readCatalogComparable } from "../../../packages/compiler/src/schema/postgres/catalog-reader";

const database = process.env.PGHOST ? new SQL() : undefined;

beforeAll(async () => {
	if (!database) return;
	const session = await database.reserve();
	try {
		const [connection] = await session<{ database: string; pid: number }[]>`
			select current_database() as database, pg_backend_pid() as pid
		`;
		await bootstrap(session, connection!.database, connection!.pid, {
			lockTimeoutMs: 1_000,
			statementTimeoutMs: 5_000,
		});
	} finally {
		session.release();
	}
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "catalog_reader_probe" CASCADE; DROP SCHEMA IF EXISTS "catalog_fact_probe" CASCADE; DROP SCHEMA IF EXISTS "catalog_external_probe" CASCADE; CREATE SCHEMA "catalog_reader_probe"; CREATE TABLE "catalog_reader_probe"."messages" ("id" integer NOT NULL, "body" text, CONSTRAINT "unsupported_body_check" CHECK (lower("body") = \'ready\')); CREATE VIEW "catalog_reader_probe"."message_ids" AS SELECT "id" FROM "catalog_reader_probe"."messages"; CREATE SCHEMA "catalog_fact_probe"; CREATE TABLE "catalog_fact_probe"."parents" ("id" uuid NOT NULL, CONSTRAINT "parents_pk" PRIMARY KEY ("id")); CREATE TABLE "catalog_fact_probe"."messages" ("id" integer NOT NULL, "parent_id" uuid, "body" text COLLATE pg_catalog."C" DEFAULT \'hello\' NOT NULL, "starts_at" timestamp NOT NULL, "ends_at" timestamp NOT NULL, CONSTRAINT "messages_pk" PRIMARY KEY ("id"), CONSTRAINT "messages_body_check" CHECK (pg_catalog.char_length("body") > 1), CONSTRAINT "messages_time_check" CHECK ("ends_at" > "starts_at"), CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE); CREATE INDEX "messages_body_idx" ON "catalog_fact_probe"."messages" USING btree ("body" DESC NULLS LAST); CREATE SCHEMA "catalog_external_probe"; CREATE TABLE "catalog_external_probe"."parents" ("id" uuid PRIMARY KEY);',
	);
	await database`
		delete from questpie_internal.application_bindings
		where application_name in ('catalog-reader-probe', 'catalog-fact-probe')
		   or postgres_schema in ('catalog_reader_probe', 'catalog_fact_probe')
	`;
	await database`
		insert into questpie_internal.application_bindings
		(application_name, postgres_schema, created_at)
		values
			('catalog-reader-probe', 'catalog_reader_probe', ${new Date()}),
			('catalog-fact-probe', 'catalog_fact_probe', ${new Date()})
	`;
});

afterAll(async () => {
	if (!database) return;
	await database`
		delete from questpie_internal.application_bindings
		where application_name in ('catalog-reader-probe', 'catalog-fact-probe')
	`;
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "catalog_reader_probe" CASCADE; DROP SCHEMA IF EXISTS "catalog_fact_probe" CASCADE; DROP SCHEMA IF EXISTS "catalog_external_probe" CASCADE;',
	);
	await database.close();
});

describe.skipIf(!database)(
	"BETA-02 independent PostgreSQL catalog reader",
	() => {
		test("reads actual catalog state without a Schema Projection", async () => {
			const comparable = await readCatalogComparable(database!, {
				application: "catalog-reader-probe",
				applicationSchema: "catalog_reader_probe",
				requiredExtensionNames: ["missing_questpie_extension", "plpgsql"],
			});

			expect(comparable).toMatchObject({
				application: "catalog-reader-probe",
				applicationSchema: "catalog_reader_probe",
				applicationSchemaExists: true,
				objects: [
					{ kind: "column", name: "body", table: "messages" },
					{ kind: "column", name: "id", table: "messages" },
					{ kind: "schema", name: "catalog_reader_probe" },
					{ kind: "table", name: "messages" },
				],
				unsupportedObjects: [
					{
						attachedTo: "catalog_reader_probe.messages",
						kind: "other",
						qualifiedIdentity: "catalog_reader_probe.messages.body",
					},
					{
						attachedTo: "catalog_reader_probe.messages",
						kind: "other",
						qualifiedIdentity:
							"catalog_reader_probe.messages.unsupported_body_check",
					},
					{
						attachedTo: null,
						kind: "view",
						qualifiedIdentity: "catalog_reader_probe.message_ids",
					},
				],
				installedRequiredExtensions: ["plpgsql"],
			});
			await expect(
				readCatalogComparable(database!, {
					application: "missing-catalog-reader-probe",
					applicationSchema: "missing_catalog_reader_probe",
					requiredExtensionNames: ["plpgsql"],
				}),
			).resolves.toEqual({
				application: "missing-catalog-reader-probe",
				applicationSchema: "missing_catalog_reader_probe",
				applicationSchemaExists: false,
				objects: [],
				unsupportedObjects: [],
				externalDependencies: [],
				installedRequiredExtensions: ["plpgsql"],
			});
		});

		test("reads defaults, checks, foreign keys, indexes, and dependencies from catalogs", async () => {
			const comparable = await readCatalogComparable(database!, {
				application: "catalog-fact-probe",
				applicationSchema: "catalog_fact_probe",
				requiredExtensionNames: [],
			});
			const objects = comparable.objects as readonly Record<string, unknown>[];

			expect(
				objects.find(
					(object) => object.kind === "column" && object.name === "body",
				),
			).toEqual({
				kind: "column",
				table: "messages",
				name: "body",
				type: { kind: "text" },
				nullable: false,
				default: { kind: "literal", value: "hello" },
				identity: "none",
				generated: "none",
				collation: "pg_catalog.C",
			});
			expect(objects.filter((object) => object.kind === "check")).toEqual([
				{
					kind: "check",
					table: "messages",
					name: "messages_body_check",
					expression: {
						kind: "compare",
						operator: "greaterThan",
						left: {
							kind: "textLength",
							expression: { kind: "field", field: "body" },
						},
						right: { kind: "literal", value: 1 },
					},
					validated: true,
				},
				{
					kind: "check",
					table: "messages",
					name: "messages_time_check",
					expression: {
						kind: "compare",
						operator: "greaterThan",
						left: { kind: "field", field: "ends_at" },
						right: { kind: "field", field: "starts_at" },
					},
					validated: true,
				},
			]);
			expect(
				objects.find((object) => object.kind === "foreignKey"),
			).toMatchObject({
				fields: ["parent_id"],
				name: "messages_parent_fk",
				onDelete: "setNull",
				onUpdate: "cascade",
				referencedFields: ["id"],
				referencedTable: "parents",
			});
			expect(objects.find((object) => object.kind === "index")).toEqual({
				kind: "index",
				table: "messages",
				name: "messages_body_idx",
				method: "btree",
				unique: false,
				fields: [
					{
						field: "body",
						order: "desc",
						nulls: "last",
						operatorClass: "typeDefault",
						collation: "field",
					},
				],
				predicate: null,
				valid: true,
				ready: true,
			});
			expect(comparable.externalDependencies).toContainEqual({
				kind: "operatorClass",
				schema: "pg_catalog",
				name: "text_ops",
				extension: null,
			});
			for (const name of ["int4_ops", "uuid_ops"])
				expect(comparable.externalDependencies).toContainEqual({
					kind: "operatorClass",
					schema: "pg_catalog",
					name,
					extension: null,
				});
			expect(digest("questpie-schema-fingerprint-v1", comparable)).toBe(
				"8ec6791b4550dc8f294ae12c2cd7899f0026ae162ee8f9712c234b3f2a4812b9",
			);
		});

		test("returns an unsupported foreign-key action without projection-assisted failure", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET DEFAULT ON UPDATE CASCADE',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages.messages_parent_fk",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "foreignKey" &&
							object.name === "messages_parent_fk",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
				);
			}
		});

		test("returns a foreign key outside the application namespace as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_external_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages.messages_parent_fk",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "foreignKey" &&
							object.name === "messages_parent_fk",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
				);
			}
		});

		test("returns non-local and NO INHERIT checks as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" ADD CONSTRAINT "messages_no_inherit_check" CHECK ("id" > 0) NO INHERIT; CREATE TABLE "catalog_fact_probe"."check_parent" ("probe" integer, CONSTRAINT "inherited_probe_check" CHECK ("probe" > 0)); CREATE TABLE "catalog_fact_probe"."check_child" ("probe" integer) INHERITS ("catalog_fact_probe"."check_parent");',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				for (const [table, name] of [
					["messages", "messages_no_inherit_check"],
					["check_child", "inherited_probe_check"],
				] as const) {
					expect(comparable.unsupportedObjects).toContainEqual({
						kind: "other",
						qualifiedIdentity: `catalog_fact_probe.${table}.${name}`,
						attachedTo: `catalog_fact_probe.${table}`,
					});
					expect(
						(comparable.objects as readonly Record<string, unknown>[]).some(
							(object) =>
								object.kind === "check" &&
								object.table === table &&
								object.name === name,
						),
					).toBe(false);
				}
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_no_inherit_check"; DROP TABLE "catalog_fact_probe"."check_child"; DROP TABLE "catalog_fact_probe"."check_parent";',
				);
			}
		});

		test("returns a MATCH FULL foreign key as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") MATCH FULL ON DELETE SET NULL ON UPDATE CASCADE',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages.messages_parent_fk",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "foreignKey" &&
							object.name === "messages_parent_fk",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
				);
			}
		});

		test("returns a column-specific SET NULL foreign key as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ("parent_id") ON UPDATE CASCADE',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages.messages_parent_fk",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "foreignKey" &&
							object.name === "messages_parent_fk",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_parent_fk", ADD CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
				);
			}
		});

		test("returns a constraint-backed Index with INCLUDE as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" ADD CONSTRAINT "messages_body_unique" UNIQUE ("body") INCLUDE ("id")',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages.messages_body_unique",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "unique" &&
							object.name === "messages_body_unique",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_body_unique"',
				);
			}
		});

		test("returns a NULLS NOT DISTINCT backing Index as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" ADD CONSTRAINT "messages_body_not_distinct" UNIQUE NULLS NOT DISTINCT ("body")',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity:
						"catalog_fact_probe.messages.messages_body_not_distinct",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "unique" &&
							object.name === "messages_body_not_distinct",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_body_not_distinct"',
				);
			}
		});

		test("returns an authored Index with INCLUDE as unsupported", async () => {
			await database!.unsafe(
				'CREATE INDEX "messages_body_include_idx" ON "catalog_fact_probe"."messages" USING btree ("body") INCLUDE ("id")',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages_body_include_idx",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "index" &&
							object.name === "messages_body_include_idx",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'DROP INDEX "catalog_fact_probe"."messages_body_include_idx"',
				);
			}
		});

		test.skipIf(process.env.QUESTPIE_POSTGRES_MAJOR !== "18")(
			"rejects a non-inherited PostgreSQL 18 NOT NULL catalog constraint",
			async () => {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" ALTER CONSTRAINT "messages_id_not_null" NO INHERIT',
				);
				try {
					const comparable = await readCatalogComparable(database!, {
						application: "catalog-fact-probe",
						applicationSchema: "catalog_fact_probe",
						requiredExtensionNames: [],
					});
					expect(comparable.unsupportedObjects).toContainEqual({
						kind: "other",
						qualifiedIdentity:
							"catalog_fact_probe.messages.messages_id_not_null",
						attachedTo: "catalog_fact_probe.messages",
					});
				} finally {
					await database!.unsafe(
						'ALTER TABLE "catalog_fact_probe"."messages" ALTER CONSTRAINT "messages_id_not_null" INHERIT',
					);
				}
			},
		);
	},
);
