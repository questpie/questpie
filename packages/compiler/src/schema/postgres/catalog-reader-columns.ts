import type { SQL } from "bun";

import { canonicalBytes } from "../../canonical";
import { parseCatalogDefault } from "./catalog-expression";
import type {
	CatalogAccumulator,
	CatalogColumn,
	CatalogTable,
	JsonRecord,
} from "./catalog-reader-types";

export async function readCatalogTableColumns(
	sql: SQL,
	applicationSchema: string,
	table: CatalogTable,
	state: CatalogAccumulator,
): Promise<readonly CatalogColumn[]> {
	const columns = await sql<
		{
			name: string;
			type: string;
			typeNamespace: string;
			typeExtension: string | null;
			typeModifier: string | null;
			nullable: boolean;
			defaultExpression: string | null;
			collation: string | null;
			collationNamespace: string | null;
			collationExtension: string | null;
			identity: string;
			generated: string;
		}[]
	>`
		select a.attname as name,
		       t.typname as type,
		       tn.nspname as "typeNamespace",
		       (
		         select ext.extname
		         from pg_catalog.pg_depend dep
		         join pg_catalog.pg_extension ext on ext.oid = dep.refobjid
		         where dep.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
		           and dep.objid = t.oid
		           and dep.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
		           and dep.deptype = 'e'
		         limit 1
		       ) as "typeExtension",
		       case when t.typname = 'numeric' then pg_catalog.format_type(a.atttypid, a.atttypmod) else null end as "typeModifier",
		       not a.attnotnull as nullable,
		       pg_catalog.pg_get_expr(d.adbin, d.adrelid) as "defaultExpression",
		       coll.collname as collation,
		       colln.nspname as "collationNamespace",
		       (
		         select ext.extname
		         from pg_catalog.pg_depend dep
		         join pg_catalog.pg_extension ext on ext.oid = dep.refobjid
		         where dep.classid = 'pg_catalog.pg_collation'::pg_catalog.regclass
		           and dep.objid = coll.oid
		           and dep.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
		           and dep.deptype = 'e'
		         limit 1
		       ) as "collationExtension",
		       a.attidentity as identity,
		       a.attgenerated as generated
		from pg_catalog.pg_attribute a
		join pg_catalog.pg_class c on c.oid = a.attrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		join pg_catalog.pg_type t on t.oid = a.atttypid
		join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace
		left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
		left join pg_catalog.pg_collation coll on coll.oid = a.attcollation and a.attcollation <> 0
		left join pg_catalog.pg_namespace colln on colln.oid = coll.collnamespace
		where n.nspname = ${applicationSchema} and c.relname = ${table.name}
		  and a.attnum > 0 and not a.attisdropped
		order by a.attname
	`;
	for (const column of columns) {
		const type = catalogFieldType(column);
		const defaultValue = parseCatalogDefault(column.defaultExpression);
		const defaultFunction =
			defaultValue?.kind === "randomUuid" || defaultValue?.kind === "now"
				? await readDefaultFunctionDependency(sql, defaultValue.kind)
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
	return columns;
}

async function readDefaultFunctionDependency(
	sql: SQL,
	kind: "randomUuid" | "now",
): Promise<
	| Readonly<{ name: string; namespace: string; extension: string | null }>
	| undefined
> {
	const name = kind === "randomUuid" ? "gen_random_uuid" : "now";
	const [functionDependency] = await sql<
		{ name: string; namespace: string; extension: string | null }[]
	>`
		select p.proname as name, n.nspname as namespace, ext.extname as extension
		from pg_catalog.pg_proc p
		join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		left join pg_catalog.pg_depend owner
		  on owner.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
		 and owner.objid = p.oid
		 and owner.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
		 and owner.deptype = 'e'
		left join pg_catalog.pg_extension ext on ext.oid = owner.refobjid
		where n.nspname = 'pg_catalog' and p.proname = ${name} and p.pronargs = 0
		order by p.oid
		limit 1
	`;
	return functionDependency;
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
