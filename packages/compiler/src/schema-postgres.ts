import { createHash } from "node:crypto";

import { SQL } from "bun";

import { canonicalBytes, compareAscii, digest } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import type { CommittedMigration, SchemaProjectionV1 } from "./schema";
import { verifyCommittedMigration } from "./schema";

const bootstrapSql = `CREATE SCHEMA questpie_internal;

CREATE TABLE questpie_internal.schema_protocol (
  singleton boolean PRIMARY KEY,
  version integer NOT NULL,
  checksum text NOT NULL,
  installed_at timestamptz NOT NULL,
  CONSTRAINT qp_schema_protocol_singleton CHECK (singleton)
);

CREATE TABLE questpie_internal.application_bindings (
  application_name text PRIMARY KEY,
  schema_name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE questpie_internal.schema_migration_receipts (
  application_name text NOT NULL REFERENCES questpie_internal.application_bindings(application_name),
  identity text NOT NULL,
  sequence integer NOT NULL,
  checksum text NOT NULL,
  target_schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, identity),
  UNIQUE (application_name, sequence)
);

CREATE TABLE questpie_internal.seed_receipts (
  application_name text NOT NULL REFERENCES questpie_internal.application_bindings(application_name),
  identity text NOT NULL,
  checksum text NOT NULL,
  schema_digest text NOT NULL,
  applied_at timestamptz NOT NULL,
  PRIMARY KEY (application_name, identity)
);

CREATE TABLE questpie_internal.seed_attempts (
  attempt_id uuid NOT NULL,
  application_name text NOT NULL,
  seed_identity text NOT NULL,
  sequence integer NOT NULL,
  status text NOT NULL,
  diagnostic_code text,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (attempt_id, sequence)
);

REVOKE ALL ON SCHEMA questpie_internal FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA questpie_internal FROM PUBLIC;
`;

const bootstrapChecksum = createHash("sha256")
	.update("questpie-internal-bootstrap-v1\0")
	.update(bootstrapSql)
	.digest("hex");

type JsonRecord = Readonly<Record<string, unknown>>;

export interface SchemaFingerprintV1 extends JsonRecord {
	readonly format: "questpie.schema-fingerprint";
	readonly version: 1;
	readonly comparable: JsonRecord;
	readonly observations: Readonly<{
		serverVersion: string;
		databaseCollation: string;
		databaseCType: string;
		extensions: readonly Readonly<{
			name: string;
			installedVersion: string;
		}>[];
	}>;
}

type ProviderObservations = SchemaFingerprintV1["observations"];

function fail(
	code: ConstructorParameters<typeof CompilerDiagnosticError>[0],
	diagnosticClass: string,
	message: string,
	details: Readonly<Record<string, unknown>> = {},
): never {
	throw new CompilerDiagnosticError(code, diagnosticClass, message, details);
}

function lockKey(domain: string, ...values: string[]): bigint {
	const input = `${domain}\0${values.join("\0")}`;
	return createHash("sha256").update(input).digest().readBigInt64BE(0);
}

function childRecords(
	collection: JsonRecord,
	key: string,
): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}

function physicalType(field: JsonRecord): string {
	const type = field.type as JsonRecord;
	switch (type.kind) {
		case "uuid":
			return "uuid";
		case "text":
			return "text";
		case "boolean":
			return "bool";
		case "integer":
			return "int4";
		case "bigint":
			return "int8";
		case "numeric":
			return "numeric";
		case "timestamp":
			return type.withTimezone === true ? "timestamptz" : "timestamp";
		case "date":
			return "date";
		case "object":
		case "array":
		case "json":
			return "jsonb";
		default:
			return fail(
				"QP-SCHEMA-028",
				"invalidObject",
				`unsupported expected Field type ${String(type.kind)}`,
			);
	}
}

function expectedDefault(field: JsonRecord): string | null {
	if (field.default === null) return null;
	const value = field.default as JsonRecord;
	if (value.kind === "randomUuid") return "gen_random_uuid()";
	if (value.kind === "now") return "now()";
	if (value.kind === "literal") return String(value.value);
	return fail(
		"QP-SCHEMA-028",
		"invalidObject",
		`unsupported expected default ${String(value.kind)}`,
	);
}

function expectedComparable(schema: SchemaProjectionV1): JsonRecord {
	const objects: JsonRecord[] = [
		{ kind: "schema", name: schema.application.postgresSchema },
	];
	for (const collection of schema.collections) {
		objects.push({
			kind: "table",
			name: collection.postgresName,
			persistence: "permanent",
			rowSecurityEnabled: false,
			rowSecurityForced: false,
		});
		for (const field of childRecords(collection, "fields"))
			objects.push({
				kind: "column",
				table: collection.postgresName,
				name: field.postgresName,
				type: field.type,
				nullable: field.nullable,
				default: field.default,
				identity: "none",
				generated: "none",
				collation:
					field.collation === "questpie.binary" ? "pg_catalog.C" : null,
			});
		for (const constraint of childRecords(collection, "constraints"))
			objects.push(
				constraint.kind === "check"
					? {
							...constraint,
							table: collection.postgresName,
							validated: true,
						}
					: {
							...constraint,
							table: collection.postgresName,
							validated: true,
							deferrable: false,
							initiallyDeferred: false,
						},
			);
		for (const relation of childRecords(collection, "relations"))
			objects.push({
				kind: "foreignKey",
				table: collection.postgresName,
				name: relation.constraintPostgresName,
				fields: relation.fields,
				referencedTable: relation.target,
				referencedFields: relation.references,
				onDelete: relation.onDelete,
				onUpdate: relation.onUpdate,
				validated: true,
				deferrable: false,
				initiallyDeferred: false,
			});
		for (const index of childRecords(collection, "indexes"))
			objects.push({
				...index,
				table: collection.postgresName,
				unique: false,
				predicate: null,
				valid: true,
				ready: true,
			});
	}
	return {
		application: schema.application.name,
		applicationSchema: schema.application.postgresSchema,
		applicationSchemaExists: true,
		objects: objects.sort((left, right) =>
			compareAscii(canonicalBytes(left), canonicalBytes(right)),
		),
		unsupportedObjects: [],
		externalDependencies: [],
		installedRequiredExtensions: schema.requiredPostgres.extensions.map(
			(extension) => extension.name,
		),
	};
}

async function assertSchemaMatches(
	sql: SQL,
	schema: SchemaProjectionV1,
): Promise<void> {
	const schemaName = schema.application.postgresSchema;
	const [namespace] = await sql<{ exists: boolean }[]>`
		select exists(select 1 from pg_catalog.pg_namespace where nspname = ${schemaName}) as exists
	`;
	if (!namespace?.exists)
		return fail(
			"QP-SCHEMA-028",
			"missingObject",
			`application schema ${schemaName} is missing`,
		);
	const tables = await sql<
		{
			name: string;
			rowSecurityEnabled: boolean;
			rowSecurityForced: boolean;
		}[]
	>`
		select c.relname as name,
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
		tables.some((table) => table.rowSecurityEnabled || table.rowSecurityForced)
	)
		return fail(
			"QP-SCHEMA-028",
			"unexpectedObject",
			`application schema ${schemaName} has an unexpected table or RLS state`,
		);
	for (const collection of schema.collections) {
		const tableName = String(collection.postgresName);
		const columns = await sql<
			{
				name: string;
				type: string;
				nullable: boolean;
				defaultExpression: string | null;
				collation: string | null;
				identity: string;
				generated: string;
			}[]
		>`
			select a.attname as name,
			       t.typname as type,
			       not a.attnotnull as nullable,
			       pg_catalog.pg_get_expr(d.adbin, d.adrelid) as "defaultExpression",
			       coll.collname as collation,
			       a.attidentity as identity,
			       a.attgenerated as generated
			from pg_catalog.pg_attribute a
			join pg_catalog.pg_class c on c.oid = a.attrelid
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			join pg_catalog.pg_type t on t.oid = a.atttypid
			left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
			left join pg_catalog.pg_collation coll on coll.oid = a.attcollation and a.attcollation <> 0
			where n.nspname = ${schemaName} and c.relname = ${tableName}
			  and a.attnum > 0 and not a.attisdropped
			order by a.attname
		`;
		const expectedColumns = childRecords(collection, "fields")
			.map((field) => ({
				name: String(field.postgresName),
				type: physicalType(field),
				nullable: field.nullable === true,
				defaultExpression: expectedDefault(field),
				collation: field.collation === "questpie.binary" ? "C" : null,
				identity: "",
				generated: "",
			}))
			.sort((left, right) => compareAscii(left.name, right.name));
		if (canonicalBytes(columns) !== canonicalBytes(expectedColumns))
			return fail(
				"QP-SCHEMA-028",
				"changedObject",
				`${collection.identity} columns do not match the committed projection`,
				{ expected: expectedColumns, actual: columns },
			);
		const constraints = await sql<{ name: string; type: string }[]>`
			select con.conname as name, con.contype as type
			from pg_catalog.pg_constraint con
			join pg_catalog.pg_class c on c.oid = con.conrelid
			join pg_catalog.pg_namespace n on n.oid = c.relnamespace
			where n.nspname = ${schemaName} and c.relname = ${tableName}
			order by con.conname
		`;
		const expectedConstraints = [
			...childRecords(collection, "constraints").map((constraint) => ({
				name: String(constraint.postgresName),
				type:
					constraint.kind === "primaryKey"
						? "p"
						: constraint.kind === "unique"
							? "u"
							: "c",
			})),
			...childRecords(collection, "relations").map((relation) => ({
				name: String(relation.constraintPostgresName),
				type: "f",
			})),
		].sort((left, right) => compareAscii(left.name, right.name));
		if (canonicalBytes(constraints) !== canonicalBytes(expectedConstraints))
			return fail(
				"QP-SCHEMA-028",
				"changedObject",
				`${collection.identity} constraints do not match the committed projection`,
			);
		const indexes = await sql<{ name: string }[]>`
			select i.relname as name
			from pg_catalog.pg_index x
			join pg_catalog.pg_class i on i.oid = x.indexrelid
			join pg_catalog.pg_class t on t.oid = x.indrelid
			join pg_catalog.pg_namespace n on n.oid = t.relnamespace
			left join pg_catalog.pg_constraint con on con.conindid = x.indexrelid
			where n.nspname = ${schemaName} and t.relname = ${tableName}
			  and con.oid is null
			order by i.relname
		`;
		const expectedIndexes = childRecords(collection, "indexes")
			.map((index) => ({ name: String(index.postgresName) }))
			.sort((left, right) => compareAscii(left.name, right.name));
		if (canonicalBytes(indexes) !== canonicalBytes(expectedIndexes))
			return fail(
				"QP-SCHEMA-028",
				"changedObject",
				`${collection.identity} indexes do not match the committed projection`,
			);
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
	`;
	if (unsupported.length > 0)
		return fail(
			"QP-SCHEMA-028",
			"unexpectedObject",
			`application schema ${schemaName} contains unsupported objects`,
			{ objects: unsupported },
		);
}

async function providerObservations(
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
	await assertSchemaMatches(sql, schema);
	return {
		format: "questpie.schema-fingerprint",
		version: 1,
		comparable: expectedComparable(schema),
		observations,
	};
}

async function backendPid(sql: SQL): Promise<number> {
	const [row] = await sql<{ pid: number }[]>`
		select pg_catalog.pg_backend_pid() as pid
	`;
	return row?.pid ?? -1;
}

async function assertBackendPid(
	sql: SQL,
	expected: number,
	phase: string,
): Promise<void> {
	const actual = await backendPid(sql);
	if (expected < 0 || actual !== expected)
		return fail(
			"QP-SCHEMA-007",
			"providerMismatch",
			`PostgreSQL endpoint lost session affinity during ${phase}`,
			{ expected, actual },
		);
}

async function bootstrap(sql: SQL, databaseName: string): Promise<void> {
	const key = lockKey("questpie-bootstrap-lock-v1", databaseName);
	await sql`select pg_catalog.pg_advisory_lock(${key})`;
	try {
		const [state] = await sql<{ exists: boolean }[]>`
			select exists(select 1 from pg_catalog.pg_namespace where nspname = 'questpie_internal') as exists
		`;
		if (!state?.exists) {
			await sql.begin(async (transaction) => {
				await transaction.unsafe(bootstrapSql);
				await transaction`
					insert into questpie_internal.schema_protocol
					(singleton, version, checksum, installed_at)
					values (true, 1, ${bootstrapChecksum}, ${new Date()})
				`;
			});
		} else {
			const [protocol] = await sql<{ version: number; checksum: string }[]>`
				select version, checksum from questpie_internal.schema_protocol where singleton = true
			`;
			if (protocol?.version !== 1 || protocol.checksum !== bootstrapChecksum)
				return fail(
					"QP-SCHEMA-023",
					"checksumMismatch",
					"questpie.internal.v1 protocol is missing or changed",
				);
		}
	} finally {
		await sql`select pg_catalog.pg_advisory_unlock(${key})`;
	}
}

export interface ApplyMigrationsResult {
	readonly status: "applied" | "alreadyApplied";
	readonly applied: readonly string[];
	readonly head: string;
	readonly fingerprintDigest: string;
}

export async function applyCommittedMigrations(
	input: Readonly<{
		connectionString?: string;
		migrations: readonly CommittedMigration[];
	}>,
): Promise<ApplyMigrationsResult> {
	if (input.migrations.length === 0)
		return fail(
			"QP-SCHEMA-024",
			"missingLocalMigration",
			"no committed migration exists",
		);
	const migrations = [...input.migrations].sort((left, right) =>
		compareAscii(left.identity, right.identity),
	);
	for (const [index, migration] of migrations.entries()) {
		verifyCommittedMigration(migration);
		if (migration.plan.steps.some((item) => item.kind.includes("Concurrent")))
			return fail(
				"QP-SCHEMA-031",
				"nonTransactionalDdl",
				`${migration.identity} contains non-transactional DDL`,
			);
		if (
			index > 0 &&
			migration.plan.baseMigration !== migrations[index - 1]?.identity
		)
			return fail(
				"QP-SCHEMA-025",
				"orderMismatch",
				"local migration chain is not linear",
			);
	}
	const target = migrations.at(-1)!.targetSchema;
	const application = target.application.name;
	const pool = input.connectionString
		? new SQL(input.connectionString)
		: new SQL();
	const session = await pool.reserve();
	try {
		const firstPid = await backendPid(session);
		const secondPid = await backendPid(session);
		if (firstPid < 0 || firstPid !== secondPid)
			return fail(
				"QP-SCHEMA-007",
				"providerMismatch",
				"PostgreSQL endpoint is not session-affine",
			);
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
		await bootstrap(session, database.name);
		await assertBackendPid(session, firstPid, "bootstrap");
		const applicationKey = lockKey(
			"questpie-application-lock-v1",
			database.name,
			application,
		);
		await session`select pg_catalog.pg_advisory_lock(${applicationKey})`;
		try {
			await assertBackendPid(session, firstPid, "application lock");
			const conflictingBindings = await session<
				{
					applicationName: string;
					schemaName: string;
				}[]
			>`
				select application_name as "applicationName", schema_name as "schemaName"
				from questpie_internal.application_bindings
				where application_name = ${application}
				   or schema_name = ${target.application.postgresSchema}
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
				}[]
			>`
				select identity, sequence, checksum
				from questpie_internal.schema_migration_receipts
				where application_name = ${application}
				order by sequence
			`;
			for (const receipt of receipts) {
				const local = migrations.find(
					(migration) => migration.identity === receipt.identity,
				);
				if (!local)
					return fail(
						"QP-SCHEMA-024",
						"unknownAppliedMigration",
						`database receipt ${receipt.identity} is absent locally`,
					);
				if (local.checksum !== receipt.checksum)
					return fail(
						"QP-SCHEMA-023",
						"checksumMismatch",
						`${receipt.identity} differs from its database receipt`,
					);
			}
			const pending = migrations.slice(receipts.length);
			const applied: string[] = [];
			for (const migration of pending) {
				await session.begin(async (transaction) => {
					await assertBackendPid(
						transaction,
						firstPid,
						`${migration.identity} transaction`,
					);
					if (migration.plan.baseMigration === null)
						await transaction`
							insert into questpie_internal.application_bindings
							(application_name, schema_name, created_at)
							values (${application}, ${target.application.postgresSchema}, ${new Date()})
						`;
					await transaction.unsafe(migration.files["up.sql"] ?? "");
					await assertSchemaMatches(transaction, migration.targetSchema);
					await transaction`
						insert into questpie_internal.schema_migration_receipts
						(application_name, identity, sequence, checksum, target_schema_digest, applied_at)
						values (${application}, ${migration.identity}, ${Number(migration.identity.slice(0, 6))}, ${migration.checksum}, ${migration.plan.targetSchemaDigest}, ${new Date()})
					`;
				});
				await assertBackendPid(session, firstPid, migration.identity);
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
