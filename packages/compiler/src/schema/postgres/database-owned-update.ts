import type { SQL } from "bun";

import { canonicalBytes, compareAscii, digest } from "../../canonical";
import { CompilerDiagnosticError } from "../../diagnostic";
import type { SchemaProjectionV1 } from "../contracts";
import {
	uniquelyShortenedPostgresName,
	validatedPhysicalName,
} from "../physical-name";
import { childRecords } from "../projection";
import { fail } from "./shared";

export type PostgresDatabaseOwnedUpdateFieldV1 = Readonly<{
	identity: string;
	table: string;
	column: string;
	functionName: string;
	triggerName: string;
}>;

export type PostgresDatabaseOwnedUpdateCatalogRowV1 = Readonly<{
	table: string;
	triggerName: string;
	triggerType: number;
	triggerEnabled: string;
	functionSchema: string;
	functionName: string;
	functionLanguage: string;
	functionSource: string;
	functionSecurityDefiner: boolean;
	functionConfiguration: readonly string[];
	ownerMatches: boolean;
	publicExecute: boolean;
}>;

export type PostgresDatabaseOwnedUpdatesV1 = Readonly<{
	version: 1;
	postgresSchema: string;
	fields: readonly PostgresDatabaseOwnedUpdateFieldV1[];
	catalog: readonly PostgresDatabaseOwnedUpdateCatalogRowV1[];
	fingerprint: string;
}>;

function quote(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function functionSource(column: string): string {
	return `BEGIN\n  NEW.${quote(column)} := pg_catalog.transaction_timestamp();\n  RETURN NEW;\nEND`;
}

function catalogFunctionSource(column: string): string {
	return `\n${functionSource(column)}\n`;
}

function catalogRow(
	postgresSchema: string,
	field: PostgresDatabaseOwnedUpdateFieldV1,
): PostgresDatabaseOwnedUpdateCatalogRowV1 {
	return Object.freeze({
		table: field.table,
		triggerName: field.triggerName,
		triggerType: 19 as const,
		triggerEnabled: "O" as const,
		functionSchema: postgresSchema,
		functionName: field.functionName,
		functionLanguage: "plpgsql" as const,
		functionSource: catalogFunctionSource(field.column),
		functionSecurityDefiner: false as const,
		functionConfiguration: ["search_path=pg_catalog"] as const,
		ownerMatches: true as const,
		publicExecute: false as const,
	});
}

export function projectPostgresDatabaseOwnedUpdates(
	schema: SchemaProjectionV1,
): PostgresDatabaseOwnedUpdatesV1 {
	const fields = schema.collections
		.flatMap((collection) =>
			childRecords(collection, "fields")
				.filter((field) => field.onUpdate === "now")
				.map((field): PostgresDatabaseOwnedUpdateFieldV1 => {
					const identity = String(field.identity);
					const table = validatedPhysicalName(
						String(collection.identity),
						String(collection.postgresName),
					);
					const column = validatedPhysicalName(
						identity,
						String(field.postgresName),
					);
					return Object.freeze({
						identity,
						table,
						column,
						functionName: uniquelyShortenedPostgresName(
							`${identity}:database-owned update function`,
							`qp_on_update_${table}_${column}`,
						),
						triggerName: uniquelyShortenedPostgresName(
							`${identity}:database-owned update trigger`,
							`${table}_${column}_questpie_on_update`,
						),
					});
				}),
		)
		.sort((left, right) => compareAscii(left.identity, right.identity));
	if (new Set(fields.map(({ identity }) => identity)).size !== fields.length)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-002",
			"duplicateIdentity",
			"database-owned update Field identity is duplicated",
		);
	const catalog = fields.map((field) =>
		catalogRow(schema.application.postgresSchema, field),
	);
	return Object.freeze({
		version: 1 as const,
		postgresSchema: schema.application.postgresSchema,
		fields: Object.freeze(fields),
		catalog: Object.freeze(catalog),
		fingerprint: digest("questpie-postgres-database-owned-updates-v1", catalog),
	});
}

export function databaseOwnedUpdateField(
	projection: PostgresDatabaseOwnedUpdatesV1 | undefined,
	identity: string,
): PostgresDatabaseOwnedUpdateFieldV1 {
	const field = projection?.fields.find(
		(candidate) => candidate.identity === identity,
	);
	if (!field)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-003",
			"invalidReference",
			`database-owned update Field ${identity} is missing`,
		);
	return field;
}

export function renderAddDatabaseOwnedUpdate(
	projection: PostgresDatabaseOwnedUpdatesV1,
	identity: string,
): string {
	const field = databaseOwnedUpdateField(projection, identity);
	const schema = quote(projection.postgresSchema);
	const functionName = `${schema}.${quote(field.functionName)}`;
	return `CREATE FUNCTION ${functionName}() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $questpie$
${functionSource(field.column)}
$questpie$;
REVOKE ALL ON FUNCTION ${functionName}() FROM PUBLIC;
CREATE TRIGGER ${quote(field.triggerName)}
BEFORE UPDATE ON ${schema}.${quote(field.table)}
FOR EACH ROW EXECUTE FUNCTION ${functionName}();`;
}

export function renderDropDatabaseOwnedUpdate(
	projection: PostgresDatabaseOwnedUpdatesV1,
	identity: string,
): string {
	const field = databaseOwnedUpdateField(projection, identity);
	const schema = quote(projection.postgresSchema);
	return `DROP TRIGGER ${quote(field.triggerName)} ON ${schema}.${quote(field.table)};
DROP FUNCTION ${schema}.${quote(field.functionName)}();`;
}

export function assertPostgresDatabaseOwnedUpdates(
	projection: PostgresDatabaseOwnedUpdatesV1,
	actual: readonly PostgresDatabaseOwnedUpdateCatalogRowV1[],
): void {
	if (canonicalBytes(actual) === canonicalBytes(projection.catalog)) return;
	return fail(
		"QP-SCHEMA-028",
		"changedObject",
		"database-owned update behavior differs from its compiler projection",
		{ expected: projection.catalog, actual },
	);
}

export async function verifyPostgresDatabaseOwnedUpdates(
	sql: SQL,
	projection: PostgresDatabaseOwnedUpdatesV1,
): Promise<void> {
	const actual = await sql<PostgresDatabaseOwnedUpdateCatalogRowV1[]>`
		select c.relname as table,
		       t.tgname as "triggerName",
		       t.tgtype::integer as "triggerType",
		       t.tgenabled as "triggerEnabled",
		       pn.nspname as "functionSchema",
		       p.proname as "functionName",
		       l.lanname as "functionLanguage",
		       p.prosrc as "functionSource",
		       p.prosecdef as "functionSecurityDefiner",
		       p.proconfig as "functionConfiguration",
		       c.relowner = n.nspowner and p.proowner = n.nspowner as "ownerMatches",
		       pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE') as "publicExecute"
		from pg_catalog.pg_trigger t
		join pg_catalog.pg_class c on c.oid = t.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_proc p on p.oid = t.tgfoid
		join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
		join pg_catalog.pg_language l on l.oid = p.prolang
		where n.nspname = ${projection.postgresSchema}
		  and t.tgname in ${sql(projection.fields.map((field) => field.triggerName))}
		  and not t.tgisinternal
		order by c.relname, t.tgname
	`;
	assertPostgresDatabaseOwnedUpdates(projection, actual);
}
