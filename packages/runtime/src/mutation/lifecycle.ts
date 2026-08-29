import { createHash } from "node:crypto";

import { canonicalMutationBytes } from "./canonical";
import type { CollectionExecutionBudget } from "./collection-budget";
import { interpretCollectionLifecyclePhase } from "./lifecycle-interpreter";

type RecordValue = Readonly<Record<string, unknown>>;
type Phase = "normalize" | "validate" | "check" | "afterWrite";

export interface LinkedCollectionLifecycleProgramV1 {
	readonly format: "questpie.lifecycle-program.v1";
	readonly interpreter: "questpie.lifecycle-interpreter.v1";
	readonly runtimeBuild: string;
	readonly reentryLimit: number;
	readonly bindings: Readonly<{
		schema: string;
		collection: string;
		fields: Readonly<Record<string, string>>;
		issues: Readonly<Record<string, string>>;
		capabilities: Readonly<
			Record<
				string,
				Readonly<{
					kind: "read";
					identity: string;
					argumentKeys: readonly string[];
					cardinality: "one" | "many";
					first: boolean;
					maxRows: number;
				}>
			>
		>;
		operations: readonly string[];
		jobs: readonly never[];
	}>;
	readonly phases: Readonly<Record<Phase, readonly RecordValue[]>>;
	readonly digest: string;
}

const digestPattern = /^[0-9a-f]{64}$/;
const issuedLifecycleIssues = new WeakMap<Error, string>();

function lifecycleDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

class CollectionLifecycleIssue extends Error {
	constructor(identity: string) {
		super("Collection lifecycle issue");
		this.name = "CollectionLifecycleIssue";
		issuedLifecycleIssues.set(this, identity);
	}
}

export function isCollectionLifecycleIssue(
	value: unknown,
): value is CollectionLifecycleIssue {
	return value instanceof Error && issuedLifecycleIssues.has(value);
}

export function collectionLifecycleIssueIdentity(
	value: unknown,
): string | null {
	return value instanceof Error
		? (issuedLifecycleIssues.get(value) ?? null)
		: null;
}

export interface CollectionLifecycleDoom {
	capture(error: unknown): void;
	throwIfDoomed(): void;
}

function issueIdentitiesInStatements(
	statements: readonly RecordValue[],
): readonly string[] {
	return statements.flatMap((statement) =>
		statement.op === "throwIssue" && typeof statement.issue === "string"
			? [statement.issue]
			: statement.op === "if"
				? [
						...issueIdentitiesInStatements(
							statement.consequent as readonly RecordValue[],
						),
						...issueIdentitiesInStatements(
							statement.otherwise as readonly RecordValue[],
						),
					]
				: [],
	);
}

export function collectionLifecycleProgramIssueIdentities(
	program: LinkedCollectionLifecycleProgramV1,
): readonly string[] {
	return [
		...new Set(
			Object.values(program.phases).flatMap(issueIdentitiesInStatements),
		),
	].sort();
}

export function collectionLifecycleProgramAdmitted(
	program: LinkedCollectionLifecycleProgramV1 | null,
	mappings:
		| Readonly<Record<string, Readonly<Record<string, string>>>>
		| undefined,
): boolean {
	return (
		!program ||
		collectionLifecycleProgramIssueIdentities(program).every(
			(issue) => mappings?.[program.bindings.collection]?.[issue] !== undefined,
		)
	);
}

export function createCollectionLifecycleDoom(): CollectionLifecycleDoom {
	let hasFailure = false;
	let firstFailure: unknown;
	return Object.freeze({
		capture(error: unknown) {
			if (!hasFailure) {
				hasFailure = true;
				firstFailure = error;
			}
		},
		throwIfDoomed() {
			if (hasFailure) throw firstFailure;
		},
	});
}

export async function captureCollectionLifecycleFailure<T>(
	doom: CollectionLifecycleDoom | undefined,
	use: () => Promise<T>,
): Promise<T> {
	try {
		return await use();
	} catch (error) {
		doom?.capture(error);
		throw error;
	}
}

function fail(message: string): never {
	throw new TypeError(`Invalid Collection lifecycle program: ${message}`);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
}

function exact(value: RecordValue, keys: readonly string[], label: string) {
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
		(pattern && !pattern.test(value))
	)
		fail(`${label} is invalid`);
	return value;
}

function identity(value: unknown, label: string, prefix: string): string {
	const result = text(value, label);
	if (!result.startsWith(`${prefix}:`) || result.length === prefix.length + 1)
		fail(`${label} is invalid`);
	return result;
}

function decodeExpression(value: unknown, label: string): RecordValue {
	const expression = record(value, label);
	const op = text(expression.op, `${label} op`);
	if (op === "literal") {
		exact(expression, ["op", "value"], label);
		if (
			expression.value !== null &&
			typeof expression.value !== "boolean" &&
			typeof expression.value !== "string" &&
			(typeof expression.value !== "number" ||
				!Number.isFinite(expression.value) ||
				Object.is(expression.value, -0))
		)
			fail(`${label} literal is invalid`);
		return expression;
	}
	if (op === "root") {
		exact(expression, ["op", "root"], label);
		if (
			![
				"input",
				"candidate",
				"current",
				"written",
				"previous",
				"now",
				"callId",
			].includes(String(expression.root))
		)
			fail(`${label} root is invalid`);
		return expression;
	}
	if (op === "local") {
		exact(expression, ["op", "slot"], label);
		if (!Number.isSafeInteger(expression.slot) || Number(expression.slot) < 0)
			fail(`${label} slot is invalid`);
		return expression;
	}
	if (op === "optionalBoundary") {
		exact(expression, ["op", "value"], label);
		decodeExpression(expression.value, `${label} value`);
		return expression;
	}
	if (op === "member") {
		exact(expression, ["op", "target", "field", "optional"], label);
		identity(expression.field, `${label} field`, "collection");
		if (typeof expression.optional !== "boolean")
			fail(`${label} optional is invalid`);
		decodeExpression(expression.target, `${label} target`);
		return expression;
	}
	if (op === "unary") {
		exact(expression, ["op", "operator", "value"], label);
		if (expression.operator !== "!" && expression.operator !== "-")
			fail(`${label} operator is invalid`);
		decodeExpression(expression.value, `${label} value`);
		return expression;
	}
	if (op === "binary") {
		exact(expression, ["op", "operator", "left", "right"], label);
		if (
			![
				"+",
				"-",
				"*",
				"/",
				"%",
				"===",
				"!==",
				"<",
				"<=",
				">",
				">=",
				"&&",
				"||",
				"??",
			].includes(String(expression.operator))
		)
			fail(`${label} operator is invalid`);
		decodeExpression(expression.left, `${label} left`);
		decodeExpression(expression.right, `${label} right`);
		return expression;
	}
	if (op === "conditional") {
		exact(expression, ["op", "test", "yes", "no"], label);
		decodeExpression(expression.test, `${label} test`);
		decodeExpression(expression.yes, `${label} yes`);
		decodeExpression(expression.no, `${label} no`);
		return expression;
	}
	if (op === "array") {
		exact(expression, ["op", "values"], label);
		array(expression.values, `${label} values`).forEach((member, index) =>
			decodeExpression(member, `${label} value ${index}`),
		);
		return expression;
	}
	if (op === "object") {
		exact(expression, ["op", "entries"], label);
		array(expression.entries, `${label} entries`).forEach((member, index) => {
			const entry = record(member, `${label} entry ${index}`);
			if (entry.kind === "spreadInput")
				exact(entry, ["kind"], `${label} entry ${index}`);
			else if (entry.kind === "argument") {
				exact(entry, ["kind", "key", "value"], `${label} entry ${index}`);
				text(entry.key, `${label} entry ${index} key`);
				decodeExpression(entry.value, `${label} entry ${index} value`);
			} else {
				exact(entry, ["kind", "field", "value"], `${label} entry ${index}`);
				if (entry.kind !== "field") fail(`${label} entry kind is invalid`);
				identity(entry.field, `${label} entry field`, "collection");
				decodeExpression(entry.value, `${label} entry value`);
			}
		});
		return expression;
	}
	if (op === "capability") {
		exact(expression, ["op", "capability", "identity", "arguments"], label);
		if (expression.capability !== "read" && expression.capability !== "write")
			fail(`${label} capability is invalid`);
		identity(
			expression.identity,
			`${label} identity`,
			expression.capability === "read" ? "query" : "mutation",
		);
		array(expression.arguments, `${label} arguments`).forEach((member, index) =>
			decodeExpression(member, `${label} argument ${index}`),
		);
		return expression;
	}
	if (op === "template") {
		exact(expression, ["op", "head", "spans"], label);
		if (typeof expression.head !== "string") fail(`${label} head is invalid`);
		array(expression.spans, `${label} spans`).forEach((member, index) => {
			const span = record(member, `${label} span ${index}`);
			exact(span, ["value", "tail"], `${label} span ${index}`);
			if (typeof span.tail !== "string") fail(`${label} tail is invalid`);
			decodeExpression(span.value, `${label} span value`);
		});
		return expression;
	}
	if (op === "stringMethod") {
		exact(
			expression,
			["op", "method", "target", "arguments", "optional"],
			label,
		);
		if (
			![
				"trim",
				"toUpperCase",
				"toLowerCase",
				"startsWith",
				"endsWith",
				"includes",
			].includes(String(expression.method)) ||
			typeof expression.optional !== "boolean"
		)
			fail(`${label} string method is invalid`);
		decodeExpression(expression.target, `${label} target`);
		array(expression.arguments, `${label} arguments`).forEach((member, index) =>
			decodeExpression(member, `${label} argument ${index}`),
		);
		return expression;
	}
	return fail(`${label} op is invalid`);
}

function decodeStatements(
	value: unknown,
	label: string,
): readonly RecordValue[] {
	return Object.freeze(
		array(value, label).map((member, index) => {
			const statementLabel = `${label} statement ${index}`;
			const statement = record(member, statementLabel);
			if (statement.op === "const") {
				exact(statement, ["op", "slot", "value"], statementLabel);
				if (!Number.isSafeInteger(statement.slot) || Number(statement.slot) < 0)
					fail(`${statementLabel} slot is invalid`);
				decodeExpression(statement.value, `${statementLabel} value`);
			} else if (statement.op === "if") {
				exact(
					statement,
					["op", "test", "consequent", "otherwise"],
					statementLabel,
				);
				decodeExpression(statement.test, `${statementLabel} test`);
				decodeStatements(statement.consequent, `${statementLabel} consequent`);
				decodeStatements(statement.otherwise, `${statementLabel} otherwise`);
			} else if (statement.op === "return") {
				exact(statement, ["op", "value"], statementLabel);
				if (statement.value !== null)
					decodeExpression(statement.value, `${statementLabel} value`);
			} else if (statement.op === "throwIssue") {
				exact(statement, ["op", "issue"], statementLabel);
				identity(statement.issue, `${statementLabel} issue`, "issue");
			} else fail(`${statementLabel} op is invalid`);
			return statement;
		}),
	);
}

function decodeBindings(value: unknown, label: string) {
	const bindings = record(value, label);
	exact(
		bindings,
		[
			"schema",
			"collection",
			"fields",
			"issues",
			"capabilities",
			"operations",
			"jobs",
		],
		label,
	);
	const schema = identity(bindings.schema, `${label} schema`, "schema");
	const collection = identity(
		bindings.collection,
		`${label} collection`,
		"collection",
	);
	const fields = record(bindings.fields, `${label} fields`);
	for (const [name, field] of Object.entries(fields)) {
		if (!name) fail(`${label} Field name is invalid`);
		const fieldIdentity = identity(field, `${label} Field`, "collection");
		if (!fieldIdentity.includes("/field:"))
			fail(`${label} Field owner is invalid`);
	}
	const issues = record(bindings.issues, `${label} issues`);
	for (const [name, issue] of Object.entries(issues)) {
		if (!name) fail(`${label} issue name is invalid`);
		identity(issue, `${label} issue`, "issue");
	}
	const capabilities = Object.freeze(
		Object.fromEntries(
			Object.entries(
				record(bindings.capabilities, `${label} capabilities`),
			).map(([name, rawCapability]) => {
				if (!name) fail(`${label} capability name is invalid`);
				const capability = record(rawCapability, `${label} capability ${name}`);
				if (capability.kind !== "read")
					fail(`${label} capability is unavailable before LIFE-05`);
				exact(
					capability,
					[
						"kind",
						"identity",
						"argumentKeys",
						"cardinality",
						"first",
						"maxRows",
					],
					`${label} capability ${name}`,
				);
				const capabilityIdentity = identity(
					capability.identity,
					`${label} capability ${name} identity`,
					"query",
				);
				const argumentKeys = array(
					capability.argumentKeys,
					`${label} capability ${name} argument keys`,
				).map((key) => text(key, `${label} capability ${name} argument key`));
				if (
					new Set(argumentKeys).size !== argumentKeys.length ||
					argumentKeys.some(
						(key, index) => key !== [...argumentKeys].sort()[index],
					)
				)
					fail(`${label} capability ${name} argument keys are invalid`);
				if (
					capability.cardinality !== "one" ||
					capability.first !== true ||
					capability.maxRows !== 1
				)
					fail(`${label} capability ${name} read bound is invalid`);
				return [
					name,
					Object.freeze({
						kind: "read" as const,
						identity: capabilityIdentity,
						argumentKeys: Object.freeze(argumentKeys),
						cardinality: "one" as const,
						first: true,
						maxRows: 1,
					}),
				] as const;
			}),
		),
	);
	const operations = array(bindings.operations, `${label} operations`).map(
		(operation) => {
			const value = text(operation, `${label} Operation`);
			if (!value.startsWith("mutation:") && !value.startsWith("query:"))
				fail(`${label} Operation is invalid`);
			return value;
		},
	);
	if (new Set(operations).size !== operations.length)
		fail(`${label} Operations must be unique`);
	if (array(bindings.jobs, `${label} jobs`).length)
		fail(`${label} Jobs are unavailable in LIFE-01`);
	return Object.freeze({
		schema,
		collection,
		fields: Object.freeze({ ...fields }) as Readonly<Record<string, string>>,
		issues: Object.freeze({ ...issues }) as Readonly<Record<string, string>>,
		capabilities,
		operations: Object.freeze(operations),
		jobs: Object.freeze([]) as readonly never[],
	});
}

function hasCapability(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(hasCapability);
	if (!value || typeof value !== "object") return false;
	const entry = value as RecordValue;
	return entry.op === "capability" || Object.values(entry).some(hasCapability);
}

function structuralArgumentKeys(
	value: unknown,
	prefix = "",
): readonly string[] {
	const expression = value as RecordValue;
	if (expression.op !== "object") return [];
	return (expression.entries as readonly RecordValue[]).flatMap((entry) => {
		if (entry.kind !== "argument") return [];
		const path = `${prefix}${String(entry.key)}`;
		const nested = structuralArgumentKeys(entry.value, `${path}.`);
		return nested.length === 0 ? [path] : nested;
	});
}

function validateCheckCapabilities(
	phases: Readonly<Record<Phase, readonly RecordValue[]>>,
	bindings: ReturnType<typeof decodeBindings>,
	label: string,
): void {
	if (
		hasCapability(phases.normalize) ||
		hasCapability(phases.validate) ||
		hasCapability(phases.afterWrite)
	)
		fail(`${label} capability is not admitted in this phase`);
	const invoked = new Set<string>();
	const visit = (statements: readonly RecordValue[]) => {
		for (const statement of statements) {
			if (statement.op === "if") {
				visit(statement.consequent as readonly RecordValue[]);
				visit(statement.otherwise as readonly RecordValue[]);
				continue;
			}
			if (statement.op === "const") {
				const value = statement.value as RecordValue;
				if (value.op !== "capability") continue;
				if (value.capability !== "read")
					fail(`${label} check capability is invalid`);
				const binding = Object.values(bindings.capabilities).find(
					(candidate) => candidate.identity === value.identity,
				);
				if (!binding || !bindings.operations.includes(binding.identity))
					fail(`${label} check capability is unbound`);
				const args = value.arguments as readonly unknown[];
				const keys = args.length === 1 ? structuralArgumentKeys(args[0]) : [];
				if (
					keys.length !== binding.argumentKeys.length ||
					keys.some((key, index) => key !== binding.argumentKeys[index])
				)
					fail(`${label} check capability arguments are invalid`);
				invoked.add(binding.identity);
				continue;
			}
			if (hasCapability(statement))
				fail(`${label} capability must be a top-level const read`);
		}
	};
	visit(phases.check);
	for (const binding of Object.values(bindings.capabilities))
		if (!invoked.has(binding.identity))
			fail(`${label} capability binding is unused`);
}

export function decodeCollectionLifecyclePrograms(
	value: unknown,
	expectedRuntimeBuild: string,
): readonly LinkedCollectionLifecycleProgramV1[] {
	text(expectedRuntimeBuild, "expected Runtime Build", digestPattern);
	const envelope = record(value, "lifecycle programs");
	exact(envelope, ["format", "version", "programs"], "lifecycle programs");
	if (
		envelope.format !== "questpie.collection-lifecycle-programs" ||
		envelope.version !== 1
	)
		fail("program envelope is invalid");
	return Object.freeze(
		array(envelope.programs, "lifecycle programs").map((member, index) => {
			const label = `lifecycle program ${index}`;
			const program = record(member, label);
			exact(
				program,
				[
					"format",
					"interpreter",
					"runtimeBuild",
					"reentryLimit",
					"bindings",
					"phases",
					"digest",
				],
				label,
			);
			if (
				program.format !== "questpie.lifecycle-program.v1" ||
				program.interpreter !== "questpie.lifecycle-interpreter.v1" ||
				program.runtimeBuild !== expectedRuntimeBuild ||
				!Number.isSafeInteger(program.reentryLimit) ||
				Number(program.reentryLimit) < 1 ||
				Number(program.reentryLimit) > 1024
			)
				fail(`${label} header or Runtime Build is invalid`);
			const phases = record(program.phases, `${label} phases`);
			exact(
				phases,
				["normalize", "validate", "check", "afterWrite"],
				`${label} phases`,
			);
			const decodedPhases = Object.freeze({
				normalize: decodeStatements(phases.normalize, `${label} normalize`),
				validate: decodeStatements(phases.validate, `${label} validate`),
				check: decodeStatements(phases.check, `${label} check`),
				afterWrite: decodeStatements(phases.afterWrite, `${label} afterWrite`),
			});
			if (decodedPhases.afterWrite.length)
				fail(`${label} uses a phase unavailable before LIFE-05`);
			const decodedBindings = decodeBindings(
				program.bindings,
				`${label} bindings`,
			);
			validateCheckCapabilities(decodedPhases, decodedBindings, label);
			const contract = {
				format: program.format,
				interpreter: program.interpreter,
				runtimeBuild: program.runtimeBuild,
				reentryLimit: program.reentryLimit,
				bindings: program.bindings,
				phases: program.phases,
			};
			const programDigest = text(
				program.digest,
				`${label} digest`,
				digestPattern,
			);
			if (
				lifecycleDigest(
					"questpie.collection-lifecycle-program.v1",
					contract,
				) !== programDigest
			)
				fail(`${label} digest does not match`);
			return Object.freeze({
				...contract,
				bindings: decodedBindings,
				phases: decodedPhases,
				digest: programDigest,
			}) as LinkedCollectionLifecycleProgramV1;
		}),
	);
}

export function executeCollectionLifecyclePhase(
	program: LinkedCollectionLifecycleProgramV1,
	phase: "normalize" | "validate" | "check",
	roots: Readonly<Record<string, unknown>>,
	capabilities: Readonly<
		Record<string, (argument: unknown) => unknown | Promise<unknown>>
	> = {},
	budget?: CollectionExecutionBudget,
): Promise<unknown> {
	const leave = budget?.enterLifecycle(program.reentryLimit);
	return interpretCollectionLifecyclePhase(
		program,
		phase,
		roots,
		capabilities,
		(identity) => {
			throw new CollectionLifecycleIssue(identity);
		},
		budget,
	).finally(leave);
}
export async function normalizeCollectionLifecycleLanes(
	program: LinkedCollectionLifecycleProgramV1,
	callerInput: RecordValue,
	trustedValues: RecordValue | undefined,
	budget?: CollectionExecutionBudget,
	doom?: CollectionLifecycleDoom,
): Promise<
	Readonly<{
		callerInput: RecordValue;
		trustedValues: RecordValue | undefined;
	}>
> {
	const normalize = (value: RecordValue, label: string) =>
		captureCollectionLifecycleFailure(doom, async () => {
			const normalized = await executeCollectionLifecyclePhase(
				program,
				"normalize",
				{ input: value },
				{},
				budget,
			);
			if (
				!normalized ||
				typeof normalized !== "object" ||
				Array.isArray(normalized)
			)
				throw new TypeError(`${label} must be an object`);
			return normalized as RecordValue;
		});
	return Object.freeze({
		callerInput: await normalize(
			callerInput,
			"normalized Collection caller lane",
		),
		trustedValues: trustedValues
			? await normalize(trustedValues, "normalized Collection trusted lane")
			: undefined,
	});
}

export function validateCollectionCreateCandidate(
	program: LinkedCollectionLifecycleProgramV1,
	candidate: RecordValue,
	now: Date,
): Promise<unknown> {
	return executeCollectionLifecyclePhase(program, "validate", {
		candidate,
		current: null,
		now,
	});
}
