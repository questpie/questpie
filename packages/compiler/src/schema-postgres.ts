import { createHash } from "node:crypto";

import { SQL } from "bun";

import { canonicalBytes, compareAscii, digest } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import {
	acquireSessionLock,
	assertBackendPid,
	cancelBackendOnAbort,
	configurePostgresTimeouts,
	lockKey,
	probeCommittedSession,
	resolvePostgresControl,
	withPinnedTransaction,
} from "./postgres-session";
import type {
	PostgresCommandControl,
	PostgresControl,
} from "./postgres-session";
import type { CommittedMigration, SchemaProjectionV1 } from "./schema";
import { verifyCommittedMigrationChain } from "./schema";
import {
	dependencyName,
	expectedDefault,
	fingerprintType,
	operatorClass,
	physicalType,
} from "./schema/postgres-catalog";
import type {
	ApplyMigrationsResult,
	SchemaFingerprintV1,
} from "./schema/postgres-types";
const bootstrapSql = `CREATE SCHEMA IF NOT EXISTS questpie_internal AUTHORIZATION CURRENT_USER;
REVOKE ALL ON SCHEMA questpie_internal FROM PUBLIC;

CREATE TABLE IF NOT EXISTS questpie_internal.protocol (
  singleton boolean PRIMARY KEY,
  version integer NOT NULL,
  checksum text NOT NULL,
  CONSTRAINT protocol_singleton_true CHECK (singleton),
  CONSTRAINT protocol_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.application_bindings (
  application_name text PRIMARY KEY,
  postgres_schema text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS questpie_internal.schema_migration_receipts (
  application_name text NOT NULL,
  migration_identity text NOT NULL,
  sequence integer NOT NULL,
  parent_identity text,
  checksum text NOT NULL,
  base_schema_digest text NOT NULL,
  target_schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, migration_identity),
  UNIQUE (application_name, sequence),
  CONSTRAINT migration_sequence_positive CHECK (sequence > 0),
  CONSTRAINT migration_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_base_digest_sha256 CHECK (base_schema_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT migration_target_digest_sha256 CHECK (target_schema_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.seed_receipts (
  application_name text NOT NULL,
  seed_identity text NOT NULL,
  checksum text NOT NULL,
  applied_schema_digest text NOT NULL,
  committed_at timestamptz NOT NULL,
  attempt_id uuid NOT NULL,
  PRIMARY KEY (application_name, seed_identity),
  CONSTRAINT seed_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT seed_applied_digest_sha256 CHECK (applied_schema_digest ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS questpie_internal.seed_attempt_events (
  application_name text NOT NULL,
  attempt_id uuid NOT NULL,
  sequence smallint NOT NULL,
  seed_identity text NOT NULL,
  checksum text NOT NULL,
  event text NOT NULL,
  occurred_at timestamptz NOT NULL,
  error_code text,
  PRIMARY KEY (application_name, attempt_id, sequence),
  CONSTRAINT seed_attempt_sequence_nonnegative CHECK (sequence >= 0),
  CONSTRAINT seed_attempt_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT seed_attempt_event_known CHECK (
    event IN ('started', 'succeeded', 'failed', 'interrupted', 'alreadyApplied', 'blocked')
  )
);

REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
`;

const bootstrapChecksum = createHash("sha256")
	.update("questpie-internal-bootstrap-v1\0")
	.update(bootstrapSql)
	.digest("hex");

type JsonRecord = Readonly<Record<string, unknown>>;

type ProviderObservations = SchemaFingerprintV1["observations"];

export function fail(
	code: ConstructorParameters<typeof CompilerDiagnosticError>[0],
	diagnosticClass: string,
	message: string,
	details: Readonly<Record<string, unknown>> = {},
): never {
	throw new CompilerDiagnosticError(code, diagnosticClass, message, details);
}

export function childRecords(
	collection: JsonRecord,
	key: string,
): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}

function physicalFieldName(collection: JsonRecord, identity: string): string {
	const field = childRecords(collection, "fields").find(
		(candidate) => candidate.identity === identity,
	);
	if (!field)
		return fail(
			"QP-SCHEMA-028",
			"invalidObject",
			`unknown fingerprint Field ${identity}`,
		);
	return String(field.postgresName);
}

function fingerprintCheckExpression(
	expression: JsonRecord,
	collection: JsonRecord,
): JsonRecord {
	if (expression.kind === "field")
		return {
			kind: "field",
			field: physicalFieldName(collection, String(expression.field)),
		};
	if (expression.kind === "literal")
		return { kind: "literal", value: expression.value };
	if (expression.kind === "textLength")
		return {
			kind: "textLength",
			expression: fingerprintCheckExpression(
				expression.expression as JsonRecord,
				collection,
			),
		};
	if (expression.kind === "compare")
		return {
			kind: "compare",
			operator: expression.operator,
			left: fingerprintCheckExpression(
				expression.left as JsonRecord,
				collection,
			),
			right: fingerprintCheckExpression(
				expression.right as JsonRecord,
				collection,
			),
		};
	if (expression.kind === "and" || expression.kind === "or")
		return {
			kind: expression.kind,
			expressions: (expression.expressions as readonly JsonRecord[]).map(
				(item) => fingerprintCheckExpression(item, collection),
			),
		};
	if (
		expression.kind === "not" ||
		expression.kind === "isNull" ||
		expression.kind === "isNotNull"
	)
		return {
			kind: expression.kind,
			expression: fingerprintCheckExpression(
				expression.expression as JsonRecord,
				collection,
			),
		};
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported fingerprint check ${String(expression.kind)}`,
	);
}

function expectedComparable(schema: SchemaProjectionV1): JsonRecord {
	const applicationSchemaExists = schema.collections.length > 0;
	const objects: JsonRecord[] = applicationSchemaExists
		? [{ kind: "schema", name: schema.application.postgresSchema }]
		: [];
	const dependencies = new Map<string, JsonRecord>();
	const addDependency = (value: JsonRecord) =>
		dependencies.set(canonicalBytes(value), value);
	for (const collection of schema.collections) {
		objects.push({
			kind: "table",
			name: collection.postgresName,
			persistence: "permanent",
			rowSecurityEnabled: false,
			rowSecurityForced: false,
		});
		for (const field of childRecords(collection, "fields")) {
			const type = field.type as JsonRecord;
			objects.push({
				kind: "column",
				table: collection.postgresName,
				name: field.postgresName,
				type: fingerprintType(field),
				nullable: field.nullable,
				default: field.default,
				identity: "none",
				generated: "none",
				collation:
					field.collation === "questpie.binary" ? "pg_catalog.C" : null,
			});
			addDependency({
				kind: "type",
				schema: "pg_catalog",
				name: dependencyName(type),
				extension: null,
			});
			if (field.collation === "questpie.binary")
				addDependency({
					kind: "collation",
					schema: "pg_catalog",
					name: "C",
					extension: null,
				});
			const defaultValue = field.default as JsonRecord | null;
			if (defaultValue?.kind === "randomUuid" || defaultValue?.kind === "now")
				addDependency({
					kind: "defaultFunction",
					schema: "pg_catalog",
					name: defaultValue.kind === "randomUuid" ? "gen_random_uuid" : "now",
					extension: null,
				});
		}
		for (const constraint of childRecords(collection, "constraints"))
			objects.push(
				constraint.kind === "check"
					? {
							kind: "check",
							table: collection.postgresName,
							name: constraint.postgresName,
							expression: fingerprintCheckExpression(
								constraint.expression as JsonRecord,
								collection,
							),
							validated: true,
						}
					: {
							kind: constraint.kind,
							table: collection.postgresName,
							name: constraint.postgresName,
							fields: (constraint.fields as readonly string[]).map((identity) =>
								physicalFieldName(collection, identity),
							),
							validated: true,
							deferrable: false,
							initiallyDeferred: false,
						},
			);
		for (const relation of childRecords(collection, "relations")) {
			const target = schema.collections.find(
				(item) => item.identity === relation.target,
			);
			if (!target)
				return fail(
					"QP-SCHEMA-028",
					"invalidObject",
					`unknown fingerprint Relation target ${String(relation.target)}`,
				);
			objects.push({
				kind: "foreignKey",
				table: collection.postgresName,
				name: relation.constraintPostgresName,
				fields: (relation.fields as readonly string[]).map((identity) =>
					physicalFieldName(collection, identity),
				),
				referencedTable: target.postgresName,
				referencedFields: (relation.references as readonly string[]).map(
					(identity) => physicalFieldName(target, identity),
				),
				onDelete: relation.onDelete,
				onUpdate: relation.onUpdate,
				validated: true,
				deferrable: false,
				initiallyDeferred: false,
			});
		}
		for (const index of childRecords(collection, "indexes")) {
			objects.push({
				kind: "index",
				table: collection.postgresName,
				name: index.postgresName,
				method: "btree",
				unique: false,
				fields: (index.fields as readonly JsonRecord[]).map((entry) => ({
					field: physicalFieldName(collection, String(entry.field)),
					order: entry.order,
					nulls: entry.nulls,
					operatorClass: "typeDefault",
					collation: entry.collation,
				})),
				predicate: null,
				valid: true,
				ready: true,
			});
			for (const entry of index.fields as readonly JsonRecord[]) {
				const field = childRecords(collection, "fields").find(
					(item) => item.identity === entry.field,
				);
				if (field)
					addDependency({
						kind: "operatorClass",
						schema: "pg_catalog",
						name: operatorClass(field.type as JsonRecord),
						extension: null,
					});
			}
		}
		for (const constraint of childRecords(collection, "constraints"))
			if (constraint.kind === "primaryKey" || constraint.kind === "unique")
				for (const identity of constraint.fields as readonly string[]) {
					const field = childRecords(collection, "fields").find(
						(item) => item.identity === identity,
					);
					if (field)
						addDependency({
							kind: "operatorClass",
							schema: "pg_catalog",
							name: operatorClass(field.type as JsonRecord),
							extension: null,
						});
				}
	}
	return {
		application: schema.application.name,
		applicationSchema: schema.application.postgresSchema,
		applicationSchemaExists,
		objects: objects.sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		unsupportedObjects: [],
		externalDependencies: [...dependencies.values()].sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		installedRequiredExtensions: schema.requiredPostgres.extensions.map(
			(extension) => extension.name,
		),
	};
}

function renderFingerprintExpression(expression: JsonRecord): string {
	if (expression.kind === "field") return String(expression.field);
	if (expression.kind === "literal") {
		if (expression.value === null) return "NULL";
		if (typeof expression.value === "boolean")
			return expression.value ? "true" : "false";
		if (typeof expression.value === "number") return String(expression.value);
		return `'${String(expression.value).replaceAll("'", "''")}'::text`;
	}
	if (expression.kind === "textLength")
		return `char_length(${renderFingerprintExpression(expression.expression as JsonRecord)})`;
	if (expression.kind === "compare") {
		const operators: Readonly<Record<string, string>> = {
			equal: "=",
			notEqual: "<>",
			lessThan: "<",
			lessThanOrEqual: "<=",
			greaterThan: ">",
			greaterThanOrEqual: ">=",
		};
		return `${renderFingerprintExpression(expression.left as JsonRecord)} ${operators[String(expression.operator)]} ${renderFingerprintExpression(expression.right as JsonRecord)}`;
	}
	if (expression.kind === "and" || expression.kind === "or")
		return (expression.expressions as readonly JsonRecord[])
			.map((item) => `(${renderFingerprintExpression(item)})`)
			.join(expression.kind === "and" ? " AND " : " OR ");
	if (expression.kind === "not")
		return `NOT (${renderFingerprintExpression(expression.expression as JsonRecord)})`;
	if (expression.kind === "isNull" || expression.kind === "isNotNull")
		return `${renderFingerprintExpression(expression.expression as JsonRecord)} IS ${expression.kind === "isNull" ? "NULL" : "NOT NULL"}`;
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported fingerprint expression ${String(expression.kind)}`,
	);
}

function expectedConstraintDefinition(
	object: JsonRecord,
	schemaName: string,
): string {
	if (object.kind === "primaryKey")
		return `PRIMARY KEY (${(object.fields as readonly string[]).join(", ")})`;
	if (object.kind === "unique")
		return `UNIQUE (${(object.fields as readonly string[]).join(", ")})`;
	if (object.kind === "check")
		return `CHECK (${renderFingerprintExpression(object.expression as JsonRecord)})`;
	if (object.kind === "foreignKey") {
		const action = (value: unknown) =>
			String(value)
				.replace(/([a-z])([A-Z])/g, "$1 $2")
				.toUpperCase();
		const clause = (kind: "UPDATE" | "DELETE", value: unknown) =>
			value === "noAction" ? "" : ` ON ${kind} ${action(value)}`;
		return `FOREIGN KEY (${(object.fields as readonly string[]).join(", ")}) REFERENCES ${schemaName}.${String(object.referencedTable)}(${(object.referencedFields as readonly string[]).join(", ")})${clause("UPDATE", object.onUpdate)}${clause("DELETE", object.onDelete)}`;
	}
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported expected Constraint ${String(object.kind)}`,
	);
}

function expectedIndexDefinition(
	object: JsonRecord,
	schemaName: string,
): string {
	const fields = (object.fields as readonly JsonRecord[])
		.map((field) => {
			const order = field.order === "desc" ? " DESC" : "";
			const nonDefaultNulls =
				(field.order === "asc" && field.nulls === "first") ||
				(field.order === "desc" && field.nulls === "last")
					? ` NULLS ${String(field.nulls).toUpperCase()}`
					: "";
			return `${String(field.field)}${order}${nonDefaultNulls}`;
		})
		.join(", ");
	return `CREATE INDEX ${String(object.name)} ON ${schemaName}.${String(object.table)} USING btree (${fields})`;
}

export async function assertSchemaMatches(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<JsonRecord> {
	const schemaName = schema.application.postgresSchema;
	const [namespace] = await sql<{ exists: boolean }[]>`
		select exists(select 1 from pg_catalog.pg_namespace where nspname = ${schemaName}) as exists
	`;
	const expected = expectedComparable(schema);
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
				definition: expectedConstraintDefinition(object, schemaName),
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
				definition: expectedIndexDefinition(index, schemaName),
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

async function schemaExists(sql: SQL, schemaName: string): Promise<boolean> {
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
		}[]
	>`
		select current_setting('server_version') as "serverVersion",
		       datcollate as "databaseCollation",
		       datctype as "databaseCType"
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
				extensions,
			},
		);
	return { ...database, extensions };
}

async function fingerprint(
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

const bootstrapColumns = [
	["application_bindings", "application_name", "text", true],
	["application_bindings", "postgres_schema", "text", true],
	["application_bindings", "created_at", "timestamp with time zone", true],
	["protocol", "singleton", "boolean", true],
	["protocol", "version", "integer", true],
	["protocol", "checksum", "text", true],
	["schema_migration_receipts", "application_name", "text", true],
	["schema_migration_receipts", "migration_identity", "text", true],
	["schema_migration_receipts", "sequence", "integer", true],
	["schema_migration_receipts", "parent_identity", "text", false],
	["schema_migration_receipts", "checksum", "text", true],
	["schema_migration_receipts", "base_schema_digest", "text", true],
	["schema_migration_receipts", "target_schema_digest", "text", true],
	["schema_migration_receipts", "applied_at", "timestamp with time zone", true],
	["seed_attempt_events", "application_name", "text", true],
	["seed_attempt_events", "attempt_id", "uuid", true],
	["seed_attempt_events", "sequence", "smallint", true],
	["seed_attempt_events", "seed_identity", "text", true],
	["seed_attempt_events", "checksum", "text", true],
	["seed_attempt_events", "event", "text", true],
	["seed_attempt_events", "occurred_at", "timestamp with time zone", true],
	["seed_attempt_events", "error_code", "text", false],
	["seed_receipts", "application_name", "text", true],
	["seed_receipts", "seed_identity", "text", true],
	["seed_receipts", "checksum", "text", true],
	["seed_receipts", "applied_schema_digest", "text", true],
	["seed_receipts", "committed_at", "timestamp with time zone", true],
	["seed_receipts", "attempt_id", "uuid", true],
] as const;

const bootstrapConstraints = [
	[
		"application_bindings",
		"application_bindings_pkey",
		"p",
		"PRIMARY KEY (application_name)",
	],
	[
		"application_bindings",
		"application_bindings_postgres_schema_key",
		"u",
		"UNIQUE (postgres_schema)",
	],
	[
		"protocol",
		"protocol_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	["protocol", "protocol_pkey", "p", "PRIMARY KEY (singleton)"],
	["protocol", "protocol_singleton_true", "c", "CHECK (singleton)"],
	[
		"schema_migration_receipts",
		"migration_base_digest_sha256",
		"c",
		"CHECK (base_schema_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"schema_migration_receipts",
		"migration_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"schema_migration_receipts",
		"migration_sequence_positive",
		"c",
		"CHECK (sequence > 0)",
	],
	[
		"schema_migration_receipts",
		"migration_target_digest_sha256",
		"c",
		"CHECK (target_schema_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_application_name_sequence_key",
		"u",
		"UNIQUE (application_name, sequence)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_pkey",
		"p",
		"PRIMARY KEY (application_name, migration_identity)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_event_known",
		"c",
		"CHECK (event = ANY (ARRAY['started'::text, 'succeeded'::text, 'failed'::text, 'interrupted'::text, 'alreadyApplied'::text, 'blocked'::text]))",
	],
	[
		"seed_attempt_events",
		"seed_attempt_events_pkey",
		"p",
		"PRIMARY KEY (application_name, attempt_id, sequence)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_sequence_nonnegative",
		"c",
		"CHECK (sequence >= 0)",
	],
	[
		"seed_receipts",
		"seed_applied_digest_sha256",
		"c",
		"CHECK (applied_schema_digest ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"seed_receipts",
		"seed_checksum_sha256",
		"c",
		"CHECK (checksum ~ '^[0-9a-f]{64}$'::text)",
	],
	[
		"seed_receipts",
		"seed_receipts_pkey",
		"p",
		"PRIMARY KEY (application_name, seed_identity)",
	],
] as const;

const bootstrapIndexes = [
	[
		"application_bindings",
		"application_bindings_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX application_bindings_pkey ON questpie_internal.application_bindings USING btree (application_name)",
	],
	[
		"application_bindings",
		"application_bindings_postgres_schema_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX application_bindings_postgres_schema_key ON questpie_internal.application_bindings USING btree (postgres_schema)",
	],
	[
		"protocol",
		"protocol_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX protocol_pkey ON questpie_internal.protocol USING btree (singleton)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_application_name_sequence_key",
		"btree",
		true,
		false,
		"CREATE UNIQUE INDEX schema_migration_receipts_application_name_sequence_key ON questpie_internal.schema_migration_receipts USING btree (application_name, sequence)",
	],
	[
		"schema_migration_receipts",
		"schema_migration_receipts_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX schema_migration_receipts_pkey ON questpie_internal.schema_migration_receipts USING btree (application_name, migration_identity)",
	],
	[
		"seed_attempt_events",
		"seed_attempt_events_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX seed_attempt_events_pkey ON questpie_internal.seed_attempt_events USING btree (application_name, attempt_id, sequence)",
	],
	[
		"seed_receipts",
		"seed_receipts_pkey",
		"btree",
		true,
		true,
		"CREATE UNIQUE INDEX seed_receipts_pkey ON questpie_internal.seed_receipts USING btree (application_name, seed_identity)",
	],
] as const;

async function verifyBootstrapCatalog(sql: SQL): Promise<void> {
	const [namespace] = await sql<
		{
			publicPrivileges: boolean;
		}[]
	>`
		select pg_catalog.has_schema_privilege('public', n.oid, 'USAGE')
		       or pg_catalog.has_schema_privilege('public', n.oid, 'CREATE') as "publicPrivileges"
		from pg_catalog.pg_namespace n
		where n.nspname = 'questpie_internal'
	`;
	const tables = await sql<
		{
			name: string;
			ownerMatches: boolean;
			publicPrivileges: boolean;
		}[]
	>`
		select c.relname as name,
		       c.relowner = n.nspowner as "ownerMatches",
		       pg_catalog.has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as "publicPrivileges"
		from pg_catalog.pg_class c
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal' and c.relkind = 'r'
		order by c.relname
	`;
	const columns = await sql<
		{
			table: string;
			name: string;
			type: string;
			notNull: boolean;
		}[]
	>`
		select c.relname as table,
		       a.attname as name,
		       pg_catalog.format_type(a.atttypid, a.atttypmod) as type,
		       a.attnotnull as "notNull"
		from pg_catalog.pg_attribute a
		join pg_catalog.pg_class c on c.oid = a.attrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal' and c.relkind = 'r'
		  and a.attnum > 0 and not a.attisdropped
		order by c.relname, a.attnum
	`;
	const constraints = await sql<
		{ table: string; name: string; type: string; definition: string }[]
	>`
		select c.relname as table,
		       con.conname as name,
		       con.contype::text as type,
		       pg_catalog.pg_get_constraintdef(con.oid, true) as definition
		from pg_catalog.pg_constraint con
		join pg_catalog.pg_class c on c.oid = con.conrelid
		join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'questpie_internal'
		order by c.relname, con.conname
	`;
	const indexes = await sql<
		{
			table: string;
			name: string;
			method: string;
			unique: boolean;
			primary: boolean;
			definition: string;
			ownerMatches: boolean;
		}[]
	>`
		select t.relname as table,
		       i.relname as name,
		       am.amname as method,
		       x.indisunique as unique,
		       x.indisprimary as primary,
		       pg_catalog.pg_get_indexdef(i.oid) as definition,
		       i.relowner = n.nspowner as "ownerMatches"
		from pg_catalog.pg_index x
		join pg_catalog.pg_class i on i.oid = x.indexrelid
		join pg_catalog.pg_class t on t.oid = x.indrelid
		join pg_catalog.pg_namespace n on n.oid = t.relnamespace
		join pg_catalog.pg_am am on am.oid = i.relam
		where n.nspname = 'questpie_internal'
		order by t.relname, i.relname
	`;
	const expectedTables = [
		"application_bindings",
		"protocol",
		"schema_migration_receipts",
		"seed_attempt_events",
		"seed_receipts",
	];
	if (
		!namespace ||
		namespace.publicPrivileges ||
		canonicalBytes(tables.map((table) => table.name)) !==
			canonicalBytes(expectedTables) ||
		tables.some((table) => !table.ownerMatches || table.publicPrivileges) ||
		canonicalBytes(
			columns.map((column) => [
				column.table,
				column.name,
				column.type,
				column.notNull,
			]),
		) !== canonicalBytes(bootstrapColumns) ||
		canonicalBytes(
			constraints.map((constraint) => [
				constraint.table,
				constraint.name,
				constraint.type,
				constraint.definition,
			]),
		) !== canonicalBytes(bootstrapConstraints) ||
		indexes.some((index) => !index.ownerMatches) ||
		canonicalBytes(
			indexes.map((index) => [
				index.table,
				index.name,
				index.method,
				index.unique,
				index.primary,
				index.definition,
			]),
		) !== canonicalBytes(bootstrapIndexes)
	)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v1 catalog shape, ownership, or privileges changed",
		);
	const [protocol] = await sql<{ version: number; checksum: string }[]>`
		select version, checksum
		from questpie_internal.protocol
		where singleton = true
	`;
	if (protocol?.version !== 1 || protocol.checksum !== bootstrapChecksum)
		return fail(
			"QP-SCHEMA-023",
			"checksumMismatch",
			"questpie.internal.v1 protocol is missing or changed",
		);
}

export async function bootstrap(
	sql: SQL,
	databaseName: string,
	expectedPid: number,
	control: PostgresControl,
	signal?: AbortSignal,
): Promise<void> {
	const key = lockKey("questpie-bootstrap-lock-v1", databaseName);
	await assertBackendPid(sql, expectedPid, "before bootstrap lock");
	await acquireSessionLock(sql, key, control, signal);
	try {
		await assertBackendPid(sql, expectedPid, "after bootstrap lock");
		const [state] = await sql<{ exists: boolean }[]>`
			select exists(select 1 from pg_catalog.pg_namespace where nspname = 'questpie_internal') as exists
		`;
		if (!state?.exists) {
			await withPinnedTransaction(
				sql,
				expectedPid,
				"bootstrap transaction",
				signal,
				async (transaction) => {
					await transaction.unsafe(bootstrapSql);
					await transaction`
					insert into questpie_internal.protocol
					(singleton, version, checksum)
					values (true, 1, ${bootstrapChecksum})
				`;
					await verifyBootstrapCatalog(transaction);
				},
			);
		} else await verifyBootstrapCatalog(sql);
	} finally {
		await assertBackendPid(sql, expectedPid, "bootstrap unlock");
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export async function applyCommittedMigrations(
	input: Readonly<{
		connectionString?: string;
		migrations: readonly CommittedMigration[];
	}> &
		PostgresCommandControl,
): Promise<ApplyMigrationsResult> {
	verifyCommittedMigrationChain(input.migrations);
	const migrations = [...input.migrations];
	for (const migration of migrations) {
		if (migration.plan.steps.some((item) => item.kind.includes("Concurrent")))
			return fail(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`${migration.identity} contains non-transactional DDL`,
			);
	}
	const target = migrations.at(-1)!.targetSchema;
	const application = target.application.name;
	const pool = input.connectionString
		? new SQL(input.connectionString)
		: new SQL();
	const session = await pool.reserve();
	let stopBackendCancellation = () => {};
	try {
		const firstPid = await probeCommittedSession(session);
		stopBackendCancellation = cancelBackendOnAbort(
			pool,
			firstPid,
			input.signal,
		);
		const control = resolvePostgresControl(input);
		await configurePostgresTimeouts(session, control);
		const [database] = await session<{ name: string }[]>`
			select current_database() as name
		`;
		if (!database)
			return fail(
				"QP-SCHEMA-007",
				"providerMismatch",
				"current database is unavailable",
			);
		await providerObservations(session, target);
		await bootstrap(session, database.name, firstPid, control, input.signal);
		const applicationKey = lockKey(
			"questpie-application-lock-v1",
			database.name,
			application,
		);
		await acquireSessionLock(session, applicationKey, control, input.signal);
		try {
			await assertBackendPid(session, firstPid, "application lock");
			const conflictingBindings = await session<
				{
					applicationName: string;
					schemaName: string;
				}[]
			>`
				select application_name as "applicationName", postgres_schema as "schemaName"
				from questpie_internal.application_bindings
				where application_name = ${application}
				   or postgres_schema = ${target.application.postgresSchema}
			`;
			if (
				conflictingBindings.some(
					(binding) =>
						binding.applicationName !== application ||
						binding.schemaName !== target.application.postgresSchema,
				)
			)
				return fail(
					"QP-SCHEMA-029",
					"applicationBindingMismatch",
					"Application Identity and PostgreSQL schema binding disagree",
				);
			const receipts = await session<
				{
					identity: string;
					sequence: number;
					checksum: string;
					parent: string | null;
					baseSchemaDigest: string;
					targetSchemaDigest: string;
				}[]
			>`
				select migration_identity as identity,
				       sequence,
				       checksum,
				       parent_identity as parent,
				       base_schema_digest as "baseSchemaDigest",
				       target_schema_digest as "targetSchemaDigest"
				from questpie_internal.schema_migration_receipts
				where application_name = ${application}
				order by sequence
			`;
			if (receipts.length > migrations.length)
				return fail(
					"QP-SCHEMA-024",
					"unknownAppliedMigration",
					"database migration history is longer than the local chain",
				);
			for (const [index, receipt] of receipts.entries()) {
				const local = migrations[index];
				if (!local || local.identity !== receipt.identity)
					return fail(
						"QP-SCHEMA-024",
						"unknownAppliedMigration",
						`database receipt ${receipt.identity} is not the exact local prefix at sequence ${index + 1}`,
					);
				if (
					receipt.sequence !== index + 1 ||
					receipt.parent !== local.plan.baseMigration ||
					receipt.baseSchemaDigest !== local.plan.baseSchemaDigest ||
					receipt.targetSchemaDigest !== local.plan.targetSchemaDigest
				)
					return fail(
						"QP-SCHEMA-025",
						"orderMismatch",
						`${receipt.identity} receipt does not match its local chain position`,
					);
				if (local.checksum !== receipt.checksum)
					return fail(
						"QP-SCHEMA-023",
						"checksumMismatch",
						`${receipt.identity} differs from its database receipt`,
					);
			}
			const pending = migrations.slice(receipts.length);
			if (receipts.length === 0) {
				if (await schemaExists(session, target.application.postgresSchema))
					return fail(
						"QP-SCHEMA-028",
						"baseDrift",
						"Genesis requires the application schema to be absent before DDL",
					);
			} else if (pending[0]) {
				await assertSchemaMatches(session, pending[0].baseSchema);
			}
			const applied: string[] = [];
			for (const migration of pending) {
				await withPinnedTransaction(
					session,
					firstPid,
					`${migration.identity} transaction`,
					input.signal,
					async (transaction) => {
						if (migration.plan.baseMigration === null)
							await transaction`
							insert into questpie_internal.application_bindings
							(application_name, postgres_schema, created_at)
							values (${application}, ${target.application.postgresSchema}, ${new Date()})
						`;
						await transaction.unsafe(migration.files["up.sql"] ?? "");
						await assertSchemaMatches(transaction, migration.targetSchema);
						await transaction`
						insert into questpie_internal.schema_migration_receipts
						(application_name, migration_identity, sequence, parent_identity, checksum, base_schema_digest, target_schema_digest, applied_at)
						values (${application}, ${migration.identity}, ${Number(migration.identity.slice(0, 6))}, ${migration.plan.baseMigration}, ${migration.checksum}, ${migration.plan.baseSchemaDigest}, ${migration.plan.targetSchemaDigest}, ${new Date()})
					`;
					},
				);
				await assertSchemaMatches(session, migration.targetSchema);
				applied.push(migration.identity);
			}
			const resultFingerprint = await fingerprint(session, target);
			return {
				status: applied.length > 0 ? "applied" : "alreadyApplied",
				applied,
				head: migrations.at(-1)!.identity,
				fingerprintDigest: digest(
					"questpie-schema-fingerprint-v1",
					resultFingerprint.comparable,
				),
			};
		} finally {
			await assertBackendPid(session, firstPid, "application unlock");
			await session`select pg_catalog.pg_advisory_unlock(${applicationKey})`;
		}
	} finally {
		stopBackendCancellation();
		session.release();
		await pool.close();
	}
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

export { bootstrapChecksum, bootstrapSql };
