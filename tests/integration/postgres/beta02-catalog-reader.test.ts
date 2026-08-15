import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { SQL } from "bun";

import { digest } from "../../../packages/compiler/src/canonical";
import { readCatalogComparable } from "../../../packages/compiler/src/schema/postgres/catalog-reader";

const database = process.env.PGHOST ? new SQL() : undefined;

beforeAll(async () => {
	if (!database) return;
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "catalog_reader_probe" CASCADE; DROP SCHEMA IF EXISTS "catalog_fact_probe" CASCADE; CREATE SCHEMA "catalog_reader_probe"; CREATE TABLE "catalog_reader_probe"."messages" ("id" integer NOT NULL, "body" text, CONSTRAINT "unsupported_body_check" CHECK (lower("body") = \'ready\')); CREATE VIEW "catalog_reader_probe"."message_ids" AS SELECT "id" FROM "catalog_reader_probe"."messages"; CREATE SCHEMA "catalog_fact_probe"; CREATE TABLE "catalog_fact_probe"."parents" ("id" uuid NOT NULL, CONSTRAINT "parents_pk" PRIMARY KEY ("id")); CREATE TABLE "catalog_fact_probe"."messages" ("id" integer NOT NULL, "parent_id" uuid, "body" text COLLATE pg_catalog."C" DEFAULT \'hello\' NOT NULL, "starts_at" timestamp NOT NULL, "ends_at" timestamp NOT NULL, CONSTRAINT "messages_pk" PRIMARY KEY ("id"), CONSTRAINT "messages_body_check" CHECK (pg_catalog.char_length("body") > 1), CONSTRAINT "messages_time_check" CHECK ("ends_at" > "starts_at"), CONSTRAINT "messages_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "catalog_fact_probe"."parents" ("id") ON DELETE SET NULL ON UPDATE CASCADE); CREATE INDEX "messages_body_idx" ON "catalog_fact_probe"."messages" USING btree ("body" DESC NULLS LAST);',
	);
});

afterAll(async () => {
	if (!database) return;
	await database.unsafe(
		'DROP SCHEMA IF EXISTS "catalog_reader_probe" CASCADE; DROP SCHEMA IF EXISTS "catalog_fact_probe" CASCADE;',
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
