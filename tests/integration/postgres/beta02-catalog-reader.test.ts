import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { digest } from "../../../packages/compiler/src/canonical";
import { ensureInternalProtocolV3 } from "../../../packages/compiler/src/schema";
import { readCatalogComparable } from "../../../packages/compiler/src/schema/postgres/catalog-reader";

const database = process.env.PGHOST ? new SQL() : undefined;

beforeAll(async () => {
	if (!database) return;
	const session = await database.reserve();
	try {
		const [connection] = await session<{ database: string; pid: number }[]>`
			select current_database() as database, pg_backend_pid() as pid
		`;
		await ensureInternalProtocolV3(
			session,
			connection!.database,
			connection!.pid,
			{
				lockTimeoutMs: 1_000,
				statementTimeoutMs: 5_000,
			},
		);
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

		test("returns NO INHERIT checks and inherited tables as unsupported", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" ADD CONSTRAINT "messages_no_inherit_check" CHECK ("id" > 0) NO INHERIT; CREATE TABLE "catalog_fact_probe"."check_parent" ("probe" integer, CONSTRAINT "inherited_probe_check" CHECK ("probe" > 0)); CREATE TABLE "catalog_fact_probe"."check_child" ("probe" integer) INHERITS ("catalog_fact_probe"."check_parent");',
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
						"catalog_fact_probe.messages.messages_no_inherit_check",
					attachedTo: "catalog_fact_probe.messages",
				});
				for (const table of ["check_child", "check_parent"])
					expect(comparable.unsupportedObjects).toContainEqual({
						kind: "other",
						qualifiedIdentity: `catalog_fact_probe.${table}`,
						attachedTo: null,
					});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							(object.kind === "check" &&
								object.name === "messages_no_inherit_check") ||
							["check_child", "check_parent"].includes(String(object.name)) ||
							["check_child", "check_parent"].includes(String(object.table)),
					),
				).toBe(false);
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

		test("does not project children of an unsupported table state", async () => {
			await database!.unsafe(
				'CREATE UNLOGGED TABLE "catalog_fact_probe"."unsupported_table" ("id" integer)',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.unsupported_table",
					attachedTo: null,
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.name === "unsupported_table" ||
							object.table === "unsupported_table",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'DROP TABLE "catalog_fact_probe"."unsupported_table"',
				);
			}
		});

		test("rejects a nondefault table replica identity", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" REPLICA IDENTITY FULL',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(comparable.unsupportedObjects).toContainEqual({
					kind: "other",
					qualifiedIdentity: "catalog_fact_probe.messages",
					attachedTo: null,
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.name === "messages" || object.table === "messages",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" REPLICA IDENTITY DEFAULT',
				);
			}
		});

		test("rejects table inheritance and partition parentage in either direction", async () => {
			await database!.unsafe(
				'CREATE TABLE "catalog_external_probe"."inheritance_parent" (); CREATE TABLE "catalog_fact_probe"."inherited_app_child" ("id" integer) INHERITS ("catalog_external_probe"."inheritance_parent"); CREATE TABLE "catalog_fact_probe"."inherited_app_parent" ("id" integer); CREATE TABLE "catalog_external_probe"."inherited_external_child" () INHERITS ("catalog_fact_probe"."inherited_app_parent"); CREATE TABLE "catalog_external_probe"."partition_parent" ("id" integer) PARTITION BY RANGE ("id"); CREATE TABLE "catalog_fact_probe"."partition_leaf" PARTITION OF "catalog_external_probe"."partition_parent" FOR VALUES FROM (0) TO (10)',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				for (const table of [
					"inherited_app_child",
					"inherited_app_parent",
					"partition_leaf",
				])
					expect(comparable.unsupportedObjects).toContainEqual({
						kind: "other",
						qualifiedIdentity: `catalog_fact_probe.${table}`,
						attachedTo: null,
					});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							[
								"inherited_app_child",
								"inherited_app_parent",
								"partition_leaf",
							].includes(String(object.name)) ||
							[
								"inherited_app_child",
								"inherited_app_parent",
								"partition_leaf",
							].includes(String(object.table)),
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'DROP TABLE "catalog_external_probe"."inherited_external_child"; DROP TABLE "catalog_fact_probe"."inherited_app_child"; DROP TABLE "catalog_fact_probe"."partition_leaf"; DROP TABLE "catalog_fact_probe"."inherited_app_parent"; DROP TABLE "catalog_external_probe"."inheritance_parent"; DROP TABLE "catalog_external_probe"."partition_parent"',
				);
			}
		});

		test("does not project an unsupported column state", async () => {
			await database!.unsafe(
				'ALTER TABLE "catalog_fact_probe"."messages" ADD COLUMN "unsupported_collation" text COLLATE pg_catalog."default"',
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
						"catalog_fact_probe.messages.unsupported_collation",
					attachedTo: "catalog_fact_probe.messages",
				});
				expect(
					(comparable.objects as readonly Record<string, unknown>[]).some(
						(object) =>
							object.kind === "column" &&
							object.table === "messages" &&
							object.name === "unsupported_collation",
					),
				).toBe(false);
			} finally {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" DROP COLUMN "unsupported_collation"',
				);
			}
		});

		test("enumerates a standalone composite type exactly once", async () => {
			await database!.unsafe(
				'CREATE TYPE "catalog_fact_probe"."delivery_result" AS ("provider_id" text, "accepted" boolean)',
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				expect(
					(
						comparable.unsupportedObjects as readonly Record<string, unknown>[]
					).filter(
						(object) =>
							object.qualifiedIdentity === "catalog_fact_probe.delivery_result",
					),
				).toEqual([
					{
						kind: "compositeType",
						qualifiedIdentity: "catalog_fact_probe.delivery_result",
						attachedTo: null,
					},
				]);
			} finally {
				await database!.unsafe(
					'DROP TYPE "catalog_fact_probe"."delivery_result"',
				);
			}
		});

		test("enumerates overloaded routines with their exact prokind identity", async () => {
			await database!.unsafe(
				"CREATE FUNCTION catalog_fact_probe.routine_probe(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT $1'; CREATE FUNCTION catalog_fact_probe.routine_probe(text) RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT $1'; CREATE PROCEDURE catalog_fact_probe.routine_probe(IN enabled boolean) LANGUAGE plpgsql AS 'BEGIN NULL; END'; CREATE AGGREGATE catalog_fact_probe.aggregate_probe(integer) (SFUNC = pg_catalog.int4pl, STYPE = integer, INITCOND = '0'); CREATE FUNCTION catalog_fact_probe.window_probe(integer) RETURNS integer LANGUAGE sql WINDOW IMMUTABLE AS 'SELECT $1';",
			);
			try {
				const comparable = await readCatalogComparable(database!, {
					application: "catalog-fact-probe",
					applicationSchema: "catalog_fact_probe",
					requiredExtensionNames: [],
				});
				const routines = (
					comparable.unsupportedObjects as readonly Record<string, unknown>[]
				).filter((object) =>
					String(object.qualifiedIdentity).includes("_probe("),
				);
				expect(routines).toEqual([
					{
						kind: "function",
						qualifiedIdentity:
							"function:catalog_fact_probe.routine_probe(integer)",
						attachedTo: null,
					},
					{
						kind: "function",
						qualifiedIdentity:
							"function:catalog_fact_probe.routine_probe(text)",
						attachedTo: null,
					},
					{
						kind: "other",
						qualifiedIdentity: "a:catalog_fact_probe.aggregate_probe(integer)",
						attachedTo: null,
					},
					{
						kind: "other",
						qualifiedIdentity: "w:catalog_fact_probe.window_probe(integer)",
						attachedTo: null,
					},
					{
						kind: "procedure",
						qualifiedIdentity:
							"procedure:catalog_fact_probe.routine_probe(boolean)",
						attachedTo: null,
					},
				]);
			} finally {
				await database!.unsafe(
					"DROP AGGREGATE catalog_fact_probe.aggregate_probe(integer); DROP FUNCTION catalog_fact_probe.window_probe(integer); DROP FUNCTION catalog_fact_probe.routine_probe(integer); DROP FUNCTION catalog_fact_probe.routine_probe(text); DROP PROCEDURE catalog_fact_probe.routine_probe(boolean);",
				);
			}
		});

		test.skipIf(process.env.QUESTPIE_POSTGRES_MAJOR !== "18")(
			"rejects a PostgreSQL 18 NOT ENFORCED check constraint",
			async () => {
				await database!.unsafe(
					'ALTER TABLE "catalog_fact_probe"."messages" ADD CONSTRAINT "messages_unenforced_check" CHECK ("id" > 0) NOT ENFORCED',
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
							"catalog_fact_probe.messages.messages_unenforced_check",
						attachedTo: "catalog_fact_probe.messages",
					});
					expect(
						(comparable.objects as readonly Record<string, unknown>[]).some(
							(object) => object.name === "messages_unenforced_check",
						),
					).toBe(false);
				} finally {
					await database!.unsafe(
						'ALTER TABLE "catalog_fact_probe"."messages" DROP CONSTRAINT "messages_unenforced_check"',
					);
				}
			},
		);

		test.skipIf(process.env.QUESTPIE_POSTGRES_MAJOR !== "18")(
			"rejects PostgreSQL 18 PERIOD constraints",
			async () => {
				await database!.unsafe(
					'CREATE TABLE "catalog_fact_probe"."temporal_parent" ("bucket" daterange, "valid_at" daterange, CONSTRAINT "temporal_parent_pk" PRIMARY KEY ("bucket", "valid_at" WITHOUT OVERLAPS)); CREATE TABLE "catalog_fact_probe"."temporal_child" ("bucket" daterange, "valid_at" daterange, CONSTRAINT "temporal_child_fk" FOREIGN KEY ("bucket", PERIOD "valid_at") REFERENCES "catalog_fact_probe"."temporal_parent" ("bucket", PERIOD "valid_at"))',
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
							"catalog_fact_probe.temporal_child.temporal_child_fk",
						attachedTo: "catalog_fact_probe.temporal_child",
					});
					expect(
						(comparable.objects as readonly Record<string, unknown>[]).some(
							(object) => object.name === "temporal_child_fk",
						),
					).toBe(false);
				} finally {
					await database!.unsafe(
						'DROP TABLE "catalog_fact_probe"."temporal_child", "catalog_fact_probe"."temporal_parent"',
					);
				}
			},
		);

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
