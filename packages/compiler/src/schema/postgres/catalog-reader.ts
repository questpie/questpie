import type { SQL } from "bun";

import { readCatalogTableColumns } from "./catalog-reader-columns";
import { readCatalogTableConstraintsAndIndexes } from "./catalog-reader-constraints";
import type { CatalogAccumulator, JsonRecord } from "./catalog-reader-types";
import { readUnsupportedCatalogObjects } from "./catalog-reader-unsupported";
import {
	compareFingerprintDependencies,
	compareFingerprintObjects,
} from "./fingerprint-order";
import { fail } from "./shared";

export interface CatalogFingerprintScope {
	readonly application: string;
	readonly applicationSchema: string;
	readonly requiredExtensionNames: readonly string[];
}

export async function readCatalogComparable(
	sql: SQL,
	scope: CatalogFingerprintScope,
): Promise<JsonRecord> {
	return sql.begin("isolation level repeatable read read only", (transaction) =>
		readCatalogComparableInOwnedTransaction(transaction, scope),
	);
}

export async function readCatalogComparableInOwnedTransaction(
	sql: SQL,
	scope: CatalogFingerprintScope,
): Promise<JsonRecord> {
	await sql.unsafe("SET LOCAL search_path = pg_catalog");
	const [namespace] = await sql<{ exists: boolean }[]>`
		select exists(
			select 1 from pg_catalog.pg_namespace where nspname = ${scope.applicationSchema}
		) as exists
	`;
	const [bindingCatalog] = await sql<{ exists: boolean }[]>`
		select pg_catalog.to_regclass('questpie_internal.application_bindings') is not null as exists
	`;
	if (!bindingCatalog?.exists)
		return fail(
			"QP-SCHEMA-029",
			"applicationBindingMismatch",
			"Application Identity binding catalog is missing",
		);
	const bindings = await sql<
		{ application: string; applicationSchema: string }[]
	>`
		select application_name as application, postgres_schema as "applicationSchema"
		from questpie_internal.application_bindings
		where application_name = ${scope.application}
		   or postgres_schema = ${scope.applicationSchema}
		order by application_name
	`;
	const binding = bindings[0];
	if (
		(bindings.length === 0 && namespace?.exists === true) ||
		(bindings.length !== 0 &&
			(bindings.length !== 1 ||
				binding?.application !== scope.application ||
				binding.applicationSchema !== scope.applicationSchema))
	)
		return fail(
			"QP-SCHEMA-029",
			"applicationBindingMismatch",
			"Application Identity and PostgreSQL schema binding disagree",
			{ expected: scope.application, actual: bindings },
		);
	const application = binding?.application ?? scope.application;
	const applicationSchema =
		binding?.applicationSchema ?? scope.applicationSchema;
	const installedExtensions =
		scope.requiredExtensionNames.length === 0
			? []
			: await sql<{ name: string }[]>`
				select extname as name
				from pg_catalog.pg_extension
				where extname in ${sql([...scope.requiredExtensionNames])}
				order by extname
			`;
	if (!namespace?.exists)
		return {
			application,
			applicationSchema,
			applicationSchemaExists: false,
			objects: [],
			unsupportedObjects: [],
			externalDependencies: [],
			installedRequiredExtensions: installedExtensions.map((item) => item.name),
		};

	const relations = await sql<
		{
			name: string;
			kind: string;
			persistence: string;
			rowSecurityEnabled: boolean;
			rowSecurityForced: boolean;
		}[]
	>`
		select c.relname as name,
		       c.relkind::text as kind,
		       c.relpersistence::text as persistence,
		       c.relrowsecurity as "rowSecurityEnabled",
		       c.relforcerowsecurity as "rowSecurityForced"
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${scope.applicationSchema}
		  and c.relkind <> 'i'
		order by c.relname
	`;
	const tables = relations.filter((relation) => relation.kind === "r");
	const supportedTables = tables.filter(
		(table) =>
			table.persistence === "p" &&
			!table.rowSecurityEnabled &&
			!table.rowSecurityForced,
	);
	const state: CatalogAccumulator = {
		objects: [
			{ kind: "schema", name: scope.applicationSchema },
			...supportedTables.map((table) => ({
				kind: "table",
				name: table.name,
				persistence: "permanent",
				rowSecurityEnabled: false,
				rowSecurityForced: false,
			})),
		],
		unsupportedObjects: relations
			.filter((relation) => relation.kind !== "r" && relation.kind !== "c")
			.map((relation) => ({
				kind: unsupportedRelationKind(relation.kind),
				qualifiedIdentity: `${scope.applicationSchema}.${relation.name}`,
				attachedTo: null,
			})),
		dependencies: new Map(),
	};
	for (const table of tables)
		if (
			table.persistence !== "p" ||
			table.rowSecurityEnabled ||
			table.rowSecurityForced
		)
			state.unsupportedObjects.push({
				kind: "other",
				qualifiedIdentity: `${scope.applicationSchema}.${table.name}`,
				attachedTo: null,
			});
	for (const table of supportedTables) {
		const columns = await readCatalogTableColumns(
			sql,
			scope.applicationSchema,
			table,
			state,
		);
		await readCatalogTableConstraintsAndIndexes(
			sql,
			scope.applicationSchema,
			table,
			columns,
			state,
		);
	}
	state.unsupportedObjects.push(
		...(await readUnsupportedCatalogObjects(sql, scope.applicationSchema)),
	);
	return {
		application,
		applicationSchema,
		applicationSchemaExists: true,
		objects: state.objects.sort(compareFingerprintObjects),
		unsupportedObjects: state.unsupportedObjects.sort(
			compareFingerprintObjects,
		),
		externalDependencies: [...state.dependencies.values()].sort(
			compareFingerprintDependencies,
		),
		installedRequiredExtensions: installedExtensions.map((item) => item.name),
	};
}

function unsupportedRelationKind(kind: string): string {
	if (kind === "v") return "view";
	if (kind === "m") return "materializedView";
	if (kind === "S") return "sequence";
	if (kind === "f") return "foreignTable";
	if (kind === "p") return "partitionedTable";
	return "other";
}
