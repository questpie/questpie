import type { CollectionDefinition, ContextBootstrap } from "questpie";

import { runtimeArtifactDigest } from "../application/artifact-protocol";
import {
	definePostgresStatement,
	type PostgresParameter,
	type PostgresStatement,
	type PostgresTransactionRunner,
} from "../postgres";
import {
	decodeRelationalScalar,
	decodeRelationalScalarCodec,
	type ScalarCodecV1,
} from "./scalar";

type RecordValue = Readonly<Record<string, unknown>>;

const POSTGRES_MAX_TARGET_COLUMNS = 1_664;
const MAX_CONTEXT_BOOTSTRAP_FIELDS = POSTGRES_MAX_TARGET_COLUMNS / 2;

export type ContextBootstrapLookupV1 = Readonly<{
	key: Readonly<Record<string, unknown>>;
	select: Readonly<Record<string, unknown>>;
}>;

type ContextBootstrapFieldV1 = Readonly<{
	field: string;
	key: string;
	codec: ScalarCodecV1;
	nullable: boolean;
	selectionPosition: number;
	selectedColumn: string;
	valueColumn: string;
}>;

type ContextBootstrapKeyV1 = Readonly<{
	field: string;
	key: string;
	codec: ScalarCodecV1;
	nullable: false;
	postgresType: string;
	position: number;
}>;

export type PostgresContextBootstrapPlanV1 = Readonly<{
	format: "questpie.postgres-context-bootstrap-plan";
	version: 1;
	digest: string;
	collection: string;
	sql: string;
	key: readonly ContextBootstrapKeyV1[];
	fields: readonly ContextBootstrapFieldV1[];
}>;

export type LinkedPostgresContextBootstrapPlan = Readonly<{
	plan: PostgresContextBootstrapPlanV1;
	statement: PostgresStatement<
		ContextBootstrapLookupV1,
		Readonly<Record<string, unknown>> | null
	>;
}>;

export type LinkedPostgresContextBootstrapPlans = Readonly<{
	plans: readonly LinkedPostgresContextBootstrapPlan[];
	get(
		collectionIdentity: string,
	): LinkedPostgresContextBootstrapPlan | undefined;
}>;

export type LinkedPostgresContextBootstrapFactory = (
	signal: AbortSignal,
) => ContextBootstrap;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`invalid ContextBootstrap ${label}`);
	return value as RecordValue;
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value))
		throw new TypeError(`invalid ContextBootstrap ${label}`);
	return value;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`invalid ContextBootstrap ${label}`);
	return value;
}

function exact(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => actual[index] !== key)
	)
		throw new TypeError(`invalid ContextBootstrap ${label}`);
}

function codecEqual(left: ScalarCodecV1, right: ScalarCodecV1): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function postgresType(codec: ScalarCodecV1): string {
	if (codec.kind === "uuid") return "uuid";
	if (codec.kind === "boolean") return "bool";
	if (codec.kind === "integer") return "int4";
	if (codec.kind === "timestamp")
		return codec.withTimezone ? "timestamptz" : "timestamp";
	return "text";
}

function decodeSchema(schemaProjection: unknown) {
	const schema = record(schemaProjection, "Schema Projection");
	const collections = new Map<
		string,
		Readonly<{
			postgresName: string;
			fields: readonly Readonly<{
				field: string;
				key: string;
				postgresName: string;
				codec: ScalarCodecV1;
				nullable: boolean;
			}>[];
			primaryKey: readonly string[];
		}>
	>();
	for (const rawCollection of array(schema.collections, "Schema Collections")) {
		const collection = record(rawCollection, "Schema Collection");
		const identity = text(collection.identity, "Collection identity");
		const fields = array(collection.fields, "Schema Fields")
			.map((rawField) => {
				const field = record(rawField, "Schema Field");
				const path = array(field.path, "Schema Field path");
				if (path.length !== 1 || typeof path[0] !== "string") return null;
				const rawCodec = record(field.type, "Schema Field codec");
				if (
					typeof rawCodec.kind !== "string" ||
					!["uuid", "text", "boolean", "integer", "timestamp"].includes(
						rawCodec.kind,
					)
				)
					return null;
				const codec = decodeRelationalScalarCodec(
					rawCodec,
					"ContextBootstrap Schema Field",
				);
				return Object.freeze({
					field: text(field.identity, "Field identity"),
					key: path[0],
					postgresName: text(field.postgresName, "Field PostgreSQL name"),
					codec,
					nullable: field.nullable === true,
				});
			})
			.filter((field): field is NonNullable<typeof field> => field !== null)
			.toSorted((left, right) =>
				left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
			);
		const primary = array(collection.constraints, "Schema Constraints")
			.map((raw) => record(raw, "Schema Constraint"))
			.filter((constraint) => constraint.kind === "primaryKey");
		if (primary.length !== 1) continue;
		const primaryKey = array(primary[0]!.fields, "Primary key Fields").map(
			(field) => text(field, "Primary key Field"),
		);
		if (
			primaryKey.length === 0 ||
			primaryKey.some((identity) => {
				const field = fields.find((candidate) => candidate.field === identity);
				return !field || field.nullable;
			})
		)
			continue;
		collections.set(
			identity,
			Object.freeze({
				postgresName: text(
					collection.postgresName,
					"Collection PostgreSQL name",
				),
				fields,
				primaryKey,
			}),
		);
	}
	return collections;
}

function decodePlan(value: unknown): PostgresContextBootstrapPlanV1 {
	const raw = record(value, "plan");
	exact(
		raw,
		["format", "version", "digest", "collection", "sql", "key", "fields"],
		"plan keys",
	);
	const key = array(raw.key, "plan key").map((item, index) => {
		const field = record(item, "key Field");
		exact(
			field,
			["field", "key", "codec", "nullable", "postgresType", "position"],
			"key Field keys",
		);
		const codec = decodeRelationalScalarCodec(
			field.codec,
			"ContextBootstrap key codec",
		);
		if (field.nullable !== false || field.position !== index + 1)
			throw new TypeError("invalid ContextBootstrap key Field");
		return Object.freeze({
			field: text(field.field, "key Field identity"),
			key: text(field.key, "key Field key"),
			codec,
			nullable: false as const,
			postgresType: text(field.postgresType, "key PostgreSQL type"),
			position: index + 1,
		});
	});
	const fields = array(raw.fields, "plan Fields").map((item, index) => {
		const field = record(item, "selected Field");
		exact(
			field,
			[
				"field",
				"key",
				"codec",
				"nullable",
				"selectionPosition",
				"selectedColumn",
				"valueColumn",
			],
			"selected Field keys",
		);
		if (
			typeof field.nullable !== "boolean" ||
			field.selectionPosition !== key.length + index + 1 ||
			field.selectedColumn !== `qp_selected_${index}` ||
			field.valueColumn !== `qp_value_${index}`
		)
			throw new TypeError("invalid ContextBootstrap selected Field");
		return Object.freeze({
			field: text(field.field, "selected Field identity"),
			key: text(field.key, "selected Field key"),
			codec: decodeRelationalScalarCodec(
				field.codec,
				"ContextBootstrap selected codec",
			),
			nullable: field.nullable,
			selectionPosition: field.selectionPosition as number,
			selectedColumn: field.selectedColumn as string,
			valueColumn: field.valueColumn as string,
		});
	});
	if (
		fields.length > MAX_CONTEXT_BOOTSTRAP_FIELDS ||
		key.length + fields.length > POSTGRES_MAX_TARGET_COLUMNS
	)
		throw new RangeError("ContextBootstrap plan exceeds PostgreSQL bounds");
	const unsigned = {
		format: raw.format,
		version: raw.version,
		collection: raw.collection,
		sql: raw.sql,
		key,
		fields,
	};
	if (
		raw.format !== "questpie.postgres-context-bootstrap-plan" ||
		raw.version !== 1 ||
		runtimeArtifactDigest(
			"questpie-postgres-context-bootstrap-plan-v1",
			unsigned,
		) !== raw.digest
	)
		throw new TypeError("invalid ContextBootstrap plan digest");
	return Object.freeze({
		...unsigned,
		digest: text(raw.digest, "plan digest"),
	}) as PostgresContextBootstrapPlanV1;
}

function linkPlan(
	plan: PostgresContextBootstrapPlanV1,
	schema: ReturnType<typeof decodeSchema>,
): LinkedPostgresContextBootstrapPlan {
	const collection = schema.get(plan.collection);
	if (!collection) throw new TypeError("unknown ContextBootstrap Collection");
	if (
		plan.fields.length !== collection.fields.length ||
		plan.key.length !== collection.primaryKey.length
	)
		throw new TypeError("ContextBootstrap plan does not match Schema");
	for (const [index, field] of plan.fields.entries()) {
		const expected = collection.fields[index]!;
		if (
			field.field !== expected.field ||
			field.key !== expected.key ||
			field.nullable !== expected.nullable ||
			!codecEqual(field.codec, expected.codec)
		)
			throw new TypeError("ContextBootstrap Field does not match Schema");
	}
	for (const [index, key] of plan.key.entries()) {
		const expectedIdentity = collection.primaryKey[index];
		const expected = collection.fields.find(
			({ field }) => field === expectedIdentity,
		);
		if (
			!expected ||
			key.field !== expected.field ||
			key.key !== expected.key ||
			!codecEqual(key.codec, expected.codec)
		)
			throw new TypeError("ContextBootstrap key does not match Schema");
		if (key.postgresType !== postgresType(expected.codec))
			throw new TypeError("ContextBootstrap key cast does not match Schema");
	}
	const statement = definePostgresStatement({
		name: `context.${plan.digest}`,
		text: plan.sql,
		parameterCount: plan.key.length + plan.fields.length,
		parameters(lookup: ContextBootstrapLookupV1): readonly PostgresParameter[] {
			const keyNames = Object.keys(record(lookup?.key, "lookup key")).sort();
			const expectedKeys = plan.key.map(({ key }) => key).sort();
			if (
				keyNames.length !== expectedKeys.length ||
				expectedKeys.some((key, index) => keyNames[index] !== key)
			)
				throw new TypeError("ContextBootstrap requires the exact primary key");
			const selection = record(lookup?.select, "lookup selection");
			const selected = Object.keys(selection).sort();
			if (
				selected.length === 0 ||
				selected.some(
					(key) =>
						!plan.fields.some((field) => field.key === key) ||
						selection[key] !== true,
				)
			)
				throw new TypeError("ContextBootstrap requires known selected Fields");
			return Object.freeze([
				...plan.key.map(
					(field) =>
						decodeRelationalScalar(
							lookup.key[field.key],
							field.codec,
						) as PostgresParameter,
				),
				...plan.fields.map((field) => selection[field.key] === true),
			]);
		},
		decode(result) {
			if (
				result.command !== "SELECT" ||
				result.rowCount === null ||
				result.rowCount !== result.rows.length ||
				result.rows.length > 1
			)
				throw new TypeError("invalid ContextBootstrap result cardinality");
			const row = result.rows[0];
			if (!row) return null;
			if (row.length !== plan.fields.length * 2)
				throw new TypeError("invalid ContextBootstrap result width");
			const output: Record<string, unknown> = {};
			for (const [index, field] of plan.fields.entries()) {
				const selected = row[index * 2];
				const value = row[index * 2 + 1];
				if (typeof selected !== "boolean" || (!selected && value !== null))
					throw new TypeError("invalid ContextBootstrap selection guard");
				if (!selected) continue;
				if (value === null) {
					if (!field.nullable)
						throw new TypeError("invalid ContextBootstrap null");
					output[field.key] = null;
				} else output[field.key] = decodeRelationalScalar(value, field.codec);
			}
			return Object.freeze(output);
		},
	});
	return Object.freeze({ plan, statement });
}

export function linkPostgresContextBootstrapPlans(
	input: Readonly<{
		artifact: string;
		schemaProjection: unknown;
		expectedDigest: string;
	}>,
): LinkedPostgresContextBootstrapPlans {
	const decoded = record(JSON.parse(input.artifact), "plans artifact");
	exact(
		decoded,
		["format", "version", "digest", "plans"],
		"plans artifact keys",
	);
	const plans = array(decoded.plans, "plans").map(decodePlan);
	const unsigned = { format: decoded.format, version: decoded.version, plans };
	if (
		decoded.format !== "questpie.postgres-context-bootstrap-plans" ||
		decoded.version !== 1 ||
		decoded.digest !== input.expectedDigest ||
		runtimeArtifactDigest(
			"questpie-postgres-context-bootstrap-plans-v1",
			unsigned,
		) !== decoded.digest
	)
		throw new TypeError("invalid ContextBootstrap plans digest");
	const schema = decodeSchema(input.schemaProjection);
	if (
		plans.length !== schema.size ||
		plans.some(
			(plan, index) =>
				index > 0 && plan.collection <= plans[index - 1]!.collection,
		)
	)
		throw new TypeError("ContextBootstrap plans do not match Collections");
	const linked = Object.freeze(plans.map((plan) => linkPlan(plan, schema)));
	const byCollection = new Map(
		linked.map((plan) => [plan.plan.collection, plan]),
	);
	return Object.freeze({
		plans: linked,
		get: (identity: string) => byCollection.get(identity),
	});
}

export function executeLinkedPostgresContextBootstrap(
	database: PostgresTransactionRunner,
	linked: LinkedPostgresContextBootstrapPlan,
	lookup: ContextBootstrapLookupV1,
	signal?: AbortSignal,
) {
	return database.transaction({
		mode: { isolation: "repeatableRead", access: "readOnly" },
		control: { signal },
		use: (transaction) => transaction.execute(linked.statement, lookup),
	});
}

function collectionIdentity(definition: CollectionDefinition): string {
	if (
		!definition ||
		typeof definition !== "object" ||
		Array.isArray(definition)
	)
		throw new TypeError("unknown ContextBootstrap Collection");
	const candidate = definition as unknown as RecordValue;
	const brand = candidate["__questpie"];
	if (!brand || typeof brand !== "object" || Array.isArray(brand))
		throw new TypeError("unknown ContextBootstrap Collection");
	const resource = brand as RecordValue;
	if (
		resource.category !== "definition" ||
		resource.resourceKind !== "collection" ||
		typeof candidate.name !== "string"
	)
		throw new TypeError("unknown ContextBootstrap Collection");
	return `collection:${candidate.name}`;
}

export function createLinkedPostgresContextBootstrapFactory(
	input: Readonly<{
		database: PostgresTransactionRunner;
		plans: LinkedPostgresContextBootstrapPlans;
		collections: readonly CollectionDefinition[];
	}>,
): LinkedPostgresContextBootstrapFactory {
	const expectedPlans = new Set(input.plans.plans);
	if (expectedPlans.size !== input.plans.plans.length)
		throw new TypeError(
			"ContextBootstrap Collections do not match linked plans",
		);
	const byDefinition = new Map<
		CollectionDefinition,
		LinkedPostgresContextBootstrapPlan
	>();
	const identities = new Set<string>();
	const boundPlans = new Set<LinkedPostgresContextBootstrapPlan>();
	for (const definition of input.collections) {
		const identity = collectionIdentity(definition);
		const linked = input.plans.get(identity);
		if (
			!linked ||
			!expectedPlans.has(linked) ||
			linked.plan.collection !== identity ||
			identities.has(identity) ||
			byDefinition.has(definition) ||
			boundPlans.has(linked)
		)
			throw new TypeError(
				"ContextBootstrap Collections do not match linked plans",
			);
		identities.add(identity);
		boundPlans.add(linked);
		byDefinition.set(definition, linked);
	}
	if (boundPlans.size !== expectedPlans.size)
		throw new TypeError(
			"ContextBootstrap Collections do not match linked plans",
		);
	return (signal) => {
		if (!(signal instanceof AbortSignal))
			throw new TypeError("ContextBootstrap requires an AbortSignal");
		const get = async (
			definition: CollectionDefinition,
			lookup: ContextBootstrapLookupV1,
		): Promise<Readonly<Record<string, unknown>> | null> => {
			const linked = byDefinition.get(definition);
			if (!linked) throw new TypeError("unknown ContextBootstrap Collection");
			return executeLinkedPostgresContextBootstrap(
				input.database,
				linked,
				lookup,
				signal,
			);
		};
		return Object.freeze({ get }) as ContextBootstrap;
	};
}
