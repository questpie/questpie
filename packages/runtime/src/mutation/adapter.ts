import { mutationPathKey as pathKey } from "./field-path";
import {
	decodeFieldNormalizerPrograms,
	decodeServerValuePrograms,
	type FieldNormalizerProgramV1,
	type LinkedCollectionMutationProgramsV1,
	type LinkedCollectionOperationProgramV1,
	mutationProgramDigest,
	type ServerValueProgramV1,
} from "./program";

type Row = Readonly<Record<string, unknown>>;
type FieldPath = readonly string[];
type WriteMember = "create" | "update";

export type LinkedCollectionOperationAdapterV1 = Readonly<{
	identity: string;
	target: string;
	member: WriteMember;
	kernelIdentity: string;
	keyFields: readonly FieldPath[];
	callerInputFields: readonly FieldPath[];
	requiredCallerInputFields: readonly FieldPath[];
	selectedFieldPaths: readonly FieldPath[];
	outputCardinality: "one" | "optionalOne";
	limits: LinkedCollectionOperationProgramV1["limits"];
	kernel: LinkedCollectionOperationProgramV1;
	normalizerProgram: FieldNormalizerProgramV1 | null;
	serverValueProgram: ServerValueProgramV1 | null;
}>;

export type LinkedCollectionOperationAdaptersV1 = Readonly<{
	adapters: readonly LinkedCollectionOperationAdapterV1[];
	byIdentity: ReadonlyMap<string, LinkedCollectionOperationAdapterV1>;
}>;

export type CollectionOperationAdapterFacts = Readonly<{
	operationTime: Date;
	principal: Readonly<{ id: string; kind: string }>;
	tenant: Readonly<{ id: string }>;
}>;

const digestPattern = /^[0-9a-f]{64}$/;

function fail(message: string): never {
	throw new TypeError(`Invalid Collection Operation adapter: ${message}`);
}

function record(value: unknown, label: string): Row {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== null && prototype !== Object.prototype)
		fail(`${label} must be a plain object`);
	return value as Row;
}

function exact(value: Row, keys: readonly string[], label: string): void {
	const actual = Object.keys(value).toSorted();
	const expected = [...keys].toSorted();
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
	const paths = array(value, label).map((candidate, index) =>
		fieldPath(candidate, `${label} ${index}`),
	);
	const identities = paths.map(pathKey);
	if (new Set(identities).size !== identities.length)
		fail(`${label} must be unique`);
	return Object.freeze(paths);
}

function samePaths(left: readonly FieldPath[], right: readonly FieldPath[]) {
	return (
		left.length === right.length &&
		left.every((path, index) => pathKey(path) === pathKey(right[index]!))
	);
}

function subset(
	paths: readonly FieldPath[],
	owner: readonly FieldPath[],
	label: string,
) {
	const allowed = new Set(owner.map(pathKey));
	if (paths.some((path) => !allowed.has(pathKey(path))))
		fail(`${label} contains a Field outside its kernel`);
}

function decodeLimits(value: unknown, label: string) {
	const limits = record(value, label);
	exact(
		limits,
		["inputBytes", "resultBytes", "rowsWritten", "durationMilliseconds"],
		label,
	);
	if (
		limits.inputBytes !== 65_536 ||
		limits.resultBytes !== 1_048_576 ||
		limits.rowsWritten !== 100 ||
		limits.durationMilliseconds !== 5_000
	)
		fail(`${label} is invalid`);
	return Object.freeze({
		inputBytes: 65_536 as const,
		resultBytes: 1_048_576 as const,
		rowsWritten: 100 as const,
		durationMilliseconds: 5_000 as const,
	});
}

function uniqueByDigest<T>(
	programs: readonly T[],
	domain: string,
	label: string,
): ReadonlyMap<string, T> {
	const result = new Map<string, T>();
	for (const program of programs) {
		const digest = mutationProgramDigest(domain, program);
		if (result.has(digest)) fail(`${label} digest is duplicated`);
		result.set(digest, program);
	}
	return result;
}

export function linkCollectionOperationAdapters(
	input: Readonly<{
		artifact: unknown;
		fieldNormalizers: unknown;
		serverValues: unknown;
		kernels: LinkedCollectionMutationProgramsV1;
	}>,
): LinkedCollectionOperationAdaptersV1 {
	const envelope = record(input.artifact, "adapter artifact");
	exact(envelope, ["format", "version", "adapters"], "adapter artifact");
	if (
		envelope.format !== "questpie.collection-operation-adapters" ||
		envelope.version !== 1
	)
		fail("artifact header is invalid");
	const normalizers = decodeFieldNormalizerPrograms(input.fieldNormalizers);
	const serverValues = decodeServerValuePrograms(input.serverValues);
	const normalizersByDigest = uniqueByDigest(
		normalizers,
		"questpie-field-normalizer-program-v1",
		"normalizer",
	);
	const serverValuesByDigest = uniqueByDigest(
		serverValues,
		"questpie-server-value-program-v1",
		"server-value",
	);
	const usedNormalizers = new Set<string>();
	const usedServerValues = new Set<string>();
	const adapters = array(envelope.adapters, "adapter artifact adapters").map(
		(rawAdapter, index): LinkedCollectionOperationAdapterV1 => {
			const label = `adapter ${index}`;
			const source = record(rawAdapter, label);
			exact(
				source,
				[
					"identity",
					"target",
					"member",
					"kernelIdentity",
					"keyFields",
					"callerInputFields",
					"requiredCallerInputFields",
					"selectedFieldPaths",
					"normalizerProgramDigest",
					"serverValueProgramDigest",
					"outputCardinality",
					"limits",
				],
				label,
			);
			const identity = text(source.identity, `${label} identity`);
			const target = text(source.target, `${label} target`);
			const kernelIdentity = text(
				source.kernelIdentity,
				`${label} kernelIdentity`,
			);
			if (
				!identity.startsWith("mutation:") ||
				!target.startsWith("collection:") ||
				(source.member !== "create" && source.member !== "update") ||
				!identity.endsWith(`.${source.member}`)
			)
				fail(`${label} identity, target, or member is invalid`);
			const member = source.member;
			const kernel = input.kernels.byIdentity.get(kernelIdentity);
			if (
				!kernel ||
				kernel.target !== target ||
				kernel.member !== member ||
				!kernel.identity.startsWith("mutation:__collectionKernel.")
			)
				fail(`${label} has an invalid kernel link`);
			const keyFields = fieldPaths(source.keyFields, `${label} keyFields`);
			const callerInputFields = fieldPaths(
				source.callerInputFields,
				`${label} callerInputFields`,
			);
			const requiredCallerInputFields = fieldPaths(
				source.requiredCallerInputFields,
				`${label} requiredCallerInputFields`,
			);
			const selectedFieldPaths = fieldPaths(
				source.selectedFieldPaths,
				`${label} selectedFieldPaths`,
			);
			if (!samePaths(keyFields, kernel.keyFields))
				fail(`${label} key Fields differ from its kernel`);
			subset(callerInputFields, kernel.callerInputFields, `${label} input`);
			subset(
				requiredCallerInputFields,
				callerInputFields,
				`${label} required input`,
			);
			subset(
				selectedFieldPaths,
				kernel.selectedFieldPaths,
				`${label} selection`,
			);
			const normalizerDigest =
				source.normalizerProgramDigest === null
					? null
					: text(
							source.normalizerProgramDigest,
							`${label} normalizerProgramDigest`,
							digestPattern,
						);
			const serverValueDigest =
				source.serverValueProgramDigest === null
					? null
					: text(
							source.serverValueProgramDigest,
							`${label} serverValueProgramDigest`,
							digestPattern,
						);
			const normalizer =
				normalizerDigest === null
					? null
					: normalizersByDigest.get(normalizerDigest);
			const values =
				serverValueDigest === null
					? null
					: serverValuesByDigest.get(serverValueDigest);
			for (const [program, digest, kind] of [
				[normalizer, normalizerDigest, "normalizer"],
				[values, serverValueDigest, "server-value"],
			] as const) {
				if (
					digest !== null &&
					(!program ||
						program.target !== target ||
						program.operation !== member)
				)
					fail(`${label} has an invalid ${kind} link`);
			}
			const caller = new Set(callerInputFields.map(pathKey));
			for (const step of normalizer?.steps ?? [])
				if (
					!caller.has(pathKey(step.target)) ||
					!caller.has(pathKey(step.expression.source))
				)
					fail(`${label} normalizes an undeclared input Field`);
			const trusted = new Set(kernel.trustedValueFields.map(pathKey));
			for (const assignment of values?.assignments ?? []) {
				if (!trusted.has(pathKey(assignment.target)))
					fail(`${label} assigns a Field outside the kernel trusted lane`);
				if (caller.has(pathKey(assignment.target)))
					fail(`${label} caller and trusted Fields overlap`);
				const sourcePath = pathKey(assignment.source);
				if (
					!caller.has(sourcePath) &&
					!new Set([
						'["operationTime"]',
						'["principal","id"]',
						'["principal","kind"]',
						'["tenant","id"]',
					]).has(sourcePath)
				)
					fail(`${label} server value has an invalid source`);
			}
			if (normalizerDigest !== null) usedNormalizers.add(normalizerDigest);
			if (serverValueDigest !== null) usedServerValues.add(serverValueDigest);
			const outputCardinality = source.outputCardinality;
			if (
				(member === "create" && outputCardinality !== "one") ||
				(member === "update" && outputCardinality !== "optionalOne")
			)
				fail(`${label} output cardinality is invalid`);
			const linkedOutputCardinality = outputCardinality as
				| "one"
				| "optionalOne";
			const limits = decodeLimits(source.limits, `${label} limits`);
			return Object.freeze({
				identity,
				target,
				member,
				kernelIdentity,
				keyFields,
				callerInputFields,
				requiredCallerInputFields,
				selectedFieldPaths,
				outputCardinality: linkedOutputCardinality,
				limits,
				kernel,
				normalizerProgram: normalizer ?? null,
				serverValueProgram: values ?? null,
			});
		},
	);
	const identities = adapters.map(({ identity }) => identity);
	if (
		identities.some(
			(identity, index) => identity !== identities.toSorted()[index],
		)
	)
		fail("adapters must be sorted by identity");
	if (new Set(identities).size !== identities.length)
		fail("adapter identity is duplicated");
	if (
		usedNormalizers.size !== normalizersByDigest.size ||
		usedServerValues.size !== serverValuesByDigest.size
	)
		fail("write program must be referenced exactly once");
	return Object.freeze({
		adapters: Object.freeze(adapters),
		byIdentity: new Map(adapters.map((adapter) => [adapter.identity, adapter])),
	});
}
