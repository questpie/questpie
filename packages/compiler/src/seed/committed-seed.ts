import { createHash } from "node:crypto";

import {
	canonicalBytes,
	compareAscii,
	digest,
	hasLoneUnicodeSurrogate,
} from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { CompilerDiagnosticArguments } from "../diagnostic";
import type { SchemaProjectionV1 } from "../schema";
import { normalizeJsonBackedValue } from "./json-codec";

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

function seedError(...args: CompilerDiagnosticArguments): never {
	throw new CompilerDiagnosticError(...args);
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
			"seedTargetMismatch",
			`unknown Seed Collection ${identity}`,
		);
	return collection;
}

function normalizeValue(field: JsonRecord, value: unknown): SeedValueV1 {
	const invalid = (requirement: string): never =>
		seedError(
			"QP-SEED-003",
			"seedTargetMismatch",
			`${field.identity} ${requirement}`,
		);
	if (value === null) {
		if (field.nullable !== true) return invalid("does not accept SQL NULL");
		return null;
	}
	const type = field.type as JsonRecord;
	if (type.kind === "uuid") {
		if (
			typeof value !== "string" ||
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
				value,
			)
		)
			return invalid("requires canonical UUID text");
		return { kind: "uuid", value };
	}
	if (type.kind === "timestamp") {
		const withTimezone = type.withTimezone === true;
		const normalized = value;
		const pattern = withTimezone
			? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
			: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
		if (
			typeof normalized !== "string" ||
			!pattern.test(normalized) ||
			new Date(withTimezone ? normalized : `${normalized}Z`).toISOString() !==
				(withTimezone ? normalized : `${normalized}Z`)
		)
			return invalid("requires canonical timestamp text");
		return { kind: "timestamp", value: normalized };
	}
	if (type.kind === "date") {
		if (
			typeof value !== "string" ||
			!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
			new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
		)
			return invalid("requires canonical date text");
		return { kind: "date", value };
	}
	if (type.kind === "bigint") {
		if (
			typeof value !== "string" ||
			!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
		)
			return invalid("requires canonical bigint text");
		const number = BigInt(value);
		if (
			number < -9_223_372_036_854_775_808n ||
			number > 9_223_372_036_854_775_807n
		)
			return invalid("is outside PostgreSQL bigint");
		if (
			(typeof type.minimum === "string" && number < BigInt(type.minimum)) ||
			(typeof type.maximum === "string" && number > BigInt(type.maximum))
		)
			return invalid("violates its bigint bounds");
		return { kind: "bigint", value };
	}
	if (type.kind === "numeric") {
		const precision = Number(type.precision);
		const scale = Number(type.scale);
		const pattern =
			scale === 0
				? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/
				: new RegExp(`^(?:0|-[1-9][0-9]*|[1-9][0-9]*)\\.[0-9]{${scale}}$`);
		if (typeof value !== "string" || !pattern.test(value))
			return invalid("requires canonical numeric text");
		if (value.replace(/[-.]/g, "").length > precision)
			return invalid("exceeds numeric precision");
		return { kind: "numeric", value };
	}
	if (type.kind === "object" || type.kind === "array" || type.kind === "json")
		return normalizeJsonBackedValue(type, value, invalid, (codec, item) => {
			const normalized = normalizeValue(
				{
					identity: field.identity,
					nullable: codec.nullable,
					type: codec,
				},
				item,
			);
			return normalized &&
				typeof normalized === "object" &&
				"value" in normalized
				? normalized.value
				: normalized;
		});
	if (type.kind === "text") {
		if (typeof value !== "string") return invalid("requires NFC text");
		if (hasLoneUnicodeSurrogate(value))
			return invalid("does not accept a lone Unicode surrogate");
		if (value.normalize("NFC") !== value) return invalid("requires NFC text");
		const length = [...value].length;
		if (
			(typeof type.minLength === "number" && length < type.minLength) ||
			(typeof type.maxLength === "number" && length > type.maxLength)
		)
			return invalid("violates its text length bounds");
		return value;
	}
	if (type.kind === "boolean" && typeof value === "boolean") return value;
	if (
		type.kind === "integer" &&
		typeof value === "number" &&
		Number.isSafeInteger(value)
	) {
		if (value < -2_147_483_648 || value > 2_147_483_647)
			return invalid("is outside PostgreSQL integer");
		if (
			(typeof type.minimum === "number" && value < type.minimum) ||
			(typeof type.maximum === "number" && value > type.maximum)
		)
			return invalid("violates its integer bounds");
		return value as number;
	}
	return invalid("has an invalid Seed value");
}

function record(
	collection: JsonRecord,
	value: unknown,
	mode: "insert" | "partial" | "key",
): SeedFieldValueV1[] {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return seedError(
			"QP-SEED-003",
			"seedTargetMismatch",
			"Seed record must be an object",
		);
	const input = value as Record<string, unknown>;
	const fields = children(collection, "fields");
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
	const visit = (
		current: Readonly<Record<string, unknown>>,
		prefix: readonly string[],
	): void => {
		for (const [key, raw] of Object.entries(current)) {
			const path = [...prefix, key];
			const field = fields.find(
				(candidate) => canonicalBytes(candidate.path) === canonicalBytes(path),
			);
			if (field) {
				if (mode === "key" && !requiredKeys.has(String(field.identity)))
					return seedError(
						"QP-SEED-003",
						"seedTargetMismatch",
						`Seed record contains invalid Field ${path.join("/")}`,
					);
				result.push({
					field: String(field.identity),
					value: normalizeValue(field, raw),
				});
				continue;
			}
			const hasChildren = fields.some((candidate) => {
				const candidatePath = candidate.path as readonly string[];
				return (
					candidatePath.length > path.length &&
					path.every((segment, index) => candidatePath[index] === segment)
				);
			});
			if (!hasChildren || !raw || typeof raw !== "object" || Array.isArray(raw))
				return seedError(
					"QP-SEED-003",
					"seedTargetMismatch",
					`Seed record contains invalid Field ${path.join("/")}`,
				);
			visit(raw as Readonly<Record<string, unknown>>, path);
		}
	};
	visit(input, []);
	const present = new Set(result.map((item) => item.field));
	if (mode !== "partial")
		for (const identity of requiredKeys)
			if (!present.has(identity))
				return seedError(
					"QP-SEED-003",
					"seedTargetMismatch",
					`Seed record omits ${identity}`,
				);
	if (mode === "key" && result.length !== requiredKeys.size)
		return seedError(
			"QP-SEED-003",
			"seedTargetMismatch",
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
			"seedTargetMismatch",
			"Seed name is missing",
		);
	if (hasLoneUnicodeSurrogate(name))
		return seedError(
			"QP-SEED-003",
			"seedTargetMismatch",
			"Seed name does not accept a lone Unicode surrogate",
		);
	const identity = `seed:${name}` as const;
	const dependencies = [
		...((input.definition.dependsOn ?? []) as readonly string[]),
	]
		.map((item) => {
			if (hasLoneUnicodeSurrogate(item))
				return seedError(
					"QP-SEED-003",
					"seedTargetMismatch",
					`${identity} dependency does not accept a lone Unicode surrogate`,
				);
			return (
				item.startsWith("seed:") ? item : `seed:${item}`
			) as `seed:${string}`;
		})
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
					"seedTargetMismatch",
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
						"seedTargetMismatch",
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
	const names = Object.keys(seed.files).sort(compareAscii);
	if (
		canonicalBytes(names) !==
		canonicalBytes(["checksum.sha256", "seed.json", "steps.json"])
	)
		return seedError(
			"QP-SEED-004",
			"checksumMismatch",
			`${seed.identity} does not contain the exact three-file contract`,
		);
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
