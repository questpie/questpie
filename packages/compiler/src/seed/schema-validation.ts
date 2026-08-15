import { canonicalBytes } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { SchemaProjectionV1 } from "../schema";
import type {
	CommittedSeedV1,
	SeedFieldValueV1,
	SeedStepV1,
} from "./committed-seed";
import { createCommittedSeed, verifyCommittedSeed } from "./committed-seed";

type JsonRecord = Readonly<Record<string, unknown>>;

function incompatible(seed: CommittedSeedV1, message: string): never {
	throw new CompilerDiagnosticError(
		"QP-SEED-003",
		"seedTargetMismatch",
		`${seed.identity} ${message}`,
	);
}

function authoredRecord(
	seed: CommittedSeedV1,
	schema: SchemaProjectionV1,
	collectionIdentity: string,
	entries: readonly SeedFieldValueV1[] | undefined,
): Readonly<Record<string, unknown>> {
	if (!Array.isArray(entries))
		return incompatible(seed, "has a missing record");
	const collection = schema.collections.find(
		(candidate) => candidate.identity === collectionIdentity,
	) as JsonRecord | undefined;
	if (!collection)
		return incompatible(seed, "references an unknown Collection");
	const fields = Array.isArray(collection.fields)
		? (collection.fields as readonly JsonRecord[])
		: [];
	const result = Object.create(null) as Record<string, unknown>;
	for (const entry of entries) {
		const field = fields.find(
			(candidate) => candidate.identity === entry.field,
		);
		const path = field?.path;
		if (
			!Array.isArray(path) ||
			path.length === 0 ||
			path.some((segment) => typeof segment !== "string")
		)
			return incompatible(seed, "contains an unknown or duplicate Field");
		const value = entry.value;
		const type = (field as JsonRecord).type as JsonRecord;
		const authoredValue =
			type.kind !== "json" &&
			value &&
			typeof value === "object" &&
			"kind" in value
				? value.value
				: value;
		let parent = result;
		for (const segment of path.slice(0, -1) as string[]) {
			const existing = Object.hasOwn(parent, segment)
				? parent[segment]
				: undefined;
			if (existing === undefined)
				parent[segment] = Object.create(null) as Record<string, unknown>;
			else if (
				!existing ||
				typeof existing !== "object" ||
				Array.isArray(existing)
			)
				return incompatible(seed, "contains an unknown or duplicate Field");
			parent = parent[segment] as Record<string, unknown>;
		}
		const key = path.at(-1) as string;
		if (Object.hasOwn(parent, key))
			return incompatible(seed, "contains an unknown or duplicate Field");
		parent[key] = authoredValue;
	}
	return result;
}

function authoredStep(
	seed: CommittedSeedV1,
	schema: SchemaProjectionV1,
	step: SeedStepV1,
): JsonRecord {
	const common = { kind: step.kind, collection: step.collection };
	if (step.kind === "insert")
		return {
			...common,
			values: authoredRecord(seed, schema, step.collection, step.values),
		};
	if (step.kind === "update")
		return {
			...common,
			key: authoredRecord(seed, schema, step.collection, step.key),
			values: authoredRecord(seed, schema, step.collection, step.values),
		};
	if (step.kind === "upsert")
		return {
			...common,
			key: authoredRecord(seed, schema, step.collection, step.key),
			create: authoredRecord(seed, schema, step.collection, step.create),
			update: authoredRecord(seed, schema, step.collection, step.update),
		};
	if (step.kind === "delete")
		return {
			...common,
			key: authoredRecord(seed, schema, step.collection, step.key),
		};
	return incompatible(seed, "contains an unsupported step");
}

export function validateCommittedSeedSchema(
	seed: CommittedSeedV1,
	schema: SchemaProjectionV1,
): void {
	verifyCommittedSeed(seed);
	let recreated: CommittedSeedV1;
	try {
		recreated = createCommittedSeed({
			definition: {
				name: seed.identity.slice("seed:".length),
				dependsOn: seed.dependencies,
				steps: seed.steps.map((step) => authoredStep(seed, schema, step)),
			},
			schema,
		});
	} catch (error) {
		if (error instanceof CompilerDiagnosticError) throw error;
		return incompatible(seed, "cannot be interpreted against the Schema");
	}
	if (canonicalBytes(recreated) !== canonicalBytes(seed))
		return incompatible(seed, "does not reproduce from the current Schema");
}
