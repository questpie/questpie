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

type AdapterInvoker = (
	kernelIdentity: string,
	request: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

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

function exactWithOptional(
	value: Row,
	required: readonly string[],
	optional: readonly string[],
	label: string,
): void {
	const keys = Object.keys(value);
	if (
		required.some((key) => !Object.hasOwn(value, key)) ||
		keys.some((key) => !required.includes(key) && !optional.includes(key))
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

function pathKey(path: FieldPath): string {
	return JSON.stringify(path);
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
			const expectedRequired = kernel.requiredCallerInputFields.filter((path) =>
				callerInputFields.some(
					(candidate) => pathKey(candidate) === pathKey(path),
				),
			);
			if (!samePaths(requiredCallerInputFields, expectedRequired))
				fail(`${label} required input Fields differ from its kernel`);
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

function hasValueAt(value: Row, path: FieldPath): boolean {
	let current: unknown = value;
	for (const part of path) {
		if (!current || typeof current !== "object" || Array.isArray(current))
			return false;
		if (!Object.hasOwn(current, part)) return false;
		current = (current as Row)[part];
	}
	return true;
}

function valueAt(value: Row, path: FieldPath): unknown {
	let current: unknown = value;
	for (const part of path) current = record(current, "adapter value")[part];
	return current;
}

function setPath(
	target: Record<string, unknown>,
	path: FieldPath,
	value: unknown,
) {
	let current = target;
	for (const part of path.slice(0, -1)) {
		const child = current[part];
		if (!child || typeof child !== "object" || Array.isArray(child))
			current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[path.at(-1)!] = value;
}

function suppliedPaths(
	value: unknown,
	label: string,
	physicalPaths: readonly FieldPath[],
	prefix: string[] = [],
): FieldPath[] {
	const source = record(value, label);
	if (
		prefix.length > 0 &&
		physicalPaths.some((path) => pathKey(path) === pathKey(prefix))
	)
		return [prefix];
	const result: FieldPath[] = [];
	for (const key of Object.keys(source).toSorted()) {
		const path = [...prefix, key];
		const child = source[key];
		if (
			child &&
			typeof child === "object" &&
			!Array.isArray(child) &&
			!(child instanceof Date)
		)
			result.push(...suppliedPaths(child, label, physicalPaths, path));
		else result.push(path);
	}
	return result;
}

function validatePinnedInput(
	value: unknown,
	adapter: LinkedCollectionOperationAdapterV1,
) {
	const input = record(value, "adapter input");
	const supplied = suppliedPaths(
		input,
		"adapter input",
		adapter.callerInputFields,
	);
	const allowed = new Set(adapter.callerInputFields.map(pathKey));
	if (supplied.some((path) => !allowed.has(pathKey(path))))
		fail("adapter input contains undeclared Fields");
	const present = new Set(supplied.map(pathKey));
	if (
		adapter.requiredCallerInputFields.some(
			(path) => !present.has(pathKey(path)),
		)
	)
		fail("adapter input is missing required Fields");
	return input;
}

function normalizedInput(
	input: Row,
	program: FieldNormalizerProgramV1 | null,
): Row {
	const output = structuredClone(input) as Record<string, unknown>;
	for (const step of program?.steps ?? []) {
		if (
			step.expression.kind === "trimIfPresent" &&
			!hasValueAt(input, step.expression.source)
		)
			continue;
		const value = valueAt(input, step.expression.source);
		if (typeof value !== "string") fail("normalizer source must be a string");
		setPath(output, step.target, value.trim());
	}
	return Object.freeze(output);
}

function trustedValues(
	input: Row,
	program: ServerValueProgramV1 | null,
	facts: CollectionOperationAdapterFacts,
): Row | undefined {
	if (!program) return undefined;
	const values: Record<string, unknown> = {};
	for (const assignment of program.assignments) {
		const source = pathKey(assignment.source);
		const value =
			source === '["operationTime"]'
				? facts.operationTime
				: source === '["principal","id"]'
					? facts.principal.id
					: source === '["principal","kind"]'
						? facts.principal.kind
						: source === '["tenant","id"]'
							? facts.tenant.id
							: valueAt(input, assignment.source);
		setPath(values, assignment.target, value);
	}
	return Object.freeze(values);
}

function projectedResult(
	value: unknown,
	adapter: LinkedCollectionOperationAdapterV1,
): unknown {
	if (value === null && adapter.outputCardinality === "optionalOne")
		return null;
	const source = record(value, "adapter kernel result");
	const result: Record<string, unknown> = {};
	for (const path of adapter.selectedFieldPaths) {
		if (!hasValueAt(source, path))
			fail("kernel result is missing a selected Field");
		setPath(result, path, valueAt(source, path));
	}
	return Object.freeze(result);
}

export function createCollectionOperationAdapterExecutor(
	input: Readonly<{
		adapters: LinkedCollectionOperationAdaptersV1;
		facts: CollectionOperationAdapterFacts;
		invokeKernel: AdapterInvoker;
	}>,
) {
	return async (identity: string, rawRequest: unknown): Promise<unknown> => {
		const adapter = input.adapters.byIdentity.get(identity);
		if (!adapter) fail(`unknown adapter ${identity}`);
		const request = record(rawRequest, `${identity} request`);
		if (adapter.member === "create")
			exact(request, ["input"], `${identity} request`);
		else exactWithOptional(request, ["key"], ["patch"], `${identity} request`);
		const caller = validatePinnedInput(
			adapter.member === "create"
				? request.input
				: Object.hasOwn(request, "patch")
					? request.patch
					: {},
			adapter,
		);
		const normalized = normalizedInput(caller, adapter.normalizerProgram);
		const values = trustedValues(
			normalized,
			adapter.serverValueProgram,
			input.facts,
		);
		const kernelRequest =
			adapter.member === "create"
				? { input: normalized, ...(values ? { values } : {}) }
				: {
						key: request.key,
						patch: normalized,
						...(values ? { values } : {}),
					};
		return projectedResult(
			await input.invokeKernel(adapter.kernelIdentity, kernelRequest),
			adapter,
		);
	};
}
