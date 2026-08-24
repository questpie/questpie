import type { SQL } from "bun";

import { canonicalBytes } from "../../canonical";
import { parseCatalogDefault } from "./catalog-expression";
import {
	catalogColumnsStatement,
	type CatalogColumnRow,
} from "./catalog-reader-statements";
import type {
	CatalogAccumulator,
	CatalogColumn,
	CatalogTable,
	JsonRecord,
} from "./catalog-reader-types";

export async function readCatalogColumns(
	sql: SQL,
	applicationSchema: string,
): Promise<readonly CatalogColumnRow[]> {
	const rows = (await sql
		.unsafe(catalogColumnsStatement.text, [applicationSchema])
		.values()) as unknown as readonly (readonly unknown[])[] & {
		readonly command: string;
		readonly count: number;
	};
	return catalogColumnsStatement.decode({
		command: rows.command,
		rowCount: rows.count,
		rows,
	});
}

export function reduceCatalogTableColumns(
	applicationSchema: string,
	table: CatalogTable,
	rows: readonly CatalogColumnRow[],
	state: CatalogAccumulator,
): readonly CatalogColumn[] {
	const columns = rows.filter((row) => row.table === table.name);
	for (const column of columns) {
		const type = catalogFieldType(column);
		const defaultValue = parseCatalogDefault(column.defaultExpression);
		const defaultFunction =
			defaultValue?.kind === "randomUuid" || defaultValue?.kind === "now"
				? {
						name: column.defaultFunctionName,
						namespace: column.defaultFunctionNamespace,
						extension: column.defaultFunctionExtension,
					}
				: null;
		const unsupportedColumnState =
			type.kind === "unsupported" ||
			(column.defaultExpression !== null && defaultValue === null) ||
			((defaultValue?.kind === "randomUuid" || defaultValue?.kind === "now") &&
				(defaultFunction?.namespace !== "pg_catalog" ||
					defaultFunction.name !==
						(defaultValue.kind === "randomUuid"
							? "gen_random_uuid"
							: "now"))) ||
			(column.collation !== null &&
				(column.collationNamespace !== "pg_catalog" ||
					column.collation !== "C")) ||
			column.identity !== "" ||
			column.generated !== "";
		if (!unsupportedColumnState)
			state.objects.push({
				kind: "column",
				table: table.name,
				name: column.name,
				type,
				nullable: column.nullable,
				default: defaultValue,
				identity: "none",
				generated: "none",
				collation:
					column.collation === null
						? null
						: `${column.collationNamespace}.${column.collation}`,
			});
		const dependency = {
			kind: "type",
			schema: column.typeNamespace,
			name: column.type,
			extension: column.typeExtension,
		};
		state.dependencies.set(canonicalBytes(dependency), dependency);
		if (column.collation !== null) {
			const collationDependency = {
				kind: "collation",
				schema: String(column.collationNamespace),
				name: column.collation,
				extension: column.collationExtension,
			};
			state.dependencies.set(
				canonicalBytes(collationDependency),
				collationDependency,
			);
		}
		if (defaultValue?.kind === "randomUuid" || defaultValue?.kind === "now") {
			const functionDependency = {
				kind: "defaultFunction",
				schema: defaultFunction?.namespace ?? null,
				name: defaultFunction?.name ?? null,
				extension: defaultFunction?.extension ?? null,
			};
			state.dependencies.set(
				canonicalBytes(functionDependency),
				functionDependency,
			);
		}
		if (unsupportedColumnState)
			state.unsupportedObjects.push({
				kind: "other",
				qualifiedIdentity: `${applicationSchema}.${table.name}.${column.name}`,
				attachedTo: `${applicationSchema}.${table.name}`,
			});
	}
	return columns.map(({ name, nullable }) => ({ name, nullable }));
}

function catalogFieldType(
	column: Readonly<{
		type: string;
		typeNamespace: string;
		typeModifier: string | null;
	}>,
): JsonRecord {
	if (column.typeNamespace !== "pg_catalog") return { kind: "unsupported" };
	if (column.type === "uuid") return { kind: "uuid" };
	if (column.type === "text") return { kind: "text" };
	if (column.type === "bool") return { kind: "boolean" };
	if (column.type === "int4") return { kind: "integer" };
	if (column.type === "int8") return { kind: "bigint" };
	if (column.type === "date") return { kind: "date" };
	if (column.type === "timestamp")
		return { kind: "timestamp", withTimezone: false };
	if (column.type === "timestamptz")
		return { kind: "timestamp", withTimezone: true };
	if (column.type === "jsonb") return { kind: "jsonb" };
	if (column.type === "numeric") {
		const match = /^numeric\((\d+),(\d+)\)$/.exec(column.typeModifier ?? "");
		return match
			? {
					kind: "numeric",
					precision: Number(match[1]),
					scale: Number(match[2]),
				}
			: { kind: "unsupported" };
	}
	return { kind: "unsupported" };
}
