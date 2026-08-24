import type {
	definePostgresStatement,
	PostgresStatement,
	PostgresTransaction,
} from "@questpie/runtime/bundle-core";

import type { SchemaProjectionV1 } from "../contracts";
import type { SchemaFingerprintV1 } from "../postgres-types";
import { reduceCatalogTableColumns } from "./catalog-reader-columns";
import { reduceCatalogTableConstraintsAndIndexes } from "./catalog-reader-constraints";
import {
	catalogColumnsStatement,
	catalogConstraintsStatement,
	catalogIndexesStatement,
	catalogIndexTermsStatement,
	catalogRelationsStatement,
} from "./catalog-reader-statements";
import type { CatalogAccumulator, JsonRecord } from "./catalog-reader-types";
import { catalogUnsupportedStatement } from "./catalog-reader-unsupported";
import {
	assertPostgresChangeCapture,
	type PostgresChangeCaptureTriggerV1,
} from "./change-capture";
import {
	assertPostgresCatalogComparable,
	type PostgresExtensionObservationRow,
	type PostgresProviderObservationRow,
	validatePostgresProviderObservations,
} from "./fingerprint";
import {
	compareFingerprintDependencies,
	compareFingerprintObjects,
} from "./fingerprint-order";
import { fail } from "./shared";

type StatementDefinition<Input, Output> = Parameters<
	typeof definePostgresStatement<Input, Output>
>[0];

function defineStatement<Input, Output>(
	input: StatementDefinition<Input, Output>,
): StatementDefinition<Input, Output> {
	return Object.freeze(input);
}

type StatementResult = Parameters<
	PostgresStatement<unknown, unknown>["decode"]
>[0];

function selectRows(
	result: StatementResult,
	maximum: number | undefined,
	label: string,
): readonly (readonly unknown[])[] {
	if (
		result.command !== "SELECT" ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		(maximum !== undefined && result.rows.length > maximum)
	)
		throw new TypeError(`invalid PostgreSQL database readiness ${label}`);
	return result.rows;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL database readiness ${label}`);
	return value;
}

function boolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean")
		throw new TypeError(`invalid PostgreSQL database readiness ${label}`);
	return value;
}

const providerStatementDefinition = defineStatement<
	void,
	PostgresProviderObservationRow
>({
	name: "readiness.fingerprint.provider",
	text: `SELECT current_setting('server_version'),
       datcollate,
       datctype,
       pg_catalog.pg_encoding_to_char(encoding),
       (
         SELECT collprovider::text
         FROM pg_catalog.pg_collation c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
         WHERE n.nspname = 'pg_catalog' AND c.collname = 'C'
       ),
       (
         SELECT collisdeterministic
         FROM pg_catalog.pg_collation c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.collnamespace
         WHERE n.nspname = 'pg_catalog' AND c.collname = 'C'
       )
FROM pg_catalog.pg_database
WHERE datname = current_database()`,
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const rows = selectRows(result, 1, "provider result");
		const row = rows[0];
		if (
			rows.length !== 1 ||
			row?.length !== 6 ||
			(row[4] !== null && typeof row[4] !== "string") ||
			(row[5] !== null && typeof row[5] !== "boolean")
		)
			throw new TypeError(
				"invalid PostgreSQL database readiness provider result",
			);
		return Object.freeze({
			serverVersion: text(row[0], "server version"),
			databaseCollation: text(row[1], "database collation"),
			databaseCType: text(row[2], "database ctype"),
			databaseEncoding: text(row[3], "database encoding"),
			binaryCollationProvider: row[4],
			binaryCollationDeterministic: row[5],
		});
	},
});

const extensionsStatementDefinition = defineStatement<
	readonly string[],
	readonly PostgresExtensionObservationRow[]
>({
	name: "readiness.fingerprint.extensions",
	text: `SELECT extname, extversion
FROM pg_catalog.pg_extension
WHERE extname = ANY($1::text[])
ORDER BY extname`,
	parameterCount: 1,
	parameters: (names) => [names.map((name) => text(name, "extension name"))],
	decode(result) {
		return Object.freeze(
			selectRows(result, undefined, "extension result").map((row) => {
				if (row.length !== 2)
					throw new TypeError(
						"invalid PostgreSQL database readiness extension result",
					);
				return Object.freeze({
					name: text(row[0], "extension name"),
					installedVersion: text(row[1], "extension version"),
				});
			}),
		);
	},
});

const searchPathStatementDefinition = defineStatement<void, void>({
	name: "readiness.catalog.search-path",
	text: "SET LOCAL search_path = pg_catalog",
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		if (
			result.command !== "SET" ||
			(result.rowCount !== null && result.rowCount !== 0) ||
			result.rows.length !== 0
		)
			throw new TypeError(
				"invalid PostgreSQL database readiness search path result",
			);
	},
});

function existsStatement(name: string, textValue: string) {
	return defineStatement<string | void, boolean>({
		name,
		text: textValue,
		parameterCount: name === "readiness.catalog.namespace" ? 1 : 0,
		parameters: (value) =>
			value === undefined ? [] : [text(value, "application schema")],
		decode(result) {
			const rows = selectRows(result, 1, `${name} result`);
			if (rows.length !== 1 || rows[0]?.length !== 1)
				throw new TypeError(`invalid PostgreSQL database readiness ${name}`);
			return boolean(rows[0][0], name);
		},
	});
}

const namespaceStatementDefinition = existsStatement(
	"readiness.catalog.namespace",
	"SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1)",
);
const bindingCatalogStatementDefinition = existsStatement(
	"readiness.catalog.binding-catalog",
	"SELECT pg_catalog.to_regclass('questpie_internal.application_bindings') IS NOT NULL",
);

const catalogBindingsStatementDefinition = defineStatement<
	Readonly<{ application: string; applicationSchema: string }>,
	readonly Readonly<{ application: string; applicationSchema: string }>[]
>({
	name: "readiness.catalog.application-bindings",
	text: `SELECT application_name, postgres_schema
FROM questpie_internal.application_bindings
WHERE application_name = $1 OR postgres_schema = $2
ORDER BY application_name`,
	parameterCount: 2,
	parameters: (input) => [
		text(input.application, "Application Identity"),
		text(input.applicationSchema, "application schema"),
	],
	decode(result) {
		return Object.freeze(
			selectRows(result, 2, "catalog binding result").map((row) => {
				if (row.length !== 2)
					throw new TypeError(
						"invalid PostgreSQL database readiness catalog binding result",
					);
				return Object.freeze({
					application: text(row[0], "Application Identity"),
					applicationSchema: text(row[1], "application schema"),
				});
			}),
		);
	},
});

const changeCaptureStatementDefinition = defineStatement<
	Readonly<{ schema: string; tables: readonly string[] }>,
	readonly PostgresChangeCaptureTriggerV1[]
>({
	name: "readiness.change-capture",
	text: `SELECT c.relname, t.tgname, t.tgtype::integer,
       pg_catalog.encode(t.tgargs, 'hex'), pn.nspname, p.proname,
       p.prosecdef, p.proconfig, t.tgenabled,
       c.relowner = n.nspowner AND p.proowner = pn.nspowner
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace
WHERE n.nspname = $1 AND c.relname = ANY($2::text[]) AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname`,
	parameterCount: 2,
	parameters: (input) => [
		text(input.schema, "application schema"),
		input.tables.map((table) => text(table, "change-capture table")),
	],
	decode(result) {
		return Object.freeze(
			selectRows(result, undefined, "change-capture result").map((row) => {
				if (
					row.length !== 10 ||
					typeof row[2] !== "number" ||
					!Number.isSafeInteger(row[2]) ||
					row[4] !== "questpie_internal" ||
					(row[5] !== "capture_reactive_row" &&
						row[5] !== "capture_reactive_truncate") ||
					row[6] !== true ||
					!Array.isArray(row[7]) ||
					row[8] !== "O" ||
					row[9] !== true
				)
					throw new TypeError(
						"invalid PostgreSQL database readiness change-capture result",
					);
				return Object.freeze({
					table: text(row[0], "change-capture table"),
					name: text(row[1], "change-capture trigger"),
					type: row[2],
					argumentsHex: text(row[3], "change-capture arguments"),
					functionSchema: row[4],
					functionName: row[5],
					securityDefiner: row[6],
					functionConfiguration: Object.freeze(
						row[7].map((value) => text(value, "function configuration")),
					),
					enabled: row[8],
					ownerMatches: row[9],
				});
			}),
		);
	},
});

function managedTriggerIdentities(schema: SchemaProjectionV1): Set<string> {
	return new Set(
		schema.changeCapture?.triggerCatalog.map(
			(trigger) =>
				`${schema.application.postgresSchema}.${trigger.table}.${trigger.name}`,
		) ?? [],
	);
}

function unsupportedRelationKind(kind: string): string {
	if (kind === "v") return "view";
	if (kind === "m") return "materializedView";
	if (kind === "S") return "sequence";
	if (kind === "f") return "foreignTable";
	if (kind === "p") return "partitionedTable";
	return "other";
}

export async function verifyPostgresDatabaseSchemaReadiness(
	transaction: PostgresTransaction,
	schema: SchemaProjectionV1,
	bindStatement: typeof definePostgresStatement,
): Promise<SchemaFingerprintV1> {
	const providerStatement = bindStatement(providerStatementDefinition);
	const extensionsStatement = bindStatement(extensionsStatementDefinition);
	const searchPathStatement = bindStatement(searchPathStatementDefinition);
	const namespaceStatement = bindStatement(namespaceStatementDefinition);
	const bindingCatalogStatement = bindStatement(
		bindingCatalogStatementDefinition,
	);
	const catalogBindingsStatement = bindStatement(
		catalogBindingsStatementDefinition,
	);
	const relationsStatement = bindStatement(catalogRelationsStatement);
	const columnsStatement = bindStatement(catalogColumnsStatement);
	const constraintsStatement = bindStatement(catalogConstraintsStatement);
	const indexesStatement = bindStatement(catalogIndexesStatement);
	const indexTermsStatement = bindStatement(catalogIndexTermsStatement);
	const unsupportedStatement = bindStatement(catalogUnsupportedStatement);
	const changeCaptureStatement = bindStatement(
		changeCaptureStatementDefinition,
	);
	const requiredExtensions = schema.requiredPostgres.extensions.map(
		(extension) => extension.name,
	);
	const database = await transaction.execute(providerStatement, undefined);
	const extensions = await transaction.execute(
		extensionsStatement,
		requiredExtensions,
	);
	const observations = validatePostgresProviderObservations(
		schema,
		database,
		extensions,
	);
	await transaction.execute(searchPathStatement, undefined);
	const applicationSchemaExists = await transaction.execute(
		namespaceStatement,
		schema.application.postgresSchema,
	);
	const bindingCatalogExists = await transaction.execute(
		bindingCatalogStatement,
		undefined,
	);
	const bindings = bindingCatalogExists
		? await transaction.execute(catalogBindingsStatement, {
				application: schema.application.name,
				applicationSchema: schema.application.postgresSchema,
			})
		: [];
	if (!bindingCatalogExists && applicationSchemaExists)
		return fail(
			"QP-SCHEMA-029",
			"applicationBindingMismatch",
			"Application Identity binding catalog is missing",
		);
	if (
		bindingCatalogExists &&
		(bindings.length !== (applicationSchemaExists ? 1 : 0) ||
			bindings.some(
				(binding) =>
					binding.application !== schema.application.name ||
					binding.applicationSchema !== schema.application.postgresSchema,
			))
	)
		return fail(
			"QP-SCHEMA-029",
			"applicationBindingMismatch",
			"Application Identity and PostgreSQL schema binding disagree",
			{ expected: schema.application.name, actual: bindings },
		);

	const relations = await transaction.execute(
		relationsStatement,
		schema.application.postgresSchema,
	);
	const columns = await transaction.execute(
		columnsStatement,
		schema.application.postgresSchema,
	);
	const constraints = await transaction.execute(
		constraintsStatement,
		schema.application.postgresSchema,
	);
	const indexes = await transaction.execute(
		indexesStatement,
		schema.application.postgresSchema,
	);
	const indexTerms = await transaction.execute(
		indexTermsStatement,
		schema.application.postgresSchema,
	);
	const unsupported = await transaction.execute(
		unsupportedStatement,
		schema.application.postgresSchema,
	);
	const tables = relations.filter((relation) => relation.kind === "r");
	const supportedTables = tables.filter(
		(table) =>
			!table.inheritanceInvolved &&
			table.persistence === "p" &&
			table.replicaIdentity === "d" &&
			!table.rowSecurityEnabled &&
			!table.rowSecurityForced,
	);
	const state: CatalogAccumulator = {
		objects: applicationSchemaExists
			? [
					{ kind: "schema", name: schema.application.postgresSchema },
					...supportedTables.map((table) => ({
						kind: "table",
						name: table.name,
						persistence: "permanent",
						rowSecurityEnabled: false,
						rowSecurityForced: false,
					})),
				]
			: [],
		unsupportedObjects: relations
			.filter((relation) => relation.kind !== "r" && relation.kind !== "c")
			.map((relation) => ({
				kind: unsupportedRelationKind(relation.kind),
				qualifiedIdentity: `${schema.application.postgresSchema}.${relation.name}`,
				attachedTo: null,
			})),
		dependencies: new Map(),
	};
	for (const table of tables)
		if (
			table.inheritanceInvolved ||
			table.persistence !== "p" ||
			table.replicaIdentity !== "d" ||
			table.rowSecurityEnabled ||
			table.rowSecurityForced
		)
			state.unsupportedObjects.push({
				kind: "other",
				qualifiedIdentity: `${schema.application.postgresSchema}.${table.name}`,
				attachedTo: null,
			});
	for (const table of supportedTables) {
		const tableColumns = reduceCatalogTableColumns(
			schema.application.postgresSchema,
			table,
			columns,
			state,
		);
		reduceCatalogTableConstraintsAndIndexes(
			schema.application.postgresSchema,
			table,
			tableColumns,
			{ constraints, indexes, indexTerms },
			state,
		);
	}
	const managedTriggers = managedTriggerIdentities(schema);
	state.unsupportedObjects.push(
		...unsupported.filter(
			(object) =>
				object.kind !== "trigger" ||
				!managedTriggers.has(String(object.qualifiedIdentity)),
		),
	);
	const actual: JsonRecord = {
		application: schema.application.name,
		applicationSchema: schema.application.postgresSchema,
		applicationSchemaExists,
		objects: state.objects.sort(compareFingerprintObjects),
		unsupportedObjects: state.unsupportedObjects.sort(
			compareFingerprintObjects,
		),
		externalDependencies: [...state.dependencies.values()].sort(
			compareFingerprintDependencies,
		),
		installedRequiredExtensions: extensions.map((extension) => extension.name),
	};
	const comparable = assertPostgresCatalogComparable(schema, actual);
	const capture = await transaction.execute(changeCaptureStatement, {
		schema: schema.application.postgresSchema,
		tables:
			schema.changeCapture?.collections.map(
				(collection) => collection.postgresName,
			) ?? [],
	});
	if (schema.changeCapture)
		assertPostgresChangeCapture(schema.changeCapture, capture);
	else if (capture.length !== 0)
		throw new TypeError(
			"PostgreSQL change capture exists without a compiler projection",
		);
	return Object.freeze({
		format: "questpie.schema-fingerprint",
		version: 1,
		comparable,
		observations,
	});
}
