import { canonicalBytes } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { SchemaProjectionV1 } from "../schema";
import type { CommittedSeedV1, SeedFieldValueV1, SeedStepV1 } from "../seed";
import { createCommittedSeed, verifyCommittedSeed } from "../seed";

type JsonRecord = Readonly<Record<string, unknown>>;

function incompatible(seed: CommittedSeedV1, message: string): never {
	throw new CompilerDiagnosticError(
		"QP-SEED-003",
		"stepSchemaIncompatible",
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
	const result: Record<string, unknown> = {};
	for (const entry of entries) {
		const field = fields.find(
			(candidate) => candidate.identity === entry.field,
		);
		const path = field?.path;
		const key = Array.isArray(path) ? path.at(-1) : undefined;
		if (typeof key !== "string" || Object.hasOwn(result, key))
			return incompatible(seed, "contains an unknown or duplicate Field");
		const value = entry.value;
		result[key] =
			value && typeof value === "object" && "kind" in value
				? value.value
				: value;
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
