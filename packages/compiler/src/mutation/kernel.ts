import { canonicalBytes, compareAscii } from "../canonical";
import {
	normalizeBoundPolicy,
	selectDefaultPolicy,
	type PolicyProgramV1,
} from "../relational";
import type { NormalizedResource } from "../types";
import type {
	CollectionOperationProgramsV1,
	CollectionOperationProgramV1,
} from "./operation-set-contract";

type RecordValue = Readonly<Record<string, unknown>>;
type FieldFact = Readonly<{
	path: readonly string[];
	contract: RecordValue;
}>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

export function collectionFieldFacts(
	collection: NormalizedResource,
): readonly FieldFact[] {
	const visit = (
		fields: RecordValue,
		prefix: readonly string[],
	): readonly FieldFact[] =>
		Object.entries(fields).flatMap(([name, candidate]) => {
			const contract = record(
				candidate,
				`${collection.identity}/field:${[...prefix, name].join("/")}`,
			);
			const path = [...prefix, name];
			return contract.kind === "inlineShape"
				? visit(record(contract.fields, `${collection.identity}.fields`), path)
				: [{ path, contract }];
		});
	return visit(
		record(collection.value.fields, `${collection.identity}.fields`),
		[],
	).toSorted((left, right) =>
		compareAscii(left.path.join("/"), right.path.join("/")),
	);
}

export function requiredCreateFields(
	facts: readonly FieldFact[],
	eligibleFields: readonly (readonly string[])[],
): readonly (readonly string[])[] {
	const eligible = new Set(
		eligibleFields.map((fieldPath) => JSON.stringify(fieldPath)),
	);
	return facts
		.filter(
			({ path, contract }) =>
				contract.nullable === false &&
				contract.default === null &&
				eligible.has(JSON.stringify(path)),
		)
		.map(({ path }) => path);
}

export function requiredCreateLaneFields(
	facts: readonly FieldFact[],
	eligibleFields: readonly (readonly string[])[],
	alternateFields: readonly (readonly string[])[],
): readonly (readonly string[])[] {
	const alternate = new Set(
		alternateFields.map((fieldPath) => canonicalBytes(fieldPath)),
	);
	return requiredCreateFields(facts, eligibleFields).filter(
		(fieldPath) => !alternate.has(canonicalBytes(fieldPath)),
	);
}

function primaryKeyFields(
	collection: NormalizedResource,
): readonly (readonly string[])[] {
	const constraints = collection.contract.constraints as readonly RecordValue[];
	const primary = constraints
		.map((entry) => record(entry.contract, "Collection Constraint"))
		.find((contract) => contract.kind === "primaryKey");
	if (!primary || !Array.isArray(primary.fields))
		throw new TypeError(
			`${collection.identity} has no primary key for its Collection kernel`,
		);
	return primary.fields.map((field) => {
		if (
			!Array.isArray(field) ||
			field.length === 0 ||
			field.some((part) => typeof part !== "string" || part.length === 0)
		)
			throw new TypeError(
				`${collection.identity} has an invalid primary key Field`,
			);
		return field as readonly string[];
	});
}

function writeLimits() {
	return Object.freeze({
		inputBytes: 65_536,
		resultBytes: 1_048_576,
		rowsWritten: 100,
		durationMilliseconds: 5_000,
	});
}

function kernelProgram(
	collection: NormalizedResource,
	policy: PolicyProgramV1,
	member: "create" | "update",
): CollectionOperationProgramV1 {
	const facts = collectionFieldFacts(collection);
	const callerAuthority = new Set(
		(policy.fields?.callerInput[member] ?? []).map(({ path }) =>
			canonicalBytes(path),
		),
	);
	const callerInputFields = facts
		.filter(
			({ path, contract }) =>
				contract.server !== true &&
				(member === "create" || contract.immutable !== true) &&
				callerAuthority.has(canonicalBytes(path)),
		)
		.map(({ path }) => path);
	const caller = new Set(callerInputFields.map((path) => canonicalBytes(path)));
	const trustedValueFields = facts
		.filter(
			({ path, contract }) =>
				(member === "create" || contract.immutable !== true) &&
				(member === "create" || !caller.has(canonicalBytes(path))),
		)
		.map(({ path }) => path);
	return Object.freeze({
		identity:
			`mutation:__collectionKernel.${collection.name}.${member}` as const,
		kind: "mutation",
		mode: "writeTransaction",
		target: collection.identity as `collection:${string}`,
		member,
		policy: policy.identity,
		keyFields: member === "create" ? [] : primaryKeyFields(collection),
		callerInputFields,
		requiredCallerInputFields:
			member === "create"
				? requiredCreateLaneFields(facts, callerInputFields, trustedValueFields)
				: [],
		trustedValueFields,
		requiredTrustedValueFields:
			member === "create"
				? requiredCreateLaneFields(facts, trustedValueFields, callerInputFields)
				: [],
		selectedFieldPaths: facts.map(({ path }) => path),
		dataQuery: null,
		dataQueryDigest: null,
		normalizerProgramDigest: null,
		serverValueProgramDigest: null,
		outputCardinality: member === "create" ? "one" : "optionalOne",
		limits: writeLimits(),
	});
}

export function projectCollectionMutationKernels(
	resources: readonly NormalizedResource[],
): CollectionOperationProgramsV1 {
	const policies = resources
		.filter((resource) => resource.kind === "policy")
		.map((resource) => normalizeBoundPolicy(resource.value).program);
	const operations = resources
		.filter((resource) => resource.kind === "collection")
		.flatMap((collection) => {
			const candidates = policies.filter(
				(policy) => policy.target === collection.identity,
			);
			if (candidates.length === 0) return [];
			const policy = selectDefaultPolicy(
				collection.identity as `collection:${string}`,
				policies,
			);
			return (["create", "update"] as const).flatMap((member) =>
				policy.operations[member]
					? [kernelProgram(collection, policy, member)]
					: [],
			);
		})
		.toSorted((left, right) => compareAscii(left.identity, right.identity));
	return Object.freeze({
		format: "questpie.collection-operation-programs",
		version: 1,
		operations: Object.freeze(operations),
	});
}

export function adaptCollectionMutationKernels(
	kernels: CollectionOperationProgramsV1,
	adapters: CollectionOperationProgramsV1,
): CollectionOperationProgramsV1 {
	const kernelsByOwner = new Map<string, CollectionOperationProgramV1>(
		kernels.operations.map(
			(program) => [`${program.target}\0${program.member}`, program] as const,
		),
	);
	const adaptedOwners = new Set<string>();
	const adapted = adapters.operations.map((adapter) => {
		if (adapter.member !== "create" && adapter.member !== "update")
			return adapter;
		const owner = `${adapter.target}\0${adapter.member}`;
		const kernel = kernelsByOwner.get(owner);
		if (!kernel)
			throw new TypeError(
				`${adapter.identity} cannot adapt a missing Collection kernel`,
			);
		if (adapter.policy !== kernel.policy)
			throw new TypeError(
				`${adapter.identity} must adapt the default Collection Policy`,
			);
		adaptedOwners.add(owner);
		return Object.freeze({
			...kernel,
			identity: adapter.identity,
			callerInputFields: adapter.callerInputFields,
			requiredCallerInputFields: adapter.requiredCallerInputFields,
			trustedValueFields: adapter.trustedValueFields,
			requiredTrustedValueFields: adapter.requiredTrustedValueFields,
			selectedFieldPaths: adapter.selectedFieldPaths,
			normalizerProgramDigest: adapter.normalizerProgramDigest,
			serverValueProgramDigest: adapter.serverValueProgramDigest,
			limits: adapter.limits,
		});
	});
	const operations = [
		...kernels.operations.filter(
			({ target, member }) => !adaptedOwners.has(`${target}\0${member}`),
		),
		...adapted,
	].toSorted((left, right) => compareAscii(left.identity, right.identity));
	return Object.freeze({
		format: "questpie.collection-operation-programs",
		version: 1,
		operations: Object.freeze(operations),
	});
}
