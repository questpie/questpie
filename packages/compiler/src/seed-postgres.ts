import { SQL } from "bun";

import { digest } from "./canonical";
import type { SchemaProjectionV1 } from "./schema";
import {
	assertSchemaMatches,
	bootstrap,
	childRecords,
	fail,
	lockKey,
	providerObservations,
} from "./schema-postgres";
import type { CommittedSeedV1, SeedFieldValueV1, SeedStepV1 } from "./seed";
import { orderCommittedSeeds } from "./seed";
import { validateCommittedSeedSchema } from "./seed/index";

type JsonRecord = Readonly<Record<string, unknown>>;
export interface ApplySeedsResult {
	readonly applied: readonly string[];
	readonly alreadyApplied: readonly string[];
}

function quoted(name: string): string {
	return `"${name.replaceAll('"', '""')}"`;
}

function seedCollection(
	schema: SchemaProjectionV1,
	identity: string,
): JsonRecord {
	const collection = schema.collections.find(
		(item) => item.identity === identity,
	);
	if (!collection)
		return fail(
			"QP-SEED-003",
			"stepSchemaIncompatible",
			`unknown Seed Collection ${identity}`,
		);
	return collection;
}

function seedColumns(
	collection: JsonRecord,
	values: readonly SeedFieldValueV1[],
): Readonly<{ names: string[]; values: unknown[] }> {
	const fields = childRecords(collection, "fields");
	const names: string[] = [];
	const parameters: unknown[] = [];
	for (const entry of values) {
		const field = fields.find((item) => item.identity === entry.field);
		if (!field)
			return fail(
				"QP-SEED-003",
				"stepSchemaIncompatible",
				`unknown Seed Field ${entry.field}`,
			);
		names.push(String(field.postgresName));
		const value = entry.value;
		parameters.push(
			value && typeof value === "object" && "kind" in value
				? value.kind === "json"
					? JSON.stringify(value.value)
					: value.value
				: value,
		);
	}
	return { names, values: parameters };
}

async function executeSeedStep(
	sql: SQL,
	schema: SchemaProjectionV1,
	step: SeedStepV1,
): Promise<void> {
	const collection = seedCollection(schema, step.collection);
	const table = `${quoted(schema.application.postgresSchema)}.${quoted(String(collection.postgresName))}`;
	const placeholders = (length: number, offset = 0) =>
		Array.from({ length }, (_, index) => `$${index + offset + 1}`).join(", ");
	if (step.kind === "insert") {
		const values = seedColumns(collection, step.values ?? []);
		await sql.unsafe(
			`INSERT INTO ${table} (${values.names.map(quoted).join(", ")}) VALUES (${placeholders(values.values.length)})`,
			values.values,
		);
		return;
	}
	const key = seedColumns(collection, step.key ?? []);
	const predicate = key.names
		.map((name, index) => `${quoted(name)} = $${index + 1}`)
		.join(" AND ");
	if (step.kind === "delete") {
		const result = await sql.unsafe(
			`DELETE FROM ${table} WHERE ${predicate} RETURNING 1`,
			key.values,
		);
		if (result.length !== 1)
			return fail(
				"QP-SEED-012",
				"cardinalityMismatch",
				`${step.stepId} affected ${result.length} rows`,
			);
		return;
	}
	const values = seedColumns(
		collection,
		step.kind === "update" ? (step.values ?? []) : (step.update ?? []),
	);
	if (step.kind === "update") {
		const assignments = values.names
			.map(
				(name, index) => `${quoted(name)} = $${key.values.length + index + 1}`,
			)
			.join(", ");
		const result = await sql.unsafe(
			`UPDATE ${table} SET ${assignments} WHERE ${predicate} RETURNING 1`,
			[...key.values, ...values.values],
		);
		if (result.length !== 1)
			return fail(
				"QP-SEED-012",
				"cardinalityMismatch",
				`${step.stepId} affected ${result.length} rows`,
			);
		return;
	}
	const create = seedColumns(collection, step.create ?? []);
	const insertNames = [...key.names, ...create.names];
	const insertValues = [...key.values, ...create.values];
	const updates = values.names
		.map(
			(name, index) => `${quoted(name)} = $${insertValues.length + index + 1}`,
		)
		.join(", ");
	if (updates.length === 0)
		return fail(
			"QP-SEED-003",
			"stepSchemaIncompatible",
			`${step.stepId} upsert update is empty`,
		);
	const result = await sql.unsafe(
		`INSERT INTO ${table} (${insertNames.map(quoted).join(", ")}) VALUES (${placeholders(insertValues.length)}) ON CONFLICT (${key.names.map(quoted).join(", ")}) DO UPDATE SET ${updates} RETURNING 1`,
		[...insertValues, ...values.values],
	);
	if (result.length !== 1)
		return fail(
			"QP-SEED-012",
			"cardinalityMismatch",
			`${step.stepId} did not return one row`,
		);
}

export async function applyCommittedSeeds(
	input: Readonly<{
		connectionString?: string;
		schema: SchemaProjectionV1;
		seeds: readonly CommittedSeedV1[];
	}>,
): Promise<ApplySeedsResult> {
	const seeds = orderCommittedSeeds(input.seeds);
	for (const seed of seeds) validateCommittedSeedSchema(seed, input.schema);
	const pool = input.connectionString
		? new SQL(input.connectionString)
		: new SQL();
	const session = await pool.reserve();
	const applied: string[] = [];
	const alreadyApplied: string[] = [];
	try {
		const [database] = await session<
			{ name: string }[]
		>`select current_database() as name`;
		if (!database)
			return fail(
				"QP-SCHEMA-007",
				"providerMismatch",
				"current database is unavailable",
			);
		await providerObservations(session, input.schema);
		await bootstrap(session, database.name);
		const application = input.schema.application.name;
		const applicationKey = lockKey(
			"questpie-application-lock-v1",
			database.name,
			application,
		);
		await session`select pg_catalog.pg_advisory_lock(${applicationKey})`;
		try {
			const [binding] = await session<{ schemaName: string }[]>`
				select postgres_schema as "schemaName"
				from questpie_internal.application_bindings
				where application_name = ${application}
			`;
			if (binding?.schemaName !== input.schema.application.postgresSchema)
				return fail(
					"QP-SCHEMA-029",
					"applicationBindingMismatch",
					`${application} has no matching binding`,
				);
			const [head] = await session<{ digest: string }[]>`
				select target_schema_digest as digest
				from questpie_internal.schema_migration_receipts
				where application_name = ${application}
				order by sequence desc limit 1
			`;
			const expectedSchemaDigest = digest(
				"questpie-schema-projection-v1",
				input.schema,
			);
			let blockedIdentity: string | undefined;
			for (const seed of seeds) {
				const attemptId = crypto.randomUUID();
				const [receipt] = await session<{ checksum: string }[]>`
					select checksum from questpie_internal.seed_receipts
					where application_name = ${application} and seed_identity = ${seed.identity}
				`;
				if (receipt) {
					if (receipt.checksum !== seed.checksum)
						return fail(
							"QP-SEED-004",
							"checksumMismatch",
							`${seed.identity} differs from its receipt`,
						);
					await session`
						insert into questpie_internal.seed_attempt_events
						(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
						values (${application}, ${attemptId}, 0, ${seed.identity}, ${seed.checksum}, 'alreadyApplied', ${new Date()}, null)
					`;
					alreadyApplied.push(seed.identity);
					continue;
				}
				const abandoned = await session<{ attemptId: string }[]>`
					select started.attempt_id as "attemptId"
					from questpie_internal.seed_attempt_events started
					where started.application_name = ${application}
					  and started.seed_identity = ${seed.identity}
					  and started.checksum = ${seed.checksum}
					  and started.event = 'started'
					  and not exists (
					    select 1 from questpie_internal.seed_attempt_events terminal
					    where terminal.application_name = started.application_name
					      and terminal.attempt_id = started.attempt_id
					      and terminal.event in ('succeeded', 'failed', 'interrupted', 'alreadyApplied', 'blocked')
					  )
					order by started.occurred_at, started.attempt_id
				`;
				for (const previous of abandoned)
					await session`
						insert into questpie_internal.seed_attempt_events
						(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
						values (${application}, ${previous.attemptId}, 1, ${seed.identity}, ${seed.checksum}, 'interrupted', ${new Date()}, null)
					`;
				if (head?.digest !== expectedSchemaDigest) {
					await session`
						insert into questpie_internal.seed_attempt_events
						(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
						values (${application}, ${attemptId}, 0, ${seed.identity}, ${seed.checksum}, 'blocked', ${new Date()}, 'QP-SEED-014')
					`;
					return fail(
						"QP-SEED-014",
						"seedSchemaDrift",
						`${application} migration head differs from the Seed schema`,
					);
				}
				try {
					await assertSchemaMatches(session, input.schema);
				} catch (error) {
					const errorCode =
						error && typeof error === "object" && "code" in error
							? String(error.code)
							: "QP-SEED-009";
					if (
						!["QP-SCHEMA-026", "QP-SCHEMA-027", "QP-SCHEMA-028"].includes(
							errorCode,
						)
					)
						throw error;
					await session`
						insert into questpie_internal.seed_attempt_events
						(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
						values (${application}, ${attemptId}, 0, ${seed.identity}, ${seed.checksum}, 'blocked', ${new Date()}, 'QP-SEED-014')
					`;
					blockedIdentity = seed.identity;
					break;
				}
				await session`
					insert into questpie_internal.seed_attempt_events
					(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
					values (${application}, ${attemptId}, 0, ${seed.identity}, ${seed.checksum}, 'started', ${new Date()}, null)
				`;
				try {
					await session.begin(async (transaction) => {
						await assertSchemaMatches(transaction, input.schema);
						for (const step of seed.steps)
							await executeSeedStep(transaction, input.schema, step);
						await transaction`
							insert into questpie_internal.seed_receipts
							(application_name, seed_identity, checksum, applied_schema_digest, committed_at, attempt_id)
							values (${application}, ${seed.identity}, ${seed.checksum}, ${head.digest}, ${new Date()}, ${attemptId})
						`;
						await transaction`
							insert into questpie_internal.seed_attempt_events
							(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
							values (${application}, ${attemptId}, 1, ${seed.identity}, ${seed.checksum}, 'succeeded', ${new Date()}, null)
						`;
					});
					applied.push(seed.identity);
				} catch (error) {
					const errorCode =
						error && typeof error === "object" && "code" in error
							? String(error.code)
							: "QP-SEED-009";
					const blocked = [
						"QP-SCHEMA-026",
						"QP-SCHEMA-027",
						"QP-SCHEMA-028",
					].includes(errorCode);
					await session`
						insert into questpie_internal.seed_attempt_events
						(application_name, attempt_id, sequence, seed_identity, checksum, event, occurred_at, error_code)
							values (${application}, ${attemptId}, 1, ${seed.identity}, ${seed.checksum}, ${blocked ? "blocked" : "failed"}, ${new Date()}, ${blocked ? "QP-SEED-014" : errorCode})
					`;
					if (blocked) {
						blockedIdentity = seed.identity;
						break;
					}
					throw error;
				}
			}
			if (blockedIdentity)
				return fail(
					"QP-SEED-014",
					"seedSchemaDrift",
					`${blockedIdentity} live Schema Fingerprint differs from the migration head`,
				);
		} finally {
			await session`select pg_catalog.pg_advisory_unlock(${applicationKey})`;
		}
		return { applied, alreadyApplied };
	} finally {
		session.release();
		await pool.close();
	}
}
