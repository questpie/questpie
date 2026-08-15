import { SQL } from "bun";

import { canonicalBytes, digest } from "../../canonical";
import type { SchemaProjectionV1 } from "../contracts";
import type { SchemaFingerprintV1 } from "../postgres-types";
import {
	readCatalogComparable,
	readCatalogComparableInOwnedTransaction,
} from "./catalog-reader";
import { expectedComparable } from "./expected-fingerprint";
import { fail } from "./shared";

type JsonRecord = Readonly<Record<string, unknown>>;
type ProviderObservations = SchemaFingerprintV1["observations"];

export async function assertSchemaMatches(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<JsonRecord> {
	return compareSchemaToCatalog(sql, schema, readCatalogComparable);
}

export async function assertSchemaMatchesInOwnedTransaction(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<JsonRecord> {
	return compareSchemaToCatalog(
		sql,
		schema,
		readCatalogComparableInOwnedTransaction,
	);
}

async function compareSchemaToCatalog(
	sql: SQL,
	schema: SchemaProjectionV1,
	reader: typeof readCatalogComparable,
): Promise<JsonRecord> {
	const expected = expectedComparable(schema);
	const actual = await reader(sql, {
		application: schema.application.name,
		applicationSchema: schema.application.postgresSchema,
		requiredExtensionNames: schema.requiredPostgres.extensions.map(
			(extension) => extension.name,
		),
	});
	return compareComparable(expected, actual);
}

function compareComparable(
	expected: JsonRecord,
	actual: JsonRecord,
): JsonRecord {
	if (canonicalBytes(actual) === canonicalBytes(expected)) return actual;
	return fingerprintMismatch(expected, actual);
}

function fingerprintMismatch(expected: JsonRecord, actual: JsonRecord): never {
	if (
		expected.applicationSchemaExists === true &&
		actual.applicationSchemaExists !== true
	)
		return fail(
			"QP-SCHEMA-028",
			"missingObject",
			`application schema ${String(expected.applicationSchema)} is missing`,
			{ expected, actual },
		);
	const unsupported = actual.unsupportedObjects;
	if (Array.isArray(unsupported) && unsupported.length > 0)
		return fail(
			"QP-SCHEMA-028",
			"invalidObject",
			`application schema ${String(expected.applicationSchema)} contains unsupported objects`,
			{ expected, actual },
		);
	const expectedObjects = objectMap(expected.objects);
	const actualObjects = objectMap(actual.objects);
	for (const [identity] of expectedObjects)
		if (!actualObjects.has(identity))
			return fail(
				"QP-SCHEMA-028",
				"missingObject",
				`${identity} is missing from the PostgreSQL catalog`,
				{ expected, actual },
			);
	for (const [identity] of actualObjects)
		if (!expectedObjects.has(identity))
			return fail(
				"QP-SCHEMA-028",
				"unexpectedObject",
				`${identity} is unexpected in the PostgreSQL catalog`,
				{ expected, actual },
			);
	return fail(
		"QP-SCHEMA-028",
		"changedObject",
		`application schema ${String(expected.applicationSchema)} differs from the committed projection`,
		{ expected, actual },
	);
}

function objectMap(value: unknown): Map<string, JsonRecord> {
	const objects = Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
	return new Map(
		objects.map((object) => [
			[
				String(object.kind),
				String(object.table ?? ""),
				String(object.name ?? ""),
			].join(":"),
			object,
		]),
	);
}

export async function schemaExists(
	sql: SQL,
	schemaName: string,
): Promise<boolean> {
	const [row] = await sql<{ exists: boolean }[]>`
		select exists(
			select 1 from pg_catalog.pg_namespace where nspname = ${schemaName}
		) as exists
	`;
	return row?.exists === true;
}

export async function providerObservations(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<ProviderObservations> {
	const [database] = await sql<
		{
			serverVersion: string;
			databaseCollation: string;
			databaseCType: string;
			databaseEncoding: string;
			binaryCollationProvider: string | null;
			binaryCollationDeterministic: boolean | null;
		}[]
	>`
		select current_setting('server_version') as "serverVersion",
		       datcollate as "databaseCollation",
		       datctype as "databaseCType",
		       pg_catalog.pg_encoding_to_char(encoding) as "databaseEncoding",
		       (
		         select collprovider::text
		         from pg_catalog.pg_collation c
		         join pg_catalog.pg_namespace n on n.oid = c.collnamespace
		         where n.nspname = 'pg_catalog' and c.collname = 'C'
		       ) as "binaryCollationProvider",
		       (
		         select collisdeterministic
		         from pg_catalog.pg_collation c
		         join pg_catalog.pg_namespace n on n.oid = c.collnamespace
		         where n.nspname = 'pg_catalog' and c.collname = 'C'
		       ) as "binaryCollationDeterministic"
		from pg_catalog.pg_database where datname = current_database()
	`;
	const requiredExtensions = schema.requiredPostgres.extensions.map(
		(item) => item.name,
	);
	const extensions =
		requiredExtensions.length === 0
			? []
			: await sql<{ name: string; installedVersion: string }[]>`
				select extname as name, extversion as "installedVersion"
				from pg_catalog.pg_extension
				where extname in ${sql(requiredExtensions)}
				order by extname
			`;
	if (!database)
		return fail(
			"QP-SCHEMA-007",
			"unsupportedPostgres",
			"database observations are unavailable",
		);
	const major = Number.parseInt(database.serverVersion, 10);
	if (
		!Number.isSafeInteger(major) ||
		major < schema.requiredPostgres.minimumMajor ||
		database.databaseCollation !== schema.requiredPostgres.databaseCollation ||
		database.databaseCType !== schema.requiredPostgres.databaseCType ||
		database.databaseEncoding !== "UTF8" ||
		database.binaryCollationProvider !== "c" ||
		database.binaryCollationDeterministic !== true
	)
		return fail(
			"QP-SCHEMA-007",
			"unsupportedPostgres",
			"PostgreSQL does not match the committed core provider profile",
			{ actual: database },
		);
	const missingExtensions = requiredExtensions.filter(
		(required) => !extensions.some((extension) => extension.name === required),
	);
	if (missingExtensions.length > 0)
		return fail(
			"QP-SCHEMA-007",
			"missingExtension",
			"PostgreSQL is missing a required extension",
			{ expected: requiredExtensions, actual: extensions },
		);
	if (
		new Set(extensions.map((extension) => extension.name)).size !==
			extensions.length ||
		extensions.some(
			(extension) =>
				!requiredExtensions.includes(extension.name) ||
				typeof extension.installedVersion !== "string" ||
				extension.installedVersion.length === 0,
		)
	)
		return fail(
			"QP-SCHEMA-007",
			"incompatibleExtension",
			"PostgreSQL returned an incompatible required-extension observation",
			{ expected: requiredExtensions, actual: extensions },
		);
	return {
		serverVersion: database.serverVersion,
		databaseCollation: database.databaseCollation,
		databaseCType: database.databaseCType,
		extensions,
	};
}

export async function fingerprint(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<SchemaFingerprintV1> {
	const expected = expectedComparable(schema);
	const evidence = await sql.begin(
		"isolation level repeatable read read only",
		async (transaction) => ({
			observations: await providerObservations(transaction, schema),
			actual: await readCatalogComparableInOwnedTransaction(transaction, {
				application: schema.application.name,
				applicationSchema: schema.application.postgresSchema,
				requiredExtensionNames: schema.requiredPostgres.extensions.map(
					(extension) => extension.name,
				),
			}),
		}),
	);
	return {
		format: "questpie.schema-fingerprint",
		version: 1,
		comparable: compareComparable(expected, evidence.actual),
		observations: evidence.observations,
	};
}

export async function inspectSchemaFingerprint(
	input: Readonly<{
		connectionString?: string;
		schema: SchemaProjectionV1;
	}>,
): Promise<Readonly<{ fingerprint: SchemaFingerprintV1; digest: string }>> {
	const sql = input.connectionString
		? new SQL(input.connectionString)
		: new SQL();
	try {
		const value = await fingerprint(sql, input.schema);
		return {
			fingerprint: value,
			digest: digest("questpie-schema-fingerprint-v1", value.comparable),
		};
	} finally {
		await sql.close();
	}
}
