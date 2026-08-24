type CatalogResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

export interface CatalogStatement<Row> {
	readonly name: string;
	readonly text: string;
	readonly parameterCount: 1;
	parameters(applicationSchema: string): readonly [string];
	decode(result: CatalogResult): readonly Row[];
}

export interface CatalogStatementSql {
	unsafe(
		text: string,
		parameters: unknown[],
	): Readonly<{ values(): Promise<unknown> }>;
}

export async function executeCatalogStatement<Row>(
	sql: CatalogStatementSql,
	statement: CatalogStatement<Row>,
	applicationSchema: string,
): Promise<readonly Row[]> {
	const rows = (await sql
		.unsafe(statement.text, [...statement.parameters(applicationSchema)])
		.values()) as readonly (readonly unknown[])[] & {
		readonly command: string;
		readonly count: number;
	};
	return statement.decode({
		command: rows.command,
		rowCount: rows.count,
		rows,
	});
}

export interface CatalogRelationRow {
	readonly name: string;
	readonly kind: string;
	readonly inheritanceInvolved: boolean;
	readonly persistence: string;
	readonly replicaIdentity: string;
	readonly rowSecurityEnabled: boolean;
	readonly rowSecurityForced: boolean;
}

export interface CatalogColumnRow {
	readonly table: string;
	readonly name: string;
	readonly type: string;
	readonly typeNamespace: string;
	readonly typeExtension: string | null;
	readonly typeModifier: string | null;
	readonly nullable: boolean;
	readonly defaultExpression: string | null;
	readonly collation: string | null;
	readonly collationNamespace: string | null;
	readonly collationExtension: string | null;
	readonly identity: string;
	readonly generated: string;
	readonly defaultFunctionName: string | null;
	readonly defaultFunctionNamespace: string | null;
	readonly defaultFunctionExtension: string | null;
}

export interface CatalogConstraintRow {
	readonly table: string;
	readonly name: string;
	readonly type: string;
	readonly fields: readonly string[];
	readonly referencedTable: string | null;
	readonly referencedNamespace: string | null;
	readonly referencedFields: readonly string[];
	readonly onDelete: string;
	readonly onUpdate: string;
	readonly matchType: string;
	readonly deleteSetFieldCount: number;
	readonly definition: string | null;
	readonly validated: boolean;
	readonly deferrable: boolean;
	readonly initiallyDeferred: boolean;
	readonly enforced: boolean;
	readonly period: boolean;
	readonly local: boolean;
	readonly inheritedCount: number;
	readonly noInherit: boolean;
}

export interface CatalogIndexRow {
	readonly table: string;
	readonly name: string;
	readonly method: string;
	readonly unique: boolean;
	readonly valid: boolean;
	readonly ready: boolean;
	readonly predicate: string | null;
	readonly hasExpressions: boolean;
	readonly keyTermCount: number;
	readonly totalTermCount: number;
	readonly nullsNotDistinct: boolean;
	readonly constraintBacked: boolean;
	readonly constraintName: string | null;
}

export interface CatalogIndexTermRow {
	readonly table: string;
	readonly index: string;
	readonly field: string | null;
	readonly operatorClass: string;
	readonly operatorClassNamespace: string;
	readonly operatorClassDefault: boolean;
	readonly operatorClassExtension: string | null;
	readonly collation: string | null;
	readonly collationNamespace: string | null;
	readonly options: number;
	readonly position: number;
}

export function defineCatalogStatement<Row>(
	input: Readonly<{
		name: string;
		text: string;
		decodeRow(row: readonly unknown[]): Row;
	}>,
): CatalogStatement<Row> {
	return Object.freeze({
		name: input.name,
		text: input.text,
		parameterCount: 1 as const,
		parameters(applicationSchema: string): readonly [string] {
			return [applicationSchema];
		},
		decode(result: CatalogResult): readonly Row[] {
			if (result.command !== "SELECT" || result.rowCount !== result.rows.length)
				return invalid(input.name);
			try {
				return Object.freeze(result.rows.map(input.decodeRow));
			} catch {
				return invalid(input.name);
			}
		},
	});
}

function invalid(name: string): never {
	throw new TypeError(`invalid ${name} result`);
}

function rowLength(row: readonly unknown[], length: number): void {
	if (!Array.isArray(row) || row.length !== length) throw new TypeError();
}

function string(value: unknown): string {
	if (typeof value !== "string") throw new TypeError();
	return value;
}

function nullableString(value: unknown): string | null {
	return value === null ? null : string(value);
}

function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw new TypeError();
	return value;
}

function integer(value: unknown, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum)
		throw new TypeError();
	return value as number;
}

function strings(value: unknown): readonly string[] {
	if (!Array.isArray(value)) throw new TypeError();
	return Object.freeze(value.map(string));
}

export const catalogRelationsStatement = defineCatalogStatement({
	name: "catalog.relations",
	text: `
select c.relname::text,
       c.relkind::text,
       exists(
         select 1 from pg_catalog.pg_inherits inheritance
         where inheritance.inhrelid = c.oid or inheritance.inhparent = c.oid
       ),
       c.relpersistence::text,
       c.relreplident::text,
       c.relrowsecurity,
       c.relforcerowsecurity
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = $1 and c.relkind <> 'i'
order by c.relname
`,
	decodeRow(row): CatalogRelationRow {
		rowLength(row, 7);
		return Object.freeze({
			name: string(row[0]),
			kind: string(row[1]),
			inheritanceInvolved: boolean(row[2]),
			persistence: string(row[3]),
			replicaIdentity: string(row[4]),
			rowSecurityEnabled: boolean(row[5]),
			rowSecurityForced: boolean(row[6]),
		});
	},
});

export const catalogColumnsStatement = defineCatalogStatement({
	name: "catalog.columns",
	text: `
select c.relname::text,
       a.attname::text,
       t.typname::text,
       tn.nspname::text,
       type_ext.extname::text,
       case when t.typname = 'numeric' then pg_catalog.format_type(a.atttypid, a.atttypmod) else null end,
       not a.attnotnull,
       pg_catalog.pg_get_expr(d.adbin, d.adrelid),
       coll.collname::text,
       colln.nspname::text,
       collation_ext.extname::text,
       a.attidentity::text,
       a.attgenerated::text,
       default_function.proname::text,
       default_function_namespace.nspname::text,
       default_function_ext.extname::text
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_type t on t.oid = a.atttypid
join pg_catalog.pg_namespace tn on tn.oid = t.typnamespace
left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
left join pg_catalog.pg_collation coll on coll.oid = a.attcollation and a.attcollation <> 0
left join pg_catalog.pg_namespace colln on colln.oid = coll.collnamespace
left join pg_catalog.pg_depend type_owner
  on type_owner.classid = 'pg_catalog.pg_type'::pg_catalog.regclass
 and type_owner.objid = t.oid
 and type_owner.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
 and type_owner.deptype = 'e'
left join pg_catalog.pg_extension type_ext on type_ext.oid = type_owner.refobjid
left join pg_catalog.pg_depend collation_owner
  on collation_owner.classid = 'pg_catalog.pg_collation'::pg_catalog.regclass
 and collation_owner.objid = coll.oid
 and collation_owner.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
 and collation_owner.deptype = 'e'
left join pg_catalog.pg_extension collation_ext on collation_ext.oid = collation_owner.refobjid
left join pg_catalog.pg_proc default_function
  on default_function.pronamespace = 'pg_catalog'::pg_catalog.regnamespace
 and default_function.pronargs = 0
 and default_function.proname = case
   when pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()' then 'gen_random_uuid'
   when pg_catalog.pg_get_expr(d.adbin, d.adrelid) = 'now()' then 'now'
 end
left join pg_catalog.pg_namespace default_function_namespace
  on default_function_namespace.oid = default_function.pronamespace
left join pg_catalog.pg_depend default_function_owner
  on default_function_owner.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
 and default_function_owner.objid = default_function.oid
 and default_function_owner.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
 and default_function_owner.deptype = 'e'
left join pg_catalog.pg_extension default_function_ext on default_function_ext.oid = default_function_owner.refobjid
where n.nspname = $1 and c.relkind = 'r'
  and a.attnum > 0 and not a.attisdropped
order by c.relname, a.attname
`,
	decodeRow(row): CatalogColumnRow {
		rowLength(row, 16);
		return Object.freeze({
			table: string(row[0]),
			name: string(row[1]),
			type: string(row[2]),
			typeNamespace: string(row[3]),
			typeExtension: nullableString(row[4]),
			typeModifier: nullableString(row[5]),
			nullable: boolean(row[6]),
			defaultExpression: nullableString(row[7]),
			collation: nullableString(row[8]),
			collationNamespace: nullableString(row[9]),
			collationExtension: nullableString(row[10]),
			identity: string(row[11]),
			generated: string(row[12]),
			defaultFunctionName: nullableString(row[13]),
			defaultFunctionNamespace: nullableString(row[14]),
			defaultFunctionExtension: nullableString(row[15]),
		});
	},
});

export const catalogConstraintsStatement = defineCatalogStatement({
	name: "catalog.constraints",
	text: `
select source.relname::text,
       con.conname::text,
       con.contype::text,
       coalesce(array(
         select a.attname
         from unnest(con.conkey) with ordinality as key(attnum, position)
         join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = key.attnum
         order by key.position
       ), array[]::name[])::text[],
       target.relname::text,
       target_namespace.nspname::text,
       coalesce(array(
         select a.attname
         from unnest(con.confkey) with ordinality as key(attnum, position)
         join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = key.attnum
         order by key.position
       ), array[]::name[])::text[],
       con.confdeltype::text,
       con.confupdtype::text,
       con.confmatchtype::text,
       coalesce(pg_catalog.cardinality(con.confdelsetcols), 0)::integer,
       pg_catalog.pg_get_expr(con.conbin, con.conrelid),
       con.convalidated,
       con.condeferrable,
       con.condeferred,
       coalesce((pg_catalog.to_jsonb(con)->>'conenforced')::boolean, true),
       coalesce((pg_catalog.to_jsonb(con)->>'conperiod')::boolean, false),
       con.conislocal,
       con.coninhcount::integer,
       con.connoinherit
from pg_catalog.pg_constraint con
join pg_catalog.pg_class source on source.oid = con.conrelid
join pg_catalog.pg_namespace n on n.oid = source.relnamespace
left join pg_catalog.pg_class target on target.oid = con.confrelid
left join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target.relnamespace
where n.nspname = $1
order by source.relname, con.conname
`,
	decodeRow(row): CatalogConstraintRow {
		rowLength(row, 20);
		return Object.freeze({
			table: string(row[0]),
			name: string(row[1]),
			type: string(row[2]),
			fields: strings(row[3]),
			referencedTable: nullableString(row[4]),
			referencedNamespace: nullableString(row[5]),
			referencedFields: strings(row[6]),
			onDelete: string(row[7]),
			onUpdate: string(row[8]),
			matchType: string(row[9]),
			deleteSetFieldCount: integer(row[10]),
			definition: nullableString(row[11]),
			validated: boolean(row[12]),
			deferrable: boolean(row[13]),
			initiallyDeferred: boolean(row[14]),
			enforced: boolean(row[15]),
			period: boolean(row[16]),
			local: boolean(row[17]),
			inheritedCount: integer(row[18]),
			noInherit: boolean(row[19]),
		});
	},
});

export const catalogIndexesStatement = defineCatalogStatement({
	name: "catalog.indexes",
	text: `
select source.relname::text,
       i.relname::text,
       am.amname::text,
       x.indisunique,
       x.indisvalid,
       x.indisready,
       pg_catalog.pg_get_expr(x.indpred, x.indrelid),
       x.indexprs is not null,
       x.indnkeyatts::integer,
       x.indnatts::integer,
       x.indnullsnotdistinct,
       con.oid is not null,
       con.conname::text
from pg_catalog.pg_index x
join pg_catalog.pg_class i on i.oid = x.indexrelid
join pg_catalog.pg_class source on source.oid = x.indrelid
join pg_catalog.pg_namespace n on n.oid = source.relnamespace
join pg_catalog.pg_am am on am.oid = i.relam
left join pg_catalog.pg_constraint con on con.conindid = x.indexrelid
where n.nspname = $1
order by source.relname, i.relname
`,
	decodeRow(row): CatalogIndexRow {
		rowLength(row, 13);
		return Object.freeze({
			table: string(row[0]),
			name: string(row[1]),
			method: string(row[2]),
			unique: boolean(row[3]),
			valid: boolean(row[4]),
			ready: boolean(row[5]),
			predicate: nullableString(row[6]),
			hasExpressions: boolean(row[7]),
			keyTermCount: integer(row[8]),
			totalTermCount: integer(row[9]),
			nullsNotDistinct: boolean(row[10]),
			constraintBacked: boolean(row[11]),
			constraintName: nullableString(row[12]),
		});
	},
});

export const catalogIndexTermsStatement = defineCatalogStatement({
	name: "catalog.index-terms",
	text: `
select source.relname::text,
       i.relname::text,
       a.attname::text,
       op.opcname::text,
       opn.nspname::text,
       op.opcdefault,
       ext.extname::text,
       coll.collname::text,
       colln.nspname::text,
       term.options::integer,
       term.position::integer
from pg_catalog.pg_index x
join pg_catalog.pg_class i on i.oid = x.indexrelid
join pg_catalog.pg_class source on source.oid = x.indrelid
join pg_catalog.pg_namespace n on n.oid = source.relnamespace
cross join lateral unnest(
  x.indkey::smallint[],
  x.indclass::oid[],
  x.indcollation::oid[],
  x.indoption::smallint[]
) with ordinality as term(attnum, opclassoid, collationoid, options, position)
left join pg_catalog.pg_attribute a on a.attrelid = x.indrelid and a.attnum = term.attnum
join pg_catalog.pg_opclass op on op.oid = term.opclassoid
join pg_catalog.pg_namespace opn on opn.oid = op.opcnamespace
left join pg_catalog.pg_depend owner
  on owner.classid = 'pg_catalog.pg_opclass'::pg_catalog.regclass
 and owner.objid = op.oid
 and owner.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
 and owner.deptype = 'e'
left join pg_catalog.pg_extension ext on ext.oid = owner.refobjid
left join pg_catalog.pg_collation coll on coll.oid = term.collationoid and term.collationoid <> 0
left join pg_catalog.pg_namespace colln on colln.oid = coll.collnamespace
where n.nspname = $1
order by source.relname, i.relname, term.position
`,
	decodeRow(row): CatalogIndexTermRow {
		rowLength(row, 11);
		return Object.freeze({
			table: string(row[0]),
			index: string(row[1]),
			field: nullableString(row[2]),
			operatorClass: string(row[3]),
			operatorClassNamespace: string(row[4]),
			operatorClassDefault: boolean(row[5]),
			operatorClassExtension: nullableString(row[6]),
			collation: nullableString(row[7]),
			collationNamespace: nullableString(row[8]),
			options: integer(row[9]),
			position: integer(row[10], 1),
		});
	},
});
