import type { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
import { parseCatalogCheck } from "./catalog-expression";
import type {
	CatalogAccumulator,
	CatalogColumn,
	CatalogTable,
} from "./catalog-reader-types";

export async function readCatalogTableConstraintsAndIndexes(
	sql: SQL,
	applicationSchema: string,
	table: CatalogTable,
	columns: readonly CatalogColumn[],
	state: CatalogAccumulator,
): Promise<void> {
	const constraints = await sql<
		{
			name: string;
			type: string;
			fields: string[];
			referencedTable: string | null;
			referencedNamespace: string | null;
			referencedFields: string[];
			onDelete: string;
			onUpdate: string;
			matchType: string;
			deleteSetFieldCount: number;
			definition: string;
			validated: boolean;
			deferrable: boolean;
			initiallyDeferred: boolean;
			local: boolean;
			inheritedCount: number;
			noInherit: boolean;
		}[]
	>`
		select con.conname as name,
		       con.contype::text as type,
		       coalesce(array(
		         select a.attname
		         from unnest(con.conkey) with ordinality as key(attnum, position)
		         join pg_catalog.pg_attribute a on a.attrelid = con.conrelid and a.attnum = key.attnum
		         order by key.position
		       ), array[]::name[])::text[] as fields,
		       target.relname as "referencedTable",
		       target_namespace.nspname as "referencedNamespace",
		       coalesce(array(
		         select a.attname
		         from unnest(con.confkey) with ordinality as key(attnum, position)
		         join pg_catalog.pg_attribute a on a.attrelid = con.confrelid and a.attnum = key.attnum
		         order by key.position
		       ), array[]::name[])::text[] as "referencedFields",
		       con.confdeltype::text as "onDelete",
		       con.confupdtype::text as "onUpdate",
		       con.confmatchtype::text as "matchType",
		       coalesce(pg_catalog.cardinality(con.confdelsetcols), 0)::integer as "deleteSetFieldCount",
		       pg_catalog.pg_get_expr(con.conbin, con.conrelid) as definition,
		       con.convalidated as validated,
		       con.condeferrable as deferrable,
		       con.condeferred as "initiallyDeferred",
		       con.conislocal as local,
		       con.coninhcount::integer as "inheritedCount",
		       con.connoinherit as "noInherit"
		from pg_catalog.pg_constraint con
		join pg_catalog.pg_class source on source.oid = con.conrelid
		join pg_catalog.pg_namespace n on n.oid = source.relnamespace
		left join pg_catalog.pg_class target on target.oid = con.confrelid
		left join pg_catalog.pg_namespace target_namespace on target_namespace.oid = target.relnamespace
		where n.nspname = ${applicationSchema} and source.relname = ${table.name}
		order by con.conname
	`;
	readConstraints(applicationSchema, table, columns, constraints, state);
	await readIndexes(sql, applicationSchema, table, state);
}

function readConstraints(
	applicationSchema: string,
	table: CatalogTable,
	columns: readonly CatalogColumn[],
	constraints: readonly Readonly<{
		name: string;
		type: string;
		fields: string[];
		referencedTable: string | null;
		referencedNamespace: string | null;
		referencedFields: string[];
		onDelete: string;
		onUpdate: string;
		matchType: string;
		deleteSetFieldCount: number;
		definition: string;
		validated: boolean;
		deferrable: boolean;
		initiallyDeferred: boolean;
		local: boolean;
		inheritedCount: number;
		noInherit: boolean;
	}>[],
	state: CatalogAccumulator,
): void {
	const notNullConstraints = constraints.filter(
		(constraint) => constraint.type === "n",
	);
	const notNullFields = columns
		.filter((column) => !column.nullable)
		.map((column) => column.name)
		.sort(compareAscii);
	const validNotNullConstraints =
		notNullConstraints.length === 0 ||
		(notNullConstraints.every(
			(constraint) =>
				constraint.fields.length === 1 &&
				constraint.validated &&
				!constraint.deferrable &&
				!constraint.initiallyDeferred &&
				constraint.local &&
				constraint.inheritedCount === 0 &&
				!constraint.noInherit,
		) &&
			canonicalBytes(
				notNullConstraints
					.map((constraint) => constraint.fields[0]!)
					.sort(compareAscii),
			) === canonicalBytes(notNullFields));
	if (!validNotNullConstraints)
		for (const constraint of notNullConstraints)
			state.unsupportedObjects.push(
				unsupportedConstraint(applicationSchema, table.name, constraint.name),
			);
	for (const constraint of constraints) {
		if (constraint.type === "n") continue;
		if (constraint.type === "c") {
			if (
				!constraint.local ||
				constraint.inheritedCount !== 0 ||
				constraint.noInherit ||
				constraint.deferrable ||
				constraint.initiallyDeferred
			) {
				state.unsupportedObjects.push(
					unsupportedConstraint(applicationSchema, table.name, constraint.name),
				);
				continue;
			}
			const expression = parseCatalogCheck(constraint.definition);
			if (expression)
				state.objects.push({
					kind: "check",
					table: table.name,
					name: constraint.name,
					expression,
					validated: constraint.validated,
				});
			else
				state.unsupportedObjects.push(
					unsupportedConstraint(applicationSchema, table.name, constraint.name),
				);
			continue;
		}
		if (constraint.type === "p" || constraint.type === "u")
			state.objects.push({
				kind: constraint.type === "p" ? "primaryKey" : "unique",
				table: table.name,
				name: constraint.name,
				fields: constraint.fields,
				validated: constraint.validated,
				deferrable: constraint.deferrable,
				initiallyDeferred: constraint.initiallyDeferred,
			});
		else if (constraint.type === "f") {
			const onDelete = foreignKeyAction(constraint.onDelete);
			const onUpdate = foreignKeyAction(constraint.onUpdate);
			if (
				onDelete &&
				onUpdate &&
				constraint.matchType === "s" &&
				constraint.deleteSetFieldCount === 0 &&
				constraint.referencedNamespace === applicationSchema
			)
				state.objects.push({
					kind: "foreignKey",
					table: table.name,
					name: constraint.name,
					fields: constraint.fields,
					referencedTable: constraint.referencedTable,
					referencedFields: constraint.referencedFields,
					onDelete,
					onUpdate,
					validated: constraint.validated,
					deferrable: constraint.deferrable,
					initiallyDeferred: constraint.initiallyDeferred,
				});
			else
				state.unsupportedObjects.push(
					unsupportedConstraint(applicationSchema, table.name, constraint.name),
				);
		} else
			state.unsupportedObjects.push(
				unsupportedConstraint(applicationSchema, table.name, constraint.name),
			);
	}
}

async function readIndexes(
	sql: SQL,
	applicationSchema: string,
	table: CatalogTable,
	state: CatalogAccumulator,
): Promise<void> {
	const indexes = await sql<
		{
			name: string;
			method: string;
			unique: boolean;
			valid: boolean;
			ready: boolean;
			predicate: string | null;
			hasExpressions: boolean;
			keyTermCount: number;
			totalTermCount: number;
			nullsNotDistinct: boolean;
			constraintBacked: boolean;
			constraintName: string | null;
		}[]
	>`
		select i.relname as name,
		       am.amname as method,
		       x.indisunique as unique,
		       x.indisvalid as valid,
		       x.indisready as ready,
		       pg_catalog.pg_get_expr(x.indpred, x.indrelid) as predicate,
		       x.indexprs is not null as "hasExpressions",
		       x.indnkeyatts::integer as "keyTermCount",
		       x.indnatts::integer as "totalTermCount",
		       x.indnullsnotdistinct as "nullsNotDistinct",
		       con.oid is not null as "constraintBacked",
		       con.conname as "constraintName"
		from pg_catalog.pg_index x
		join pg_catalog.pg_class i on i.oid = x.indexrelid
		join pg_catalog.pg_class source on source.oid = x.indrelid
		join pg_catalog.pg_namespace n on n.oid = source.relnamespace
		join pg_catalog.pg_am am on am.oid = i.relam
		left join pg_catalog.pg_constraint con on con.conindid = x.indexrelid
		where n.nspname = ${applicationSchema} and source.relname = ${table.name}
		order by i.relname
	`;
	for (const index of indexes) {
		const terms = await readIndexTerms(
			sql,
			applicationSchema,
			table.name,
			index.name,
		);
		for (const term of terms) {
			const dependency = {
				kind: "operatorClass",
				schema: term.operatorClassNamespace,
				name: term.operatorClass,
				extension: term.operatorClassExtension,
			};
			state.dependencies.set(canonicalBytes(dependency), dependency);
		}
		const hasSupportedIndexState = (unique: boolean, requireReady: boolean) =>
			index.method === "btree" &&
			index.unique === unique &&
			(!requireReady || (index.valid && index.ready)) &&
			index.predicate === null &&
			!index.hasExpressions &&
			!index.nullsNotDistinct &&
			index.totalTermCount === index.keyTermCount &&
			terms.length === index.keyTermCount &&
			terms.every(
				(term) =>
					term.field !== null &&
					term.operatorClassDefault &&
					term.operatorClassNamespace === "pg_catalog" &&
					(term.collation === null ||
						(term.collationNamespace === "pg_catalog" &&
							term.collation === "C")),
			);
		if (index.constraintBacked) {
			if (!hasSupportedIndexState(true, true)) {
				const constraintIndex = state.objects.findIndex(
					(object) =>
						(object.kind === "primaryKey" || object.kind === "unique") &&
						object.table === table.name &&
						object.name === index.constraintName,
				);
				if (constraintIndex >= 0) state.objects.splice(constraintIndex, 1);
				state.unsupportedObjects.push(
					unsupportedConstraint(
						applicationSchema,
						table.name,
						String(index.constraintName),
					),
				);
			}
			continue;
		}
		if (!hasSupportedIndexState(false, false)) {
			state.unsupportedObjects.push({
				kind: "other",
				qualifiedIdentity: `${applicationSchema}.${index.name}`,
				attachedTo: `${applicationSchema}.${table.name}`,
			});
			continue;
		}
		state.objects.push({
			kind: "index",
			table: table.name,
			name: index.name,
			method: "btree",
			unique: false,
			fields: terms.map((term) => ({
				field: term.field,
				order: (term.options & 1) === 1 ? "desc" : "asc",
				nulls: (term.options & 2) === 2 ? "first" : "last",
				operatorClass: "typeDefault",
				collation: term.collation === "C" ? "field" : null,
			})),
			predicate: null,
			valid: index.valid,
			ready: index.ready,
		});
	}
}

async function readIndexTerms(
	sql: SQL,
	applicationSchema: string,
	table: string,
	index: string,
) {
	return sql<
		{
			field: string | null;
			operatorClass: string;
			operatorClassNamespace: string;
			operatorClassDefault: boolean;
			operatorClassExtension: string | null;
			collation: string | null;
			collationNamespace: string | null;
			options: number;
		}[]
	>`
		select a.attname as field,
		       op.opcname as "operatorClass",
		       opn.nspname as "operatorClassNamespace",
		       op.opcdefault as "operatorClassDefault",
		       (
		         select ext.extname
		         from pg_catalog.pg_depend dep
		         join pg_catalog.pg_extension ext on ext.oid = dep.refobjid
		         where dep.classid = 'pg_catalog.pg_opclass'::pg_catalog.regclass
		           and dep.objid = op.oid
		           and dep.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
		           and dep.deptype = 'e'
		         limit 1
		       ) as "operatorClassExtension",
		       coll.collname as collation,
		       colln.nspname as "collationNamespace",
		       term.options::integer as options
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
		left join pg_catalog.pg_collation coll on coll.oid = term.collationoid and term.collationoid <> 0
		left join pg_catalog.pg_namespace colln on colln.oid = coll.collnamespace
		where n.nspname = ${applicationSchema}
		  and source.relname = ${table}
		  and i.relname = ${index}
		order by term.position
	`;
}

function unsupportedConstraint(
	applicationSchema: string,
	table: string,
	constraint: string,
) {
	return {
		kind: "other",
		qualifiedIdentity: `${applicationSchema}.${table}.${constraint}`,
		attachedTo: `${applicationSchema}.${table}`,
	};
}

function foreignKeyAction(value: string): string | undefined {
	if (value === "a") return "noAction";
	if (value === "r") return "restrict";
	if (value === "c") return "cascade";
	if (value === "n") return "setNull";
	return undefined;
}
