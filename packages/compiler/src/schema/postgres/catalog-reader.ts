import type { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
import { parseCatalogCheck, parseCatalogDefault } from "./catalog-expression";
import {
	compareFingerprintDependencies,
	compareFingerprintObjects,
} from "./fingerprint-order";
import { fail } from "./shared";

type JsonRecord = Readonly<Record<string, unknown>>;

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
	const objects: JsonRecord[] = [
		{ kind: "schema", name: scope.applicationSchema },
		...tables.map((table) => ({
			kind: "table",
			name: table.name,
			persistence: table.persistence === "p" ? "permanent" : table.persistence,
			rowSecurityEnabled: table.rowSecurityEnabled,
			rowSecurityForced: table.rowSecurityForced,
		})),
	];
	const unsupportedObjects: JsonRecord[] = relations
		.filter((relation) => relation.kind !== "r")
		.map((relation) => ({
			kind:
				relation.kind === "v"
					? "view"
					: relation.kind === "m"
						? "materializedView"
						: relation.kind === "S"
							? "sequence"
							: relation.kind === "f"
								? "foreignTable"
								: relation.kind === "p"
									? "partitionedTable"
									: "other",
			qualifiedIdentity: `${scope.applicationSchema}.${relation.name}`,
			attachedTo: null,
		}));
	for (const table of tables)
		if (
			table.persistence !== "p" ||
			table.rowSecurityEnabled ||
			table.rowSecurityForced
		)
			unsupportedObjects.push({
				kind: "other",
				qualifiedIdentity: `${scope.applicationSchema}.${table.name}`,
				attachedTo: null,
			});
	const dependencies = new Map<string, JsonRecord>();
	for (const table of tables) {
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
			where n.nspname = ${scope.applicationSchema} and c.relname = ${table.name}
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
			objects.push({
				kind: "column",
				table: table.name,
				name: column.name,
				type,
				nullable: column.nullable,
				default: defaultValue,
				identity: column.identity === "" ? "none" : column.identity,
				generated: column.generated === "" ? "none" : column.generated,
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
			dependencies.set(canonicalBytes(dependency), dependency);
			if (column.collation !== null) {
				const collationDependency = {
					kind: "collation",
					schema: String(column.collationNamespace),
					name: column.collation,
					extension: column.collationExtension,
				};
				dependencies.set(
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
				dependencies.set(
					canonicalBytes(functionDependency),
					functionDependency,
				);
			}
			if (
				type.kind === "unsupported" ||
				(column.defaultExpression !== null && defaultValue === null) ||
				((defaultValue?.kind === "randomUuid" ||
					defaultValue?.kind === "now") &&
					(defaultFunction?.namespace !== "pg_catalog" ||
						defaultFunction.name !==
							(defaultValue.kind === "randomUuid"
								? "gen_random_uuid"
								: "now"))) ||
				(column.collation !== null &&
					(column.collationNamespace !== "pg_catalog" ||
						column.collation !== "C")) ||
				column.identity !== "" ||
				column.generated !== ""
			)
				unsupportedObjects.push({
					kind: "other",
					qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${column.name}`,
					attachedTo: `${scope.applicationSchema}.${table.name}`,
				});
		}
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
			where n.nspname = ${scope.applicationSchema} and source.relname = ${table.name}
			order by con.conname
		`;
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
				unsupportedObjects.push({
					kind: "other",
					qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${constraint.name}`,
					attachedTo: `${scope.applicationSchema}.${table.name}`,
				});
		for (const constraint of constraints) {
			// PostgreSQL 18 represents NOT NULL as a catalog Constraint as well as
			// attnotnull. Fingerprint v1 owns nullability on the column object.
			if (constraint.type === "n") continue;
			if (constraint.type === "c") {
				if (
					!constraint.local ||
					constraint.inheritedCount !== 0 ||
					constraint.noInherit ||
					constraint.deferrable ||
					constraint.initiallyDeferred
				) {
					unsupportedObjects.push({
						kind: "other",
						qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${constraint.name}`,
						attachedTo: `${scope.applicationSchema}.${table.name}`,
					});
					continue;
				}
				const expression = parseCatalogCheck(constraint.definition);
				if (expression)
					objects.push({
						kind: "check",
						table: table.name,
						name: constraint.name,
						expression,
						validated: constraint.validated,
					});
				else
					unsupportedObjects.push({
						kind: "other",
						qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${constraint.name}`,
						attachedTo: `${scope.applicationSchema}.${table.name}`,
					});
				continue;
			}
			if (constraint.type === "p" || constraint.type === "u")
				objects.push({
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
					constraint.referencedNamespace === scope.applicationSchema
				)
					objects.push({
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
					unsupportedObjects.push({
						kind: "other",
						qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${constraint.name}`,
						attachedTo: `${scope.applicationSchema}.${table.name}`,
					});
			} else
				unsupportedObjects.push({
					kind: "other",
					qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${constraint.name}`,
					attachedTo: `${scope.applicationSchema}.${table.name}`,
				});
		}
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
			where n.nspname = ${scope.applicationSchema} and source.relname = ${table.name}
			order by i.relname
		`;
		for (const index of indexes) {
			const terms = await sql<
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
				where n.nspname = ${scope.applicationSchema}
				  and source.relname = ${table.name}
				  and i.relname = ${index.name}
				order by term.position
			`;
			for (const term of terms) {
				const dependency = {
					kind: "operatorClass",
					schema: term.operatorClassNamespace,
					name: term.operatorClass,
					extension: term.operatorClassExtension,
				};
				dependencies.set(canonicalBytes(dependency), dependency);
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
					const constraintIndex = objects.findIndex(
						(object) =>
							(object.kind === "primaryKey" || object.kind === "unique") &&
							object.table === table.name &&
							object.name === index.constraintName,
					);
					if (constraintIndex >= 0) objects.splice(constraintIndex, 1);
					unsupportedObjects.push({
						kind: "other",
						qualifiedIdentity: `${scope.applicationSchema}.${table.name}.${index.constraintName}`,
						attachedTo: `${scope.applicationSchema}.${table.name}`,
					});
				}
				continue;
			}
			if (!hasSupportedIndexState(false, false)) {
				unsupportedObjects.push({
					kind: "other",
					qualifiedIdentity: `${scope.applicationSchema}.${index.name}`,
					attachedTo: `${scope.applicationSchema}.${table.name}`,
				});
				continue;
			}
			objects.push({
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
	const unsupportedCatalogObjects = await sql<
		{ kind: string; qualifiedIdentity: string; attachedTo: string | null }[]
	>`
		select case p.prokind when 'p' then 'procedure' else 'function' end as kind,
		       ${scope.applicationSchema} || '.' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' as "qualifiedIdentity",
		       null::text as "attachedTo"
		from pg_catalog.pg_proc p
		join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		where n.nspname = ${scope.applicationSchema}
		union all
		select case t.typtype when 'd' then 'domain' when 'e' then 'enum' else 'compositeType' end,
		       ${scope.applicationSchema} || '.' || t.typname,
		       null::text
		from pg_catalog.pg_type t
		join pg_catalog.pg_namespace n on n.oid = t.typnamespace
		where n.nspname = ${scope.applicationSchema}
		  and (t.typtype in ('d', 'e') or (t.typtype = 'c' and t.typrelid = 0))
		union all
		select 'trigger', ${scope.applicationSchema} || '.' || c.relname || '.' || tg.tgname,
		       ${scope.applicationSchema} || '.' || c.relname
		from pg_catalog.pg_trigger tg
		join pg_catalog.pg_class c on c.oid = tg.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${scope.applicationSchema} and not tg.tgisinternal
		union all
		select 'policy', ${scope.applicationSchema} || '.' || c.relname || '.' || pol.polname,
		       ${scope.applicationSchema} || '.' || c.relname
		from pg_catalog.pg_policy pol
		join pg_catalog.pg_class c on c.oid = pol.polrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${scope.applicationSchema}
		union all
		select 'rule', ${scope.applicationSchema} || '.' || c.relname || '.' || r.rulename,
		       ${scope.applicationSchema} || '.' || c.relname
		from pg_catalog.pg_rewrite r
		join pg_catalog.pg_class c on c.oid = r.ev_class
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${scope.applicationSchema} and r.rulename <> '_RETURN'
	`;
	unsupportedObjects.push(...unsupportedCatalogObjects);
	return {
		application,
		applicationSchema,
		applicationSchemaExists: true,
		objects: objects.sort(compareFingerprintObjects),
		unsupportedObjects: unsupportedObjects.sort(compareFingerprintObjects),
		externalDependencies: [...dependencies.values()].sort(
			compareFingerprintDependencies,
		),
		installedRequiredExtensions: installedExtensions.map((item) => item.name),
	};
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

function foreignKeyAction(value: string): string | undefined {
	if (value === "a") return "noAction";
	if (value === "r") return "restrict";
	if (value === "c") return "cascade";
	if (value === "n") return "setNull";
	return undefined;
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
