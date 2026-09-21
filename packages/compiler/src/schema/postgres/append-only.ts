import type { SQL } from "bun";

import { canonicalBytes, compareAscii, digest } from "../../canonical";
import { CompilerDiagnosticError } from "../../diagnostic";
import type { SchemaProjectionV1 } from "../contracts";
import { uniquelyShortenedPostgresName } from "../physical-name";
import { childRecords } from "../projection";
import type { PostgresDatabaseOwnedUpdateCatalogRowV1 } from "./database-owned-update";
import { fail } from "./shared";

/**
 * SQLSTATE codes reserved by QUESTPIE for database-level immutability
 * guards. Both use class "QP", which PostgreSQL's Appendix A reserves for
 * implementation/application-defined conditions: a SQLSTATE class code is
 * standard-defined only when its first character is a digit 0-4 or a letter
 * A-H; classes starting with a digit 5-9 or a letter I-Z are available for
 * non-standard use. "Q" falls in the I-Z range, so "QP001"/"QP002" cannot
 * collide with any current or future standard-defined class. Verified by
 * grep across this repository: no other module raises a custom SQLSTATE
 * (every other `RAISE EXCEPTION` in `postgres/internal-protocol-v3*.ts` and
 * `internal-protocol-v4-sql.ts` uses the plpgsql default P0001), so there is
 * no collision with an existing compiler-owned condition either.
 */
export const APPEND_ONLY_SQLSTATE = "QP001";
export const WRITE_ONCE_FIELD_SQLSTATE = "QP002";

const collectionIdentity = /^collection:[a-z][A-Za-z0-9]*$/;
const fieldIdentity = /^collection:[a-z][A-Za-z0-9]*\/field:[a-z][A-Za-z0-9]*$/;

export type PostgresAppendOnlyCollectionV1 = Readonly<{
	identity: string;
	table: string;
	functionName: string;
	rowGuardTrigger: string;
	truncateGuardTrigger: string;
}>;

export type PostgresWriteOnceFieldV1 = Readonly<{
	identity: string;
	collectionIdentity: string;
	table: string;
	column: string;
	functionName: string;
	triggerName: string;
}>;

export type PostgresImmutabilityCatalogRowV1 =
	PostgresDatabaseOwnedUpdateCatalogRowV1;

export type PostgresImmutabilityGuardsV1 = Readonly<{
	version: 1;
	postgresSchema: string;
	appendOnlyCollections: readonly PostgresAppendOnlyCollectionV1[];
	writeOnceFields: readonly PostgresWriteOnceFieldV1[];
	catalog: readonly PostgresImmutabilityCatalogRowV1[];
	fingerprint: string;
}>;

function invalidDefinition(message: string): never {
	throw new CompilerDiagnosticError(
		"QP-SCHEMA-001",
		"invalidDefinition",
		message,
	);
}

function quote(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function literal(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function appendOnlyFunctionSource(identity: string): string {
	return `BEGIN
  RAISE EXCEPTION ${literal(`Collection ${identity} is append-only; UPDATE and DELETE are refused at the database level`)}
    USING ERRCODE = ${literal(APPEND_ONLY_SQLSTATE)};
END`;
}

function writeOnceFunctionSource(
	column: string,
	fieldIdentityValue: string,
	collectionIdentityValue: string,
): string {
	return `BEGIN
  IF NEW.${quote(column)} IS DISTINCT FROM OLD.${quote(column)} THEN
    RAISE EXCEPTION ${literal(`Field ${fieldIdentityValue} on Collection ${collectionIdentityValue} is database-immutable; it cannot change after insert`)}
      USING ERRCODE = ${literal(WRITE_ONCE_FIELD_SQLSTATE)};
  END IF;
  RETURN NEW;
END`;
}

function catalogFunctionSource(source: string): string {
	return `\n${source}\n`;
}

function catalogRow(
	postgresSchema: string,
	table: string,
	triggerName: string,
	triggerType: number,
	functionName: string,
	source: string,
): PostgresImmutabilityCatalogRowV1 {
	return Object.freeze({
		table,
		triggerName,
		triggerType,
		triggerEnabled: "O" as const,
		functionSchema: postgresSchema,
		functionName,
		functionLanguage: "plpgsql" as const,
		functionSource: catalogFunctionSource(source),
		functionSecurityDefiner: false as const,
		functionConfiguration: ["search_path=pg_catalog"] as const,
		ownerMatches: true as const,
		publicExecute: false as const,
	});
}

// PostgreSQL pg_trigger.tgtype bit layout (see pg_trigger.h):
// ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
const BEFORE_UPDATE_OR_DELETE_ROW = 1 + 2 + 8 + 16; // 27
const BEFORE_TRUNCATE_STATEMENT = 2 + 32; // 34
const BEFORE_UPDATE_ROW = 1 + 2 + 16; // 19, matches database-owned-update.ts

export function projectPostgresImmutabilityGuards(
	schema: SchemaProjectionV1,
): PostgresImmutabilityGuardsV1 {
	const postgresSchema = schema.application.postgresSchema;
	const appendOnlyCollections = [...schema.collections]
		.filter((collection) => collection.appendOnly === true)
		.sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		)
		.map((collection): PostgresAppendOnlyCollectionV1 => {
			const identity = String(collection.identity);
			if (!collectionIdentity.test(identity))
				return invalidDefinition(
					`append-only Collection identity ${identity} is invalid`,
				);
			const table = String(collection.postgresName);
			return Object.freeze({
				identity,
				table,
				functionName: uniquelyShortenedPostgresName(
					`${identity}:append-only guard function`,
					`qp_append_only_${table}`,
				),
				rowGuardTrigger: uniquelyShortenedPostgresName(
					`${identity}:append-only row guard`,
					`${table}_questpie_append_only`,
				),
				truncateGuardTrigger: uniquelyShortenedPostgresName(
					`${identity}:append-only truncate guard`,
					`${table}_questpie_append_only_truncate`,
				),
			});
		});
	const writeOnceFields = schema.collections
		.flatMap((collection) =>
			childRecords(collection, "fields")
				.filter((field) => field.databaseImmutable === true)
				.map((field): PostgresWriteOnceFieldV1 => {
					const identity = String(field.identity);
					if (!fieldIdentity.test(identity))
						return invalidDefinition(
							`write-once Field identity ${identity} is invalid`,
						);
					const collectionIdentityValue = String(collection.identity);
					const table = String(collection.postgresName);
					const column = String(field.postgresName);
					return Object.freeze({
						identity,
						collectionIdentity: collectionIdentityValue,
						table,
						column,
						functionName: uniquelyShortenedPostgresName(
							`${identity}:write-once guard function`,
							`qp_write_once_${table}_${column}`,
						),
						triggerName: uniquelyShortenedPostgresName(
							`${identity}:write-once guard trigger`,
							`${table}_${column}_questpie_write_once`,
						),
					});
				}),
		)
		.sort((left, right) => compareAscii(left.identity, right.identity));
	if (
		new Set(appendOnlyCollections.map(({ identity }) => identity)).size !==
		appendOnlyCollections.length
	)
		invalidDefinition("append-only Collection identity is duplicated");
	if (
		new Set(writeOnceFields.map(({ identity }) => identity)).size !==
		writeOnceFields.length
	)
		invalidDefinition("write-once Field identity is duplicated");
	const catalog = [
		...appendOnlyCollections.flatMap((collection) => [
			catalogRow(
				postgresSchema,
				collection.table,
				collection.rowGuardTrigger,
				BEFORE_UPDATE_OR_DELETE_ROW,
				collection.functionName,
				appendOnlyFunctionSource(collection.identity),
			),
			catalogRow(
				postgresSchema,
				collection.table,
				collection.truncateGuardTrigger,
				BEFORE_TRUNCATE_STATEMENT,
				collection.functionName,
				appendOnlyFunctionSource(collection.identity),
			),
		]),
		...writeOnceFields.map((field) =>
			catalogRow(
				postgresSchema,
				field.table,
				field.triggerName,
				BEFORE_UPDATE_ROW,
				field.functionName,
				writeOnceFunctionSource(
					field.column,
					field.identity,
					field.collectionIdentity,
				),
			),
		),
	];
	return Object.freeze({
		version: 1 as const,
		postgresSchema,
		appendOnlyCollections: Object.freeze(appendOnlyCollections),
		writeOnceFields: Object.freeze(writeOnceFields),
		catalog: Object.freeze(catalog),
		fingerprint: digest("questpie-postgres-immutability-guards-v1", catalog),
	});
}

export function appendOnlyGuard(
	projection: PostgresImmutabilityGuardsV1 | undefined,
	identity: string,
): PostgresAppendOnlyCollectionV1 {
	const guard = projection?.appendOnlyCollections.find(
		(candidate) => candidate.identity === identity,
	);
	if (!guard)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-003",
			"invalidReference",
			`append-only guard for ${identity} is missing`,
		);
	return guard;
}

export function writeOnceGuard(
	projection: PostgresImmutabilityGuardsV1 | undefined,
	identity: string,
): PostgresWriteOnceFieldV1 {
	const guard = projection?.writeOnceFields.find(
		(candidate) => candidate.identity === identity,
	);
	if (!guard)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-003",
			"invalidReference",
			`write-once guard for ${identity} is missing`,
		);
	return guard;
}

export function renderAddAppendOnlyGuard(
	projection: PostgresImmutabilityGuardsV1,
	identity: string,
): string {
	const guard = appendOnlyGuard(projection, identity);
	const schema = quote(projection.postgresSchema);
	const functionName = `${schema}.${quote(guard.functionName)}`;
	return `CREATE FUNCTION ${functionName}() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $questpie$
${appendOnlyFunctionSource(guard.identity)}
$questpie$;
REVOKE ALL ON FUNCTION ${functionName}() FROM PUBLIC;
CREATE TRIGGER ${quote(guard.rowGuardTrigger)}
BEFORE UPDATE OR DELETE ON ${schema}.${quote(guard.table)}
FOR EACH ROW EXECUTE FUNCTION ${functionName}();
CREATE TRIGGER ${quote(guard.truncateGuardTrigger)}
BEFORE TRUNCATE ON ${schema}.${quote(guard.table)}
FOR EACH STATEMENT EXECUTE FUNCTION ${functionName}();`;
}

export function renderDropAppendOnlyGuard(
	projection: PostgresImmutabilityGuardsV1,
	identity: string,
): string {
	const guard = appendOnlyGuard(projection, identity);
	const schema = quote(projection.postgresSchema);
	return `DROP TRIGGER ${quote(guard.rowGuardTrigger)} ON ${schema}.${quote(guard.table)};
DROP TRIGGER ${quote(guard.truncateGuardTrigger)} ON ${schema}.${quote(guard.table)};
DROP FUNCTION ${schema}.${quote(guard.functionName)}();`;
}

export function renderAddWriteOnceGuard(
	projection: PostgresImmutabilityGuardsV1,
	identity: string,
): string {
	const guard = writeOnceGuard(projection, identity);
	const schema = quote(projection.postgresSchema);
	const functionName = `${schema}.${quote(guard.functionName)}`;
	return `CREATE FUNCTION ${functionName}() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $questpie$
${writeOnceFunctionSource(guard.column, guard.identity, guard.collectionIdentity)}
$questpie$;
REVOKE ALL ON FUNCTION ${functionName}() FROM PUBLIC;
CREATE TRIGGER ${quote(guard.triggerName)}
BEFORE UPDATE ON ${schema}.${quote(guard.table)}
FOR EACH ROW EXECUTE FUNCTION ${functionName}();`;
}

export function renderDropWriteOnceGuard(
	projection: PostgresImmutabilityGuardsV1,
	identity: string,
): string {
	const guard = writeOnceGuard(projection, identity);
	const schema = quote(projection.postgresSchema);
	return `DROP TRIGGER ${quote(guard.triggerName)} ON ${schema}.${quote(guard.table)};
DROP FUNCTION ${schema}.${quote(guard.functionName)}();`;
}

export function assertPostgresImmutabilityGuards(
	projection: PostgresImmutabilityGuardsV1,
	actual: readonly PostgresImmutabilityCatalogRowV1[],
): void {
	if (canonicalBytes(actual) === canonicalBytes(projection.catalog)) return;
	return fail(
		"QP-SCHEMA-028",
		"changedObject",
		"database immutability guard behavior differs from its compiler projection",
		{ expected: projection.catalog, actual },
	);
}

export async function verifyPostgresImmutabilityGuards(
	sql: SQL,
	projection: PostgresImmutabilityGuardsV1,
): Promise<void> {
	const triggerNames = [
		...projection.appendOnlyCollections.flatMap((collection) => [
			collection.rowGuardTrigger,
			collection.truncateGuardTrigger,
		]),
		...projection.writeOnceFields.map((field) => field.triggerName),
	];
	if (triggerNames.length === 0) return;
	const actual = await sql<PostgresImmutabilityCatalogRowV1[]>`
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
		  and t.tgname in ${sql(triggerNames)}
		  and not t.tgisinternal
		order by c.relname, t.tgname
	`;
	assertPostgresImmutabilityGuards(projection, actual);
}
