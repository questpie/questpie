import { SQL } from "bun";

import { canonicalBytes, compareAscii, digest } from "../../canonical";
import type { SchemaProjectionV1 } from "../contracts";
import { expectedDefault, physicalType } from "../postgres-catalog";
import type { SchemaFingerprintV1 } from "../postgres-types";
import {
	expectedComparable,
	expectedConstraintDefinition,
	expectedIndexDefinition,
	postgresIdentifierQuoter,
} from "./expected-fingerprint";
import { childRecords, fail } from "./shared";

type JsonRecord = Readonly<Record<string, unknown>>;
type ProviderObservations = SchemaFingerprintV1["observations"];

export async function assertSchemaMatches(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<JsonRecord> {
	const schemaName = schema.application.postgresSchema;
	const [namespace] = await sql<{ exists: boolean }[]>`
		select exists(select 1 from pg_catalog.pg_namespace where nspname = ${schemaName}) as exists
	`;
	const expected = expectedComparable(schema);
	const quoteIdentifier = await postgresIdentifierQuoter(sql);
	const observedObjects: JsonRecord[] = [{ kind: "schema", name: schemaName }];
	if (!namespace?.exists)
		return fail(
			"QP-SCHEMA-028",
			"missingObject",
			`application schema ${schemaName} is missing`,
		);
	const tables = await sql<
		{
			name: string;
			persistence: string;
			rowSecurityEnabled: boolean;
			rowSecurityForced: boolean;
		}[]
	>`
		select c.relname as name,
		       c.relpersistence::text as persistence,
		       c.relrowsecurity as "rowSecurityEnabled",
		       c.relforcerowsecurity as "rowSecurityForced"
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${schemaName} and c.relkind = 'r'
		order by c.relname
	`;
	const expectedTables = schema.collections
		.map((collection) => String(collection.postgresName))
		.sort(compareAscii);
	if (
		canonicalBytes(tables.map((table) => table.name)) !==
			canonicalBytes(expectedTables) ||
		tables.some(
			(table) =>
				table.persistence !== "p" ||
				table.rowSecurityEnabled ||
				table.rowSecurityForced,
		)
	)
		return fail(
			"QP-SCHEMA-028",
			"unexpectedObject",
			`application schema ${schemaName} has an unexpected table or RLS state`,
		);
	for (const table of tables)
		observedObjects.push({
			kind: "table",
			name: table.name,
			persistence: "permanent",
			rowSecurityEnabled: table.rowSecurityEnabled,
			rowSecurityForced: table.rowSecurityForced,
		});
	for (const collection of schema.collections) {
		const tableName = String(collection.postgresName);
		const columns = await sql<
			{
				name: string;
				type: string;
				typeNamespace: string;
				typeModifier: string | null;
				nullable: boolean;
				defaultExpression: string | null;
				collation: string | null;
				collationNamespace: string | null;
				identity: string;
				generated: string;
			}[]
		>`
			select a.attname as name,
			       t.typname as type,
			       tn.nspname as "typeNamespace",
			       case when t.typname = 'numeric' then pg_catalog.format_type(a.atttypid, a.atttypmod) else null end as "typeModifier",
			       not a.attnotnull as nullable,
			       pg_catalog.pg_get_expr(d.adbin, d.adrelid) as "defaultExpression",
			       coll.collname as collation,
			       colln.nspname as "collationNamespace",
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
			where n.nspname = ${schemaName} and c.relname = ${tableName}
			  and a.attnum > 0 and not a.attisdropped
			order by a.attname
		`;
		const expectedColumns = childRecords(collection, "fields")
			.map((field) => {
				const type = field.type as JsonRecord;
				return {
					name: String(field.postgresName),
					type: physicalType(field),
					typeNamespace: "pg_catalog",
					typeModifier:
						type.kind === "numeric"
							? `numeric(${type.precision},${type.scale})`
							: null,
					nullable: field.nullable === true,
					defaultExpression: expectedDefault(field),
					collation: field.collation === "questpie.binary" ? "C" : null,
					collationNamespace:
						field.collation === "questpie.binary" ? "pg_catalog" : null,
					identity: "",
					generated: "",
				};
			})
			.sort((left, right) => compareAscii(left.name, right.name));
		if (canonicalBytes(columns) !== canonicalBytes(expectedColumns))
			return fail(
				"QP-SCHEMA-028",
				"changedObject",
				`${collection.identity} columns do not match the committed projection`,
				{ expected: expectedColumns, actual: columns },
			);
		for (const column of columns) {
			const expectedObject = (expected.objects as readonly JsonRecord[]).find(
				(object) =>
					object.kind === "column" &&
					object.table === collection.postgresName &&
					object.name === column.name,
			);
			if (!expectedObject)
				return fail(
					"QP-SCHEMA-028",
					"unexpectedObject",
					`${collection.identity}/${column.name} has no semantic catalog parser`,
				);
			observedObjects.push({
				...expectedObject,
				nullable: column.nullable,
				identity: column.identity === "" ? "none" : column.identity,
				generated: column.generated === "" ? "none" : column.generated,
				collation: column.collation === "C" ? "pg_catalog.C" : column.collation,
			});
		}
		const constraints = await sql<
			{
				name: string;
				type: string;
				definition: string;
				validated: boolean;
				deferrable: boolean;
				initiallyDeferred: boolean;
			}[]
		>`
			select con.conname as name,
			       con.contype::text as type,
			       pg_catalog.pg_get_constraintdef(con.oid, true) as definition,
			       con.convalidated as validated,
			       con.condeferrable as deferrable,
			       con.condeferred as "initiallyDeferred"
			from pg_catalog.pg_constraint con
			join pg_catalog.pg_class c on c.oid = con.conrelid
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = ${schemaName} and c.relname = ${tableName}
			order by con.conname
		`;
		const expectedConstraints = (expected.objects as readonly JsonRecord[])
			.filter(
				(object) =>
					object.table === collection.postgresName &&
					["primaryKey", "unique", "check", "foreignKey"].includes(
						String(object.kind),
					),
			)
			.map((object) => ({
				name: String(object.name),
				type:
					object.kind === "primaryKey"
						? "p"
						: object.kind === "unique"
							? "u"
							: object.kind === "foreignKey"
								? "f"
								: "c",
				definition: expectedConstraintDefinition(
					object,
					schemaName,
					quoteIdentifier,
					collection,
				),
				validated: true,
				deferrable: object.kind === "check" ? false : object.deferrable,
				initiallyDeferred:
					object.kind === "check" ? false : object.initiallyDeferred,
			}))
			.sort((left, right) => compareAscii(left.name, right.name));
		if (canonicalBytes(constraints) !== canonicalBytes(expectedConstraints))
			return fail(
				"QP-SCHEMA-028",
				"changedObject",
				`${collection.identity} constraints do not match the committed projection`,
				{ expected: expectedConstraints, actual: constraints },
			);
		for (const constraint of constraints) {
			const expectedObject = (expected.objects as readonly JsonRecord[]).find(
				(object) =>
					object.table === collection.postgresName &&
					object.name === constraint.name,
			);
			if (!expectedObject)
				return fail(
					"QP-SCHEMA-028",
					"unexpectedObject",
					`${collection.identity}/${constraint.name} has no semantic catalog parser`,
				);
			observedObjects.push({
				...expectedObject,
				validated: constraint.validated,
				...(expectedObject.kind === "check"
					? {}
					: {
							deferrable: constraint.deferrable,
							initiallyDeferred: constraint.initiallyDeferred,
						}),
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
				definition: string;
			}[]
		>`
			select i.relname as name,
			       am.amname as method,
			       x.indisunique as unique,
			       x.indisvalid as valid,
			       x.indisready as ready,
			       pg_catalog.pg_get_expr(x.indpred, x.indrelid) as predicate,
			       pg_catalog.pg_get_indexdef(x.indexrelid) as definition
			from pg_catalog.pg_index x
			join pg_catalog.pg_class i on i.oid = x.indexrelid
			join pg_catalog.pg_class t on t.oid = x.indrelid
			join pg_catalog.pg_namespace n on n.oid = t.relnamespace
			join pg_catalog.pg_am am on am.oid = i.relam
			left join pg_catalog.pg_constraint con on con.conindid = x.indexrelid
			where n.nspname = ${schemaName} and t.relname = ${tableName}
			  and con.oid is null
			order by i.relname
		`;
		const expectedIndexes = (expected.objects as readonly JsonRecord[])
			.filter(
				(object) =>
					object.kind === "index" && object.table === collection.postgresName,
			)
			.map((index) => ({
				name: String(index.name),
				method: "btree",
				unique: false,
				valid: true,
				ready: true,
				predicate: null,
				definition: expectedIndexDefinition(index, schemaName, quoteIdentifier),
			}))
			.sort((left, right) => compareAscii(left.name, right.name));
		if (canonicalBytes(indexes) !== canonicalBytes(expectedIndexes))
			return fail(
				"QP-SCHEMA-028",
				"changedObject",
				`${collection.identity} indexes do not match the committed projection`,
				{ expected: expectedIndexes, actual: indexes },
			);
		for (const index of indexes) {
			const expectedObject = (expected.objects as readonly JsonRecord[]).find(
				(object) =>
					object.kind === "index" &&
					object.table === collection.postgresName &&
					object.name === index.name,
			);
			if (!expectedObject)
				return fail(
					"QP-SCHEMA-028",
					"unexpectedObject",
					`${collection.identity}/${index.name} has no semantic catalog parser`,
				);
			observedObjects.push({
				...expectedObject,
				method: index.method,
				unique: index.unique,
				predicate: index.predicate,
				valid: index.valid,
				ready: index.ready,
			});
		}
	}
	const unsupported = await sql<{ kind: string; name: string }[]>`
		select c.relkind::text as kind, c.relname as name
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${schemaName} and c.relkind not in ('r', 'i')
		union all
		select 'trigger', tg.tgname
		from pg_catalog.pg_trigger tg
		join pg_catalog.pg_class c on c.oid = tg.tgrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${schemaName} and not tg.tgisinternal
		union all
		select 'policy', pol.polname
		from pg_catalog.pg_policy pol
		join pg_catalog.pg_class c on c.oid = pol.polrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${schemaName}
		union all
		select 'routine', p.proname
		from pg_catalog.pg_proc p
		join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		where n.nspname = ${schemaName}
		union all
		select case t.typtype when 'd' then 'domain' when 'e' then 'enum' else 'type' end,
		       t.typname
		from pg_catalog.pg_type t
		join pg_catalog.pg_namespace n on n.oid = t.typnamespace
		where n.nspname = ${schemaName}
		  and (t.typtype in ('d', 'e') or (t.typtype = 'c' and t.typrelid = 0))
		union all
		select 'rule', r.rulename
		from pg_catalog.pg_rewrite r
		join pg_catalog.pg_class c on c.oid = r.ev_class
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = ${schemaName} and r.rulename <> '_RETURN'
	`;
	if (unsupported.length > 0)
		return fail(
			"QP-SCHEMA-028",
			"unexpectedObject",
			`application schema ${schemaName} contains unsupported objects`,
			{ objects: unsupported },
		);
	const observedDependencies: JsonRecord[] = [];
	for (const dependency of expected.externalDependencies as readonly JsonRecord[]) {
		const kind = String(dependency.kind);
		const name = String(dependency.name);
		let exists = false;
		if (kind === "type") {
			const [row] = await sql<{ exists: boolean }[]>`
				select exists(
					select 1 from pg_catalog.pg_type t
					join pg_catalog.pg_namespace n on n.oid = t.typnamespace
					where n.nspname = 'pg_catalog' and t.typname = ${name}
				) as exists
			`;
			exists = row?.exists === true;
		} else if (kind === "collation") {
			const [row] = await sql<{ exists: boolean }[]>`
				select exists(
					select 1 from pg_catalog.pg_collation c
					join pg_catalog.pg_namespace n on n.oid = c.collnamespace
					where n.nspname = 'pg_catalog' and c.collname = ${name}
				) as exists
			`;
			exists = row?.exists === true;
		} else if (kind === "defaultFunction") {
			const [row] = await sql<{ exists: boolean }[]>`
				select exists(
					select 1 from pg_catalog.pg_proc p
					join pg_catalog.pg_namespace n on n.oid = p.pronamespace
					where n.nspname = 'pg_catalog' and p.proname = ${name}
					  and p.pronargs = 0
				) as exists
			`;
			exists = row?.exists === true;
		} else if (kind === "operatorClass") {
			const [row] = await sql<{ exists: boolean }[]>`
				select exists(
					select 1 from pg_catalog.pg_opclass o
					join pg_catalog.pg_namespace n on n.oid = o.opcnamespace
					where n.nspname = 'pg_catalog' and o.opcname = ${name}
				) as exists
			`;
			exists = row?.exists === true;
		}
		if (!exists)
			return fail(
				"QP-SCHEMA-028",
				"missingObject",
				`external dependency pg_catalog.${name} is missing`,
			);
		observedDependencies.push(dependency);
	}
	return {
		application: schema.application.name,
		applicationSchema: schemaName,
		applicationSchemaExists: true,
		objects: observedObjects.sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		unsupportedObjects: [],
		externalDependencies: observedDependencies.sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		installedRequiredExtensions: schema.requiredPostgres.extensions.map(
			(extension) => extension.name,
		),
	};
}

export async function schemaExists(
	sql: SQL,
	schemaName: string,
): Promise<boolean> {
	const [row] = await sql<{ exists: boolean }[]>`
		select exists(
			select 1 from pg_catalog.pg_namespace where nspname = ${schemaName}
		) as exists
	`;
	return row?.exists === true;
}

export async function providerObservations(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<ProviderObservations> {
	const [database] = await sql<
		{
			serverVersion: string;
			databaseCollation: string;
			databaseCType: string;
			databaseEncoding: string;
			binaryCollationProvider: string | null;
			binaryCollationDeterministic: boolean | null;
		}[]
	>`
		select current_setting('server_version') as "serverVersion",
		       datcollate as "databaseCollation",
		       datctype as "databaseCType",
		       pg_catalog.pg_encoding_to_char(encoding) as "databaseEncoding",
		       (
		         select collprovider::text
		         from pg_catalog.pg_collation c
		         join pg_catalog.pg_namespace n on n.oid = c.collnamespace
		         where n.nspname = 'pg_catalog' and c.collname = 'C'
		       ) as "binaryCollationProvider",
		       (
		         select collisdeterministic
		         from pg_catalog.pg_collation c
		         join pg_catalog.pg_namespace n on n.oid = c.collnamespace
		         where n.nspname = 'pg_catalog' and c.collname = 'C'
		       ) as "binaryCollationDeterministic"
		from pg_catalog.pg_database where datname = current_database()
	`;
	const requiredExtensions = schema.requiredPostgres.extensions.map(
		(item) => item.name,
	);
	const extensions =
		requiredExtensions.length === 0
			? []
			: await sql<{ name: string; installedVersion: string }[]>`
				select extname as name, extversion as "installedVersion"
				from pg_catalog.pg_extension
				where extname in ${sql(requiredExtensions)}
				order by extname
			`;
	if (!database)
		return fail(
			"QP-SCHEMA-007",
			"providerMismatch",
			"database observations are unavailable",
		);
	const major = Number.parseInt(database.serverVersion, 10);
	if (
		major < schema.requiredPostgres.minimumMajor ||
		database.databaseCollation !== schema.requiredPostgres.databaseCollation ||
		database.databaseCType !== schema.requiredPostgres.databaseCType ||
		database.databaseEncoding !== "UTF8" ||
		database.binaryCollationProvider !== "c" ||
		database.binaryCollationDeterministic !== true ||
		extensions.length !== schema.requiredPostgres.extensions.length
	)
		return fail(
			"QP-SCHEMA-007",
			"providerMismatch",
			"PostgreSQL provider does not match the committed profile",
			{
				serverVersion: database.serverVersion,
				databaseCollation: database.databaseCollation,
				databaseCType: database.databaseCType,
				databaseEncoding: database.databaseEncoding,
				binaryCollationProvider: database.binaryCollationProvider,
				binaryCollationDeterministic: database.binaryCollationDeterministic,
				extensions,
			},
		);
	return {
		...database,
		binaryCollationProvider: database.binaryCollationProvider,
		binaryCollationDeterministic: database.binaryCollationDeterministic,
		extensions,
	};
}

export async function fingerprint(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<SchemaFingerprintV1> {
	const observations = await providerObservations(sql, schema);
	const comparable = await assertSchemaMatches(sql, schema);
	return {
		format: "questpie.schema-fingerprint",
		version: 1,
		comparable,
		observations,
	};
}

export async function inspectSchemaFingerprint(
	input: Readonly<{
		connectionString?: string;
		schema: SchemaProjectionV1;
	}>,
): Promise<Readonly<{ fingerprint: SchemaFingerprintV1; digest: string }>> {
	const sql = input.connectionString
		? new SQL(input.connectionString)
		: new SQL();
	try {
		const value = await fingerprint(sql, input.schema);
		return {
			fingerprint: value,
			digest: digest("questpie-schema-fingerprint-v1", value.comparable),
		};
	} finally {
		await sql.close();
	}
}
