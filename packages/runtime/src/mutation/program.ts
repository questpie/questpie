import { createHash } from "node:crypto";

import { canonicalMutationBytes } from "./canonical";
import { decodeMutationDataQueryTemplate } from "./query-template";

type RecordValue = Readonly<Record<string, unknown>>;
type FieldPath = readonly string[];
type MutationMember = "create" | "delete" | "update";
type OperationMember = "create" | "delete" | "get" | "list" | "update";

export type MutationPolicyLinkV1 = Readonly<{
	identity: string;
	target: string;
}>;

export type FieldNormalizerProgramV1 = Readonly<{
	artifact: "questpie.field-normalizer-program";
	version: 1;
	target: string;
	operation: "create" | "update";
	steps: readonly Readonly<{
		target: FieldPath;
		expression: Readonly<{
			kind: "trim" | "trimIfPresent";
			source: FieldPath;
		}>;
	}>[];
	capabilities: readonly [];
}>;

export type ServerValueProgramV1 = Readonly<{
	artifact: "questpie.server-value-program";
	version: 1;
	target: string;
	operation: "create" | "update";
	assignments: readonly Readonly<{
		target: FieldPath;
		mode: "overwrite";
		source: FieldPath;
	}>[];
	capabilities: readonly [];
}>;

export type CollectionOperationProgramV1 = Readonly<{
	identity: string;
	kind: "mutation" | "query";
	mode: "readSnapshot" | "writeTransaction";
	target: string;
	member: OperationMember;
	policy: string;
	keyFields: readonly FieldPath[];
	callerInputFields: readonly FieldPath[];
	selectedFieldPaths: readonly FieldPath[];
	dataQuery: RecordValue | null;
	dataQueryDigest: string | null;
	normalizerProgramDigest: string | null;
	serverValueProgramDigest: string | null;
	outputCardinality: "many" | "one" | "optionalOne";
	limits: Readonly<{
		inputBytes: 65_536;
		resultBytes: 1_048_576;
		rowsRead?: 10_000;
		rowsWritten?: 100;
		durationMilliseconds: 5_000;
	}>;
}>;

export type LinkedCollectionOperationProgramV1 = CollectionOperationProgramV1 &
	Readonly<{
		normalizerProgram: FieldNormalizerProgramV1 | null;
		serverValueProgram: ServerValueProgramV1 | null;
	}>;

export type LinkedCollectionMutationProgramsV1 = Readonly<{
	operations: readonly LinkedCollectionOperationProgramV1[];
	byIdentity: ReadonlyMap<string, LinkedCollectionOperationProgramV1>;
	byTarget: ReadonlyMap<
		string,
		ReadonlyMap<OperationMember, LinkedCollectionOperationProgramV1>
	>;
}>;

const digestPattern = /^[0-9a-f]{64}$/;

function fail(message: string): never {
	throw new TypeError(`Invalid Collection Mutation program: ${message}`);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
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
		expected.some((key, index) => key !== actual[index])
	)
		fail(`${label} has invalid keys`);
}

function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) fail(`${label} must be an array`);
	return value;
}

function text(value: unknown, label: string, pattern?: RegExp): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		(pattern !== undefined && !pattern.test(value))
	)
		fail(`${label} is invalid`);
	return value;
}

function digest(value: unknown, label: string): string {
	return text(value, label, digestPattern);
}

function programDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

function fieldPath(value: unknown, label: string): FieldPath {
	const path = array(value, label);
	if (
		path.length === 0 ||
		path.some((part) => typeof part !== "string" || part.length === 0)
	)
		fail(`${label} is invalid`);
	return Object.freeze(path as string[]);
}

function fieldPaths(value: unknown, label: string): readonly FieldPath[] {
	const paths = array(value, label).map((item, index) =>
		fieldPath(item, `${label} ${index}`),
	);
	const keys = paths.map((path) => JSON.stringify(path));
	if (new Set(keys).size !== keys.length) fail(`${label} must be unique`);
	return Object.freeze(paths);
}

function dataQuery(value: unknown, label: string): RecordValue {
	return decodeMutationDataQueryTemplate(value, label);
}

function decodeNormalizer(
	value: unknown,
	index: number,
): FieldNormalizerProgramV1 {
	const label = `normalizer program ${index}`;
	const source = record(value, label);
	exact(
		source,
		["artifact", "version", "target", "operation", "steps", "capabilities"],
		label,
	);
	if (
		source.artifact !== "questpie.field-normalizer-program" ||
		source.version !== 1 ||
		(source.operation !== "create" && source.operation !== "update") ||
		array(source.capabilities, `${label} capabilities`).length !== 0
	)
		fail(`${label} header is invalid`);
	const target = text(source.target, `${label} target`);
	if (
		!target.startsWith("collection:") ||
		target.length === "collection:".length
	)
		fail(`${label} target is invalid`);
	const steps = array(source.steps, `${label} steps`).map(
		(rawStep, stepIndex) => {
			const stepLabel = `${label} step ${stepIndex}`;
			const step = record(rawStep, stepLabel);
			exact(step, ["target", "expression"], stepLabel);
			const expression = record(step.expression, `${stepLabel} expression`);
			exact(expression, ["kind", "source"], `${stepLabel} expression`);
			if (expression.kind !== "trim" && expression.kind !== "trimIfPresent")
				fail(`${stepLabel} expression kind is invalid`);
			return Object.freeze({
				target: fieldPath(step.target, `${stepLabel} target`),
				expression: Object.freeze({
					kind: expression.kind,
					source: fieldPath(expression.source, `${stepLabel} source`),
				}),
			});
		},
	);
	const targets = steps.map((step) => JSON.stringify(step.target));
	if (new Set(targets).size !== targets.length)
		fail(`${label} targets must be unique`);
	return Object.freeze({
		artifact: "questpie.field-normalizer-program",
		version: 1,
		target,
		operation: source.operation,
		steps: Object.freeze(steps),
		capabilities: Object.freeze([]) as readonly [],
	});
}

function decodeServerValues(
	value: unknown,
	index: number,
): ServerValueProgramV1 {
	const label = `server-value program ${index}`;
	const source = record(value, label);
	exact(
		source,
		[
			"artifact",
			"version",
			"target",
			"operation",
			"assignments",
			"capabilities",
		],
		label,
	);
	if (
		source.artifact !== "questpie.server-value-program" ||
		source.version !== 1 ||
		(source.operation !== "create" && source.operation !== "update") ||
		array(source.capabilities, `${label} capabilities`).length !== 0
	)
		fail(`${label} header is invalid`);
	const target = text(source.target, `${label} target`);
	if (
		!target.startsWith("collection:") ||
		target.length === "collection:".length
	)
		fail(`${label} target is invalid`);
	const assignments = array(source.assignments, `${label} assignments`).map(
		(rawAssignment, assignmentIndex) => {
			const assignmentLabel = `${label} assignment ${assignmentIndex}`;
			const assignment = record(rawAssignment, assignmentLabel);
			exact(assignment, ["target", "mode", "source"], assignmentLabel);
			if (assignment.mode !== "overwrite")
				fail(`${assignmentLabel} mode is invalid`);
			return Object.freeze({
				target: fieldPath(assignment.target, `${assignmentLabel} target`),
				mode: "overwrite" as const,
				source: fieldPath(assignment.source, `${assignmentLabel} source`),
			});
		},
	);
	const targets = assignments.map((assignment) =>
		JSON.stringify(assignment.target),
	);
	if (new Set(targets).size !== targets.length)
		fail(`${label} targets must be unique`);
	return Object.freeze({
		artifact: "questpie.server-value-program",
		version: 1,
		target,
		operation: source.operation,
		assignments: Object.freeze(assignments),
		capabilities: Object.freeze([]) as readonly [],
	});
}

function decodeOperation(
	value: unknown,
	index: number,
): CollectionOperationProgramV1 {
	const label = `collection operation ${index}`;
	const source = record(value, label);
	exact(
		source,
		[
			"identity",
			"kind",
			"mode",
			"target",
			"member",
			"policy",
			"keyFields",
			"callerInputFields",
			"selectedFieldPaths",
			"dataQuery",
			"dataQueryDigest",
			"normalizerProgramDigest",
			"serverValueProgramDigest",
			"outputCardinality",
			"limits",
		],
		label,
	);
	const identity = text(source.identity, `${label} identity`);
	const target = text(source.target, `${label} target`);
	const policy = text(source.policy, `${label} policy`);
	if (
		!target.startsWith("collection:") ||
		target.length === "collection:".length
	)
		fail(`${label} target is invalid`);
	if (!policy.startsWith("policy:") || policy.length === "policy:".length)
		fail(`${label} policy is invalid`);
	const member = source.member as OperationMember;
	const expected = {
		list: ["query", "readSnapshot", "many"],
		get: ["query", "readSnapshot", "optionalOne"],
		create: ["mutation", "writeTransaction", "one"],
		update: ["mutation", "writeTransaction", "optionalOne"],
		delete: ["mutation", "writeTransaction", "optionalOne"],
	}[member];
	if (
		!expected ||
		source.kind !== expected[0] ||
		source.mode !== expected[1] ||
		source.outputCardinality !== expected[2] ||
		!identity.endsWith(`.${member}`) ||
		!identity.startsWith(`${source.kind}:`) ||
		identity.length <= `${source.kind}:.${member}`.length
	)
		fail(`${label} kind, mode, member, or cardinality is invalid`);
	const keyFields = fieldPaths(source.keyFields, `${label} keyFields`);
	const callerInputFields = fieldPaths(
		source.callerInputFields,
		`${label} callerInputFields`,
	);
	const selectedFieldPaths = fieldPaths(
		source.selectedFieldPaths,
		`${label} selectedFieldPaths`,
	);
	if (selectedFieldPaths.length === 0)
		fail(`${label} selection must not be empty`);
	if ((member === "list" || member === "create") !== (keyFields.length === 0))
		fail(`${label} keyFields do not match its member`);
	const embeddedQuery =
		source.dataQuery === null
			? null
			: dataQuery(source.dataQuery, `${label} dataQuery`);
	const embeddedDigest =
		source.dataQueryDigest === null
			? null
			: digest(source.dataQueryDigest, `${label} dataQueryDigest`);
	if (
		(member === "list") !== (embeddedQuery !== null) ||
		(embeddedQuery === null) !== (embeddedDigest === null) ||
		(embeddedQuery !== null &&
			(programDigest("questpie-data-query-template-v1", embeddedQuery) !==
				embeddedDigest ||
				embeddedQuery.from !== target))
	)
		fail(`${label} dataQuery link is invalid`);
	const normalizerProgramDigest =
		source.normalizerProgramDigest === null
			? null
			: digest(
					source.normalizerProgramDigest,
					`${label} normalizerProgramDigest`,
				);
	const serverValueProgramDigest =
		source.serverValueProgramDigest === null
			? null
			: digest(
					source.serverValueProgramDigest,
					`${label} serverValueProgramDigest`,
				);
	if (
		!(["create", "update"] as readonly string[]).includes(member) &&
		(normalizerProgramDigest !== null || serverValueProgramDigest !== null)
	)
		fail(`${label} read/delete operation cannot reference write programs`);
	const limits = record(source.limits, `${label} limits`);
	const write = source.kind === "mutation";
	exact(
		limits,
		write
			? ["inputBytes", "resultBytes", "rowsWritten", "durationMilliseconds"]
			: ["inputBytes", "resultBytes", "rowsRead", "durationMilliseconds"],
		`${label} limits`,
	);
	if (
		limits.inputBytes !== 65_536 ||
		limits.resultBytes !== 1_048_576 ||
		limits.durationMilliseconds !== 5_000 ||
		(write ? limits.rowsWritten !== 100 : limits.rowsRead !== 10_000)
	)
		fail(`${label} limits are invalid`);
	return Object.freeze({
		identity,
		kind: source.kind as "mutation" | "query",
		mode: source.mode as "readSnapshot" | "writeTransaction",
		target,
		member,
		policy,
		keyFields,
		callerInputFields,
		selectedFieldPaths,
		dataQuery: embeddedQuery,
		dataQueryDigest: embeddedDigest,
		normalizerProgramDigest,
		serverValueProgramDigest,
		outputCardinality: source.outputCardinality as
			| "many"
			| "one"
			| "optionalOne",
		limits: Object.freeze(
			write
				? {
						inputBytes: 65_536,
						resultBytes: 1_048_576,
						rowsWritten: 100,
						durationMilliseconds: 5_000,
					}
				: {
						inputBytes: 65_536,
						resultBytes: 1_048_576,
						rowsRead: 10_000,
						durationMilliseconds: 5_000,
					},
		),
	});
}

function decodeEnvelope(
	value: unknown,
	label: string,
	format: string,
	member: string,
): readonly unknown[] {
	const envelope = record(value, label);
	exact(envelope, ["format", "version", member], label);
	if (envelope.format !== format || envelope.version !== 1)
		fail(`${label} header is invalid`);
	return array(envelope[member], `${label} ${member}`);
}

function uniqueMap<T>(
	values: readonly T[],
	key: (value: T) => string,
	label: string,
): ReadonlyMap<string, T> {
	const result = new Map<string, T>();
	for (const value of values) {
		const identity = key(value);
		if (result.has(identity)) fail(`${label} ${identity} is duplicated`);
		result.set(identity, value);
	}
	return result;
}

export function linkCollectionMutationPrograms(
	input: Readonly<{
		collectionOperations: unknown;
		fieldNormalizers: unknown;
		serverValues: unknown;
		policies: readonly MutationPolicyLinkV1[];
	}>,
): LinkedCollectionMutationProgramsV1 {
	const operations = decodeEnvelope(
		input.collectionOperations,
		"collection-operation programs",
		"questpie.collection-operation-programs",
		"operations",
	).map(decodeOperation);
	const operationIds = operations.map(({ identity }) => identity);
	if (
		operationIds.some(
			(identity, index) => identity !== [...operationIds].sort()[index],
		)
	)
		fail("collection operations must be sorted by identity");
	uniqueMap(operations, ({ identity }) => identity, "operation identity");
	const operationOwners = uniqueMap(
		operations,
		({ target, member }) => `${target}\0${member}`,
		"operation owner",
	);
	const normalizers = decodeEnvelope(
		input.fieldNormalizers,
		"field-normalizer programs",
		"questpie.field-normalizer-programs",
		"programs",
	).map(decodeNormalizer);
	const serverValues = decodeEnvelope(
		input.serverValues,
		"server-value programs",
		"questpie.server-value-programs",
		"programs",
	).map(decodeServerValues);
	const normalizerByDigest = uniqueMap(
		normalizers,
		(program) => programDigest("questpie-field-normalizer-program-v1", program),
		"normalizer digest",
	);
	const serverValueByDigest = uniqueMap(
		serverValues,
		(program) => programDigest("questpie-server-value-program-v1", program),
		"server-value digest",
	);
	uniqueMap(
		normalizers,
		({ target, operation }) => `${target}\0${operation}`,
		"normalizer owner",
	);
	uniqueMap(
		serverValues,
		({ target, operation }) => `${target}\0${operation}`,
		"server-value owner",
	);
	const policyLinks = input.policies.map((rawPolicy, index) => {
		const policy = record(rawPolicy, `Policy link ${index}`);
		exact(policy, ["identity", "target"], `Policy link ${index}`);
		const identity = text(policy.identity, `Policy link ${index} identity`);
		const target = text(policy.target, `Policy link ${index} target`);
		if (
			!identity.startsWith("policy:") ||
			identity.length === "policy:".length ||
			!target.startsWith("collection:") ||
			target.length === "collection:".length
		)
			fail(`Policy link ${index} identity or target is invalid`);
		return Object.freeze({ identity, target });
	});
	const policies = uniqueMap(
		policyLinks,
		({ identity }) => identity,
		"Policy identity",
	);
	const usedNormalizerDigests = new Set<string>();
	const usedServerValueDigests = new Set<string>();
	const linked = operations.map((operation) => {
		const policy = policies.get(operation.policy);
		if (!policy || policy.target !== operation.target)
			fail(`operation ${operation.identity} has an invalid Policy link`);
		const normalizer =
			operation.normalizerProgramDigest === null
				? null
				: normalizerByDigest.get(operation.normalizerProgramDigest);
		const values =
			operation.serverValueProgramDigest === null
				? null
				: serverValueByDigest.get(operation.serverValueProgramDigest);
		for (const [program, digestValue, kind] of [
			[normalizer, operation.normalizerProgramDigest, "normalizer"],
			[values, operation.serverValueProgramDigest, "server-value"],
		] as const) {
			if (digestValue !== null) {
				if (
					!program ||
					program.target !== operation.target ||
					program.operation !== operation.member
				)
					fail(`operation ${operation.identity} has an invalid ${kind} link`);
				(kind === "normalizer"
					? usedNormalizerDigests
					: usedServerValueDigests
				).add(digestValue);
			}
		}
		const callerFields = new Set(
			operation.callerInputFields.map((path) => JSON.stringify(path)),
		);
		for (const step of normalizer?.steps ?? [])
			if (
				!callerFields.has(JSON.stringify(step.target)) ||
				!callerFields.has(JSON.stringify(step.expression.source))
			)
				fail(
					`operation ${operation.identity} normalizes an undeclared input Field`,
				);
		for (const assignment of values?.assignments ?? []) {
			const source = JSON.stringify(assignment.source);
			const executionSource = new Set([
				'["operationTime"]',
				'["principal","id"]',
				'["principal","kind"]',
				'["tenant","id"]',
			]).has(source);
			if (!executionSource && !callerFields.has(source))
				fail(
					`operation ${operation.identity} reads an undeclared server-value source`,
				);
		}
		return Object.freeze({
			...operation,
			normalizerProgram: normalizer ?? null,
			serverValueProgram: values ?? null,
		});
	});
	if (
		usedNormalizerDigests.size !== normalizerByDigest.size ||
		usedServerValueDigests.size !== serverValueByDigest.size
	)
		fail("write program must be referenced exactly once");
	const byTarget = new Map<
		string,
		Map<OperationMember, LinkedCollectionOperationProgramV1>
	>();
	for (const [owner, operation] of operationOwners) {
		const [target] = owner.split("\0");
		const members = byTarget.get(target!) ?? new Map();
		members.set(
			operation.member,
			linked.find(({ identity }) => identity === operation.identity)!,
		);
		byTarget.set(target!, members);
	}
	return Object.freeze({
		operations: Object.freeze(linked),
		byIdentity: uniqueMap(
			linked,
			({ identity }) => identity,
			"linked operation identity",
		),
		byTarget: byTarget as ReadonlyMap<
			string,
			ReadonlyMap<OperationMember, LinkedCollectionOperationProgramV1>
		>,
	});
}

export function isMutationMember(
	member: OperationMember,
): member is MutationMember {
	return member === "create" || member === "update" || member === "delete";
}
