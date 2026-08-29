import { createHash } from "node:crypto";

import { canonicalMutationBytes } from "./canonical";

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
		capabilities: Readonly<Record<string, never>>;
		operations: readonly string[];
		jobs: readonly never[];
	}>;
	readonly phases: Readonly<Record<Phase, readonly RecordValue[]>>;
	readonly digest: string;
}

const digestPattern = /^[0-9a-f]{64}$/;
const optionalAbsence = Symbol("questpie.lifecycle.optional-absence");
const returned = Symbol("questpie.lifecycle.returned");
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
	let firstIssue: unknown;
	return Object.freeze({
		capture(error: unknown) {
			if (firstIssue === undefined && isCollectionLifecycleIssue(error))
				firstIssue = error;
		},
		throwIfDoomed() {
			if (firstIssue !== undefined) throw firstIssue;
		},
	});
}

export async function captureCollectionLifecycleIssue<T>(
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
			else {
				exact(entry, ["kind", "field", "value"], `${label} entry ${index}`);
				if (entry.kind !== "field") fail(`${label} entry kind is invalid`);
				identity(entry.field, `${label} entry field`, "collection");
				decodeExpression(entry.value, `${label} entry value`);
			}
		});
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
		if (!fieldIdentity.startsWith(`${collection}/field:`))
			fail(`${label} Field owner is invalid`);
	}
	const issues = record(bindings.issues, `${label} issues`);
	for (const [name, issue] of Object.entries(issues)) {
		if (!name) fail(`${label} issue name is invalid`);
		identity(issue, `${label} issue`, "issue");
	}
	if (
		Object.keys(record(bindings.capabilities, `${label} capabilities`)).length
	)
		fail(`${label} capabilities are unavailable in LIFE-01`);
	const operations = array(bindings.operations, `${label} operations`).map(
		(operation) => identity(operation, `${label} Operation`, "mutation"),
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
		capabilities: Object.freeze({}) as Readonly<Record<string, never>>,
		operations: Object.freeze(operations),
		jobs: Object.freeze([]) as readonly never[],
	});
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
			if (decodedPhases.check.length || decodedPhases.afterWrite.length)
				fail(`${label} uses a phase unavailable in LIFE-01`);
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
				bindings: decodeBindings(program.bindings, `${label} bindings`),
				phases: decodedPhases,
				digest: programDigest,
			}) as LinkedCollectionLifecycleProgramV1;
		}),
	);
}

function closed(value: unknown, depth = 0): unknown {
	if (depth > 32) throw new TypeError("Lifecycle value depth exceeded");
	if (value === null || typeof value === "boolean" || typeof value === "string")
		return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0))
			throw new TypeError("Lifecycle number is invalid");
		return value;
	}
	if (value instanceof Date) {
		if (!Number.isFinite(value.getTime()))
			throw new TypeError("Lifecycle timestamp is invalid");
		return new Date(value.getTime());
	}
	if (Array.isArray(value)) {
		if (value.length > 10_000)
			throw new TypeError("Lifecycle array exceeds its bound");
		return Object.freeze(value.map((member) => closed(member, depth + 1)));
	}
	if (
		!value ||
		typeof value !== "object" ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		throw new TypeError("Lifecycle value is not closed");
	return Object.freeze(
		Object.fromEntries(
			Object.entries(value).map(([key, member]) => [
				key,
				closed(member, depth + 1),
			]),
		),
	);
}

function leafPaths(value: unknown, prefix: readonly string[] = []): string[] {
	if (
		value === null ||
		typeof value !== "object" ||
		value instanceof Date ||
		Array.isArray(value)
	)
		return [JSON.stringify(prefix)];
	return Object.entries(value).flatMap(([key, member]) =>
		leafPaths(member, [...prefix, key]),
	);
}

export async function executeCollectionLifecyclePhase(
	program: LinkedCollectionLifecycleProgramV1,
	phase: "normalize" | "validate",
	roots: Readonly<Record<string, unknown>>,
): Promise<unknown> {
	const fieldNames = new Map(
		Object.entries(program.bindings.fields).map(([name, id]) => [id, name]),
	);
	const locals = new Map<number, unknown>();
	const safeRoots = closed(roots) as RecordValue;
	if (phase === "normalize" && program.phases.normalize.length === 0)
		return safeRoots.input;
	const evaluate = (raw: unknown): unknown => {
		const expression = raw as RecordValue;
		if (expression.op === "literal") return expression.value;
		if (expression.op === "root") return safeRoots[String(expression.root)];
		if (expression.op === "local") return locals.get(Number(expression.slot));
		if (expression.op === "optionalBoundary") {
			const value = evaluate(expression.value);
			return value === optionalAbsence ? undefined : value;
		}
		if (expression.op === "member") {
			const target = evaluate(expression.target);
			if (target === optionalAbsence) return optionalAbsence;
			if (target === null || target === undefined) {
				if (expression.optional === true) return optionalAbsence;
				throw new TypeError("Lifecycle member target is absent");
			}
			const name = fieldNames.get(String(expression.field));
			if (!name || typeof target !== "object")
				throw new TypeError("Lifecycle Field binding is invalid");
			return (target as RecordValue)[name];
		}
		if (expression.op === "unary") {
			const value = evaluate(expression.value);
			return expression.operator === "!" ? !value : -Number(value);
		}
		if (expression.op === "binary") {
			const left = evaluate(expression.left);
			if (expression.operator === "&&")
				return left && evaluate(expression.right);
			if (expression.operator === "||")
				return left || evaluate(expression.right);
			if (expression.operator === "??")
				return left ?? evaluate(expression.right);
			const right = evaluate(expression.right);
			switch (expression.operator) {
				case "+":
					return (left as number) + (right as number);
				case "-":
					return Number(left) - Number(right);
				case "*":
					return Number(left) * Number(right);
				case "/":
					return Number(left) / Number(right);
				case "%":
					return Number(left) % Number(right);
				case "===":
					return left === right;
				case "!==":
					return left !== right;
				case "<":
					return (left as number) < (right as number);
				case "<=":
					return (left as number) <= (right as number);
				case ">":
					return (left as number) > (right as number);
				case ">=":
					return (left as number) >= (right as number);
			}
		}
		if (expression.op === "conditional") {
			const test = evaluate(expression.test);
			return test !== optionalAbsence && test
				? evaluate(expression.yes)
				: evaluate(expression.no);
		}
		if (expression.op === "array")
			return Object.freeze(
				(expression.values as readonly unknown[]).map(evaluate),
			);
		if (expression.op === "object") {
			const output: Record<string, unknown> = {};
			for (const rawEntry of expression.entries as readonly unknown[]) {
				const entry = rawEntry as RecordValue;
				if (entry.kind === "spreadInput")
					Object.assign(output, safeRoots.input);
				else {
					const name = fieldNames.get(String(entry.field));
					if (!name) throw new TypeError("Lifecycle Field binding is invalid");
					output[name] = evaluate(entry.value);
				}
			}
			return Object.freeze(output);
		}
		if (expression.op === "template")
			return `${String(expression.head)}${(
				expression.spans as readonly RecordValue[]
			)
				.map((span) => `${String(evaluate(span.value))}${String(span.tail)}`)
				.join("")}`;
		if (expression.op === "stringMethod") {
			const target = evaluate(expression.target);
			if (target === optionalAbsence) return optionalAbsence;
			if (target === null || target === undefined) {
				if (expression.optional === true) return optionalAbsence;
				throw new TypeError("Lifecycle string target is absent");
			}
			if (typeof target !== "string")
				throw new TypeError("Lifecycle string target is invalid");
			const args = (expression.arguments as readonly unknown[]).map(evaluate);
			switch (expression.method) {
				case "trim":
					return target.trim();
				case "toUpperCase":
					return target.toUpperCase();
				case "toLowerCase":
					return target.toLowerCase();
				case "startsWith":
					return target.startsWith(String(args[0]));
				case "endsWith":
					return target.endsWith(String(args[0]));
				case "includes":
					return target.includes(String(args[0]));
			}
		}
		throw new TypeError("Lifecycle expression is invalid");
	};
	const run = (statements: readonly RecordValue[]): unknown => {
		for (const statement of statements) {
			if (statement.op === "const") {
				locals.set(Number(statement.slot), evaluate(statement.value));
				continue;
			}
			if (statement.op === "if") {
				const result = run(
					(evaluate(statement.test)
						? statement.consequent
						: statement.otherwise) as readonly RecordValue[],
				);
				if (Array.isArray(result) && result[0] === returned) return result;
				continue;
			}
			if (statement.op === "return")
				return [
					returned,
					statement.value === null ? undefined : evaluate(statement.value),
				];
			if (statement.op === "throwIssue")
				throw new CollectionLifecycleIssue(String(statement.issue));
		}
		return undefined;
	};
	const outcome = run(program.phases[phase]);
	const value =
		Array.isArray(outcome) && outcome[0] === returned ? outcome[1] : undefined;
	if (value === optionalAbsence)
		throw new TypeError("Lifecycle optional absence cannot escape");
	if (phase === "normalize") {
		const normalized = closed(value);
		const before = leafPaths(safeRoots.input).sort();
		const after = leafPaths(normalized).sort();
		if (
			before.length !== after.length ||
			before.some((path, index) => path !== after[index])
		)
			throw new TypeError("Lifecycle normalize changed supplied Field paths");
		return normalized;
	}
	return value;
}

export async function normalizeCollectionLifecycleLanes(
	program: LinkedCollectionLifecycleProgramV1,
	callerInput: RecordValue,
	trustedValues: RecordValue | undefined,
): Promise<
	Readonly<{
		callerInput: RecordValue;
		trustedValues: RecordValue | undefined;
	}>
> {
	const normalize = async (value: RecordValue, label: string) => {
		const normalized = await executeCollectionLifecyclePhase(
			program,
			"normalize",
			{ input: value },
		);
		if (
			!normalized ||
			typeof normalized !== "object" ||
			Array.isArray(normalized)
		)
			throw new TypeError(`${label} must be an object`);
		return normalized as RecordValue;
	};
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
