import type { SQL } from "bun";

import { canonicalBytes, compareAscii, digest } from "../../canonical";
import { CompilerDiagnosticError } from "../../diagnostic";
import {
	shortenedPostgresName,
	validatedApplicationSchemaName,
	validatedPhysicalName,
} from "../physical-name";
import { fail } from "./shared";

export type PostgresReactiveCollection = Readonly<{
	identity: string;
	postgresName: string;
	keyColumns: readonly string[];
	partitioned?: boolean;
}>;

export type PostgresChangeCaptureCollectionV1 = Readonly<{
	identity: string;
	postgresName: string;
	keyColumns: readonly string[];
	rowTrigger: string;
	truncateTrigger: string;
}>;

export type PostgresChangeCaptureTriggerV1 = Readonly<{
	table: string;
	name: string;
	type: number;
	argumentsHex: string;
	functionSchema: "questpie_internal";
	functionName: "capture_reactive_row" | "capture_reactive_truncate";
	securityDefiner: true;
	functionConfiguration: readonly string[];
	enabled: "O";
	ownerMatches: true;
}>;

export type PostgresChangeCaptureV1 = Readonly<{
	version: 1;
	applicationName: string;
	postgresSchema: string;
	collections: readonly PostgresChangeCaptureCollectionV1[];
	triggerCatalog: readonly PostgresChangeCaptureTriggerV1[];
	fingerprint: string;
	sql: string;
}>;

const qualifiedResourceName = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;
const collectionIdentity = /^collection:[a-z][A-Za-z0-9]*$/;

function invalidDefinition(message: string): never {
	throw new CompilerDiagnosticError(
		"QP-SCHEMA-001",
		"invalidDefinition",
		message,
	);
}

function triggerArgumentsHex(argumentValues: readonly string[]): string {
	return Buffer.from(`${argumentValues.join("\0")}\0`, "utf8").toString("hex");
}

function renderTrigger(
	postgresSchema: string,
	collection: PostgresChangeCaptureCollectionV1,
	applicationName: string,
): string {
	const argumentsSql = [
		applicationName,
		collection.identity,
		...collection.keyColumns,
	]
		.map((value) => `'${value}'`)
		.join(", ");
	return `CREATE TRIGGER ${collection.rowTrigger}
AFTER INSERT OR UPDATE OR DELETE ON ${postgresSchema}.${collection.postgresName}
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row(${argumentsSql});

CREATE TRIGGER ${collection.truncateTrigger}
AFTER TRUNCATE ON ${postgresSchema}.${collection.postgresName}
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('${applicationName}', '${collection.identity}');`;
}

function triggerCatalogRows(
	applicationName: string,
	collections: readonly PostgresChangeCaptureCollectionV1[],
): readonly PostgresChangeCaptureTriggerV1[] {
	return collections.flatMap((collection) => [
		{
			table: collection.postgresName,
			name: collection.rowTrigger,
			type: 29,
			argumentsHex: triggerArgumentsHex([
				applicationName,
				collection.identity,
				...collection.keyColumns,
			]),
			functionSchema: "questpie_internal" as const,
			functionName: "capture_reactive_row" as const,
			securityDefiner: true as const,
			functionConfiguration: [
				"search_path=pg_catalog, questpie_internal",
			] as const,
			enabled: "O" as const,
			ownerMatches: true as const,
		},
		{
			table: collection.postgresName,
			name: collection.truncateTrigger,
			type: 32,
			argumentsHex: triggerArgumentsHex([applicationName, collection.identity]),
			functionSchema: "questpie_internal" as const,
			functionName: "capture_reactive_truncate" as const,
			securityDefiner: true as const,
			functionConfiguration: [
				"search_path=pg_catalog, questpie_internal",
			] as const,
			enabled: "O" as const,
			ownerMatches: true as const,
		},
	]);
}

export function projectPostgresChangeCapture(
	input: Readonly<{
		applicationName: string;
		postgresSchema: string;
		collections: readonly PostgresReactiveCollection[];
	}>,
): PostgresChangeCaptureV1 {
	if (!qualifiedResourceName.test(input.applicationName))
		return invalidDefinition(
			`Change Ledger application identity ${input.applicationName} is invalid`,
		);
	if (Buffer.byteLength(input.applicationName) > 256)
		return invalidDefinition("Change Ledger application identity is too long");
	const postgresSchema = validatedApplicationSchemaName(
		input.applicationName,
		input.postgresSchema,
	);
	const identities = new Set<string>();
	const physicalNames = new Set<string>();
	const collections = [...input.collections]
		.sort((left, right) => compareAscii(left.identity, right.identity))
		.map((collection): PostgresChangeCaptureCollectionV1 => {
			if (!collectionIdentity.test(collection.identity))
				return invalidDefinition(
					`reactive Collection identity ${collection.identity} is invalid`,
				);
			if (Buffer.byteLength(collection.identity) > 256)
				return invalidDefinition(
					`reactive Collection identity ${collection.identity} is too long`,
				);
			if (identities.has(collection.identity))
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-002",
					"duplicateIdentity",
					`reactive Collection ${collection.identity} is duplicated`,
				);
			identities.add(collection.identity);
			if (collection.partitioned)
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-004",
					"unsupportedDefinition",
					`reactive Collection ${collection.identity} cannot use a partitioned PostgreSQL table`,
				);
			const postgresName = validatedPhysicalName(
				collection.identity,
				collection.postgresName,
			);
			if (physicalNames.has(postgresName))
				throw new CompilerDiagnosticError(
					"QP-SCHEMA-006",
					"physicalNameCollision",
					`reactive Collections share PostgreSQL table ${postgresName}`,
				);
			physicalNames.add(postgresName);
			if (collection.keyColumns.length === 0)
				return invalidDefinition(
					`reactive Collection ${collection.identity} has no key columns`,
				);
			const keyColumns = collection.keyColumns.map((column) =>
				validatedPhysicalName(`${collection.identity} key`, column),
			);
			if (new Set(keyColumns).size !== keyColumns.length)
				return invalidDefinition(
					`reactive Collection ${collection.identity} repeats a key column`,
				);
			return Object.freeze({
				identity: collection.identity,
				postgresName,
				keyColumns: Object.freeze(keyColumns),
				rowTrigger: shortenedPostgresName(
					`${collection.identity}:row capture trigger`,
					`${postgresName}_questpie_capture_row`,
				),
				truncateTrigger: shortenedPostgresName(
					`${collection.identity}:truncate capture trigger`,
					`${postgresName}_questpie_capture_truncate`,
				),
			});
		});
	const triggerCatalog = triggerCatalogRows(input.applicationName, collections);
	return Object.freeze({
		version: 1,
		applicationName: input.applicationName,
		postgresSchema,
		collections: Object.freeze(collections),
		triggerCatalog: Object.freeze(triggerCatalog),
		fingerprint: digest("questpie-postgres-change-capture-v1", triggerCatalog),
		sql: `${collections
			.map((collection) =>
				renderTrigger(postgresSchema, collection, input.applicationName),
			)
			.join("\n\n")}\n`,
	});
}

export async function verifyPostgresChangeCapture(
	sql: SQL,
	projection: PostgresChangeCaptureV1,
): Promise<void> {
	if (projection.collections.length === 0) return;
	const tables = projection.collections.map(({ postgresName }) => postgresName);
	const actual = await sql<PostgresChangeCaptureTriggerV1[]>`
		select c.relname as table,
		       t.tgname as name,
		       t.tgtype::integer as type,
		       pg_catalog.encode(t.tgargs, 'hex') as "argumentsHex",
		       pn.nspname as "functionSchema",
		       p.proname as "functionName",
		       p.prosecdef as "securityDefiner",
		       p.proconfig as "functionConfiguration",
		       t.tgenabled as enabled,
		       c.relowner = n.nspowner and p.proowner = pn.nspowner as "ownerMatches"
		from pg_catalog.pg_trigger t
		join pg_catalog.pg_class c on c.oid = t.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_proc p on p.oid = t.tgfoid
		join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
		where n.nspname = ${projection.postgresSchema}
		  and c.relname in ${sql(tables)}
		  and not t.tgisinternal
		order by c.relname, t.tgname
	`;
	if (canonicalBytes(actual) === canonicalBytes(projection.triggerCatalog))
		return;
	return fail(
		"QP-SCHEMA-028",
		"changedObject",
		`Change Ledger capture for ${projection.applicationName} differs from its compiler projection`,
		{ expected: projection.triggerCatalog, actual },
	);
}
