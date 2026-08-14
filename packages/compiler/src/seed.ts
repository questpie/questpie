import { createHash } from "node:crypto";

import { canonicalBytes, compareAscii, digest } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import type { SchemaProjectionV1 } from "./schema";

type JsonRecord = Readonly<Record<string, unknown>>;

export type SeedValueV1 =
	| null
	| boolean
	| number
	| string
	| Readonly<{
			kind: "uuid" | "bigint" | "numeric" | "date" | "timestamp" | "json";
			value: unknown;
	  }>;

export interface SeedFieldValueV1 extends JsonRecord {
	readonly field: string;
	readonly value: SeedValueV1;
}

export interface SeedStepV1 extends JsonRecord {
	readonly stepId: string;
	readonly kind: "insert" | "update" | "upsert" | "delete";
	readonly collection: string;
	readonly values?: readonly SeedFieldValueV1[];
	readonly key?: readonly SeedFieldValueV1[];
	readonly create?: readonly SeedFieldValueV1[];
	readonly update?: readonly SeedFieldValueV1[];
}

export interface CommittedSeedV1 {
	readonly identity: `seed:${string}`;
	readonly checksum: string;
	readonly dependencies: readonly `seed:${string}`[];
	readonly steps: readonly SeedStepV1[];
	readonly files: Readonly<{
		"seed.json": string;
		"steps.json": string;
		"checksum.sha256": string;
	}>;
}

function seedError(
	code: ConstructorParameters<typeof CompilerDiagnosticError>[0],
	diagnosticClass: string,
	message: string,
): never {
	throw new CompilerDiagnosticError(code, diagnosticClass, message);
}

function children(collection: JsonRecord, key: string): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}

function collectionFor(
	schema: SchemaProjectionV1,
	identity: string,
): JsonRecord {
	const collection = schema.collections.find(
		(item) => item.identity === identity,
	);
	if (!collection)
		return seedError(
			"QP-SEED-003",
			"stepSchemaIncompatible",
			`unknown Seed Collection ${identity}`,
		);
	return collection;
}

function normalizeValue(field: JsonRecord, value: unknown): SeedValueV1 {
	if (value === null) {
		if (field.nullable !== true)
			return seedError(
				"QP-SEED-003",
				"stepSchemaIncompatible",
				`${field.identity} does not accept SQL NULL`,
			);
		return null;
	}
	const type = field.type as JsonRecord;
	if (type.kind === "uuid") {
		if (typeof value !== "string")
			return seedError(
				"QP-SEED-003",
				"stepSchemaIncompatible",
				`${field.identity} requires UUID text`,
			);
		return { kind: "uuid", value };
	}
	if (type.kind === "timestamp") {
		const normalized = value instanceof Date ? value.toISOString() : value;
		if (typeof normalized !== "string" || Number.isNaN(Date.parse(normalized)))
			return seedError(
				"QP-SEED-003",
				"stepSchemaIncompatible",
				`${field.identity} requires timestamp text`,
			);
		return { kind: "timestamp", value: new Date(normalized).toISOString() };
	}
	if (
		type.kind === "date" ||
		type.kind === "bigint" ||
		type.kind === "numeric"
	) {
		if (typeof value !== "string")
			return seedError(
				"QP-SEED-003",
				"stepSchemaIncompatible",
				`${field.identity} requires canonical text`,
			);
		return { kind: type.kind as "date" | "bigint" | "numeric", value };
	}
	if (type.kind === "object" || type.kind === "array" || type.kind === "json")
		return { kind: "json", value };
	if (
		(type.kind === "text" && typeof value === "string") ||
		(type.kind === "boolean" && typeof value === "boolean") ||
		(type.kind === "integer" && Number.isSafeInteger(value))
	)
		return value as string | boolean | number;
	return seedError(
		"QP-SEED-003",
		"stepSchemaIncompatible",
		`${field.identity} has an invalid Seed value`,
	);
}

function record(
	collection: JsonRecord,
	value: unknown,
	mode: "insert" | "partial" | "key",
): SeedFieldValueV1[] {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return seedError(
			"QP-SEED-003",
			"stepSchemaIncompatible",
			"Seed record must be an object",
		);
	const input = value as Record<string, unknown>;
	const fields = children(collection, "fields");
	const byKey = new Map(
		fields.map((field) => [
			String((field.path as readonly string[]).at(-1)),
			field,
		]),
	);
	const primary = children(collection, "constraints").find(
		(item) => item.kind === "primaryKey",
	);
	const requiredKeys =
		mode === "key"
			? new Set(primary?.fields as readonly string[])
			: new Set(
					fields
						.filter(
							(field) => field.nullable !== true && field.default === null,
						)
						.map((field) => String(field.identity)),
				);
	const result: SeedFieldValueV1[] = [];
	for (const [key, raw] of Object.entries(input)) {
		const field = byKey.get(key);
		if (!field || (mode === "key" && !requiredKeys.has(String(field.identity))))
			return seedError(
				"QP-SEED-003",
				"stepSchemaIncompatible",
				`Seed record contains invalid Field ${key}`,
			);
		result.push({
			field: String(field.identity),
			value: normalizeValue(field, raw),
		});
	}
	const present = new Set(result.map((item) => item.field));
	if (mode !== "partial")
		for (const identity of requiredKeys)
			if (!present.has(identity))
				return seedError(
					"QP-SEED-003",
					"stepSchemaIncompatible",
					`Seed record omits ${identity}`,
				);
	if (mode === "key" && result.length !== requiredKeys.size)
		return seedError(
			"QP-SEED-003",
			"stepSchemaIncompatible",
			"Seed key must contain exactly the primary key",
		);
	return result.sort((left, right) => compareAscii(left.field, right.field));
}

export function createCommittedSeed(
	input: Readonly<{
		definition: JsonRecord;
		schema: SchemaProjectionV1;
	}>,
): CommittedSeedV1 {
	const name = input.definition.name;
	if (typeof name !== "string" || name.length === 0)
		return seedError(
			"QP-SEED-003",
			"stepSchemaIncompatible",
			"Seed name is missing",
		);
	const identity = `seed:${name}` as const;
	const dependencies = [
		...((input.definition.dependsOn ?? []) as readonly string[]),
	]
		.map(
			(item) =>
				(item.startsWith("seed:") ? item : `seed:${item}`) as `seed:${string}`,
		)
		.sort(compareAscii);
	if (
		new Set(dependencies).size !== dependencies.length ||
		dependencies.includes(identity)
	)
		return seedError(
			"QP-SEED-002",
			"seedDependencyCycle",
			`${identity} has invalid dependencies`,
		);
	const authored = input.definition.steps;
	if (!Array.isArray(authored))
		return seedError(
			"QP-SEED-009",
			"unsupportedSeedStep",
			`${identity} steps are missing`,
		);
	const steps = authored.map((raw): SeedStepV1 => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			return seedError(
				"QP-SEED-009",
				"unsupportedSeedStep",
				`${identity} contains a callback or invalid step`,
			);
		const value = raw as JsonRecord;
		const kind = value.kind;
		if (!["insert", "update", "upsert", "delete"].includes(String(kind)))
			return seedError(
				"QP-SEED-009",
				"unsupportedSeedStep",
				`${identity} contains ${String(kind)}`,
			);
		const collection = collectionFor(input.schema, String(value.collection));
		const base = {
			kind: kind as SeedStepV1["kind"],
			collection: String(collection.identity),
			...(kind === "insert"
				? { values: record(collection, value.values, "insert") }
				: {}),
			...(kind === "update"
				? {
						key: record(collection, value.key, "key"),
						values: record(collection, value.values, "partial"),
					}
				: {}),
			...(kind === "delete"
				? { key: record(collection, value.key, "key") }
				: {}),
			...(kind === "upsert"
				? {
						key: record(collection, value.key, "key"),
						create: record(collection, value.create, "partial"),
						update: record(collection, value.update, "partial"),
					}
				: {}),
		};
		if (kind === "upsert") {
			const keyFields = new Set((base.key ?? []).map((item) => item.field));
			if (
				[...(base.create ?? []), ...(base.update ?? [])].some((item) =>
					keyFields.has(item.field),
				)
			)
				return seedError(
					"QP-SEED-003",
					"stepSchemaIncompatible",
					"upsert repeats a primary-key Field",
				);
			const insertFields = new Set(
				[...(base.key ?? []), ...(base.create ?? [])].map((item) => item.field),
			);
			for (const field of children(collection, "fields"))
				if (
					field.nullable !== true &&
					field.default === null &&
					!insertFields.has(String(field.identity))
				)
					return seedError(
						"QP-SEED-003",
						"stepSchemaIncompatible",
						`upsert create omits ${String(field.identity)}`,
					);
		}
		return { stepId: digest("questpie-seed-step-v1", base), ...base };
	});
	const stepsBytes = canonicalBytes(steps);
	const metadata = {
		format: "questpie.seed",
		version: 1,
		identity,
		dependencies,
		stepsDigest: digest("questpie-seed-steps-v1", steps),
	};
	const seedBytes = canonicalBytes(metadata);
	const checksum = createHash("sha256")
		.update("questpie-seed-v1\0")
		.update(seedBytes)
		.update("\0")
		.update(stepsBytes)
		.digest("hex");
	return {
		identity,
		checksum,
		dependencies,
		steps,
		files: {
			"seed.json": seedBytes,
			"steps.json": stepsBytes,
			"checksum.sha256": `${checksum}\n`,
		},
	};
}

export function verifyCommittedSeed(seed: CommittedSeedV1): void {
	const recreated = createHash("sha256")
		.update("questpie-seed-v1\0")
		.update(seed.files["seed.json"])
		.update("\0")
		.update(seed.files["steps.json"])
		.digest("hex");
	let metadata: JsonRecord;
	let steps: readonly SeedStepV1[];
	try {
		metadata = JSON.parse(seed.files["seed.json"]) as JsonRecord;
		steps = JSON.parse(seed.files["steps.json"]) as readonly SeedStepV1[];
	} catch {
		return seedError(
			"QP-SEED-004",
			"checksumMismatch",
			`${seed.identity} JSON is invalid`,
		);
	}
	if (
		recreated !== seed.checksum ||
		seed.files["checksum.sha256"] !== `${recreated}\n` ||
		canonicalBytes(metadata) !== seed.files["seed.json"] ||
		canonicalBytes(steps) !== seed.files["steps.json"] ||
		metadata.format !== "questpie.seed" ||
		metadata.version !== 1 ||
		metadata.identity !== seed.identity ||
		metadata.stepsDigest !== digest("questpie-seed-steps-v1", steps) ||
		canonicalBytes(metadata.dependencies) !==
			canonicalBytes(seed.dependencies) ||
		canonicalBytes(steps) !== canonicalBytes(seed.steps)
	)
		return seedError(
			"QP-SEED-004",
			"checksumMismatch",
			`${seed.identity} artifact changed`,
		);
}

export function orderCommittedSeeds(
	seeds: readonly CommittedSeedV1[],
): CommittedSeedV1[] {
	const byIdentity = new Map(seeds.map((seed) => [seed.identity, seed]));
	if (byIdentity.size !== seeds.length)
		return seedError(
			"QP-SEED-002",
			"seedDependencyCycle",
			"Seed identity is duplicated",
		);
	const ordered: CommittedSeedV1[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (seed: CommittedSeedV1): void => {
		if (visiting.has(seed.identity))
			return seedError(
				"QP-SEED-002",
				"seedDependencyCycle",
				`${seed.identity} closes a cycle`,
			);
		if (visited.has(seed.identity)) return;
		visiting.add(seed.identity);
		for (const identity of seed.dependencies) {
			const dependency = byIdentity.get(identity);
			if (!dependency)
				return seedError(
					"QP-SEED-001",
					"missingSeedDependency",
					`${seed.identity} requires ${identity}`,
				);
			visit(dependency);
		}
		visiting.delete(seed.identity);
		visited.add(seed.identity);
		verifyCommittedSeed(seed);
		ordered.push(seed);
	};
	for (const seed of [...seeds].sort((left, right) =>
		compareAscii(left.identity, right.identity),
	))
		visit(seed);
	return ordered;
}
