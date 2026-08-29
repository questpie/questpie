import type { CollectionExecutionBudget } from "./collection-budget";
import type { LinkedCollectionLifecycleProgramV1 } from "./lifecycle";

const optionalAbsence = Symbol("questpie.lifecycle.optional-absence");
const returned = Symbol("questpie.lifecycle.returned");

type RecordValue = Readonly<Record<string, unknown>>;

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

export async function interpretCollectionLifecyclePhase(
	program: LinkedCollectionLifecycleProgramV1,
	phase: "normalize" | "validate" | "check",
	roots: Readonly<Record<string, unknown>>,
	capabilities: Readonly<
		Record<string, (argument: unknown) => unknown | Promise<unknown>>
	>,
	raiseIssue: (identity: string) => never,
	budget?: CollectionExecutionBudget,
): Promise<unknown> {
	budget?.assertAvailable();
	const fieldNames = new Map(
		Object.values(program.bindings.fields).map((id) => [
			id,
			id
				.slice(id.indexOf("/field:") + "/field:".length)
				.split("/")
				.at(-1)!,
		]),
	);
	const locals = new Map<number, unknown>();
	const safeRoots = closed(roots) as RecordValue;
	if (phase === "normalize" && program.phases.normalize.length === 0)
		return safeRoots.input;
	const evaluate = (raw: unknown): unknown => {
		budget?.assertAvailable();
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
				else if (entry.kind === "argument")
					output[String(entry.key)] = evaluate(entry.value);
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
	const run = async (statements: readonly RecordValue[]): Promise<unknown> => {
		for (const statement of statements) {
			budget?.assertAvailable();
			if (statement.op === "const") {
				const value = statement.value as RecordValue;
				if (value.op === "capability") {
					budget?.consumeDependency();
					const binding = Object.values(program.bindings.capabilities).find(
						(candidate) => candidate.identity === value.identity,
					);
					const invoke = capabilities[String(value.identity)];
					if (!binding || !invoke)
						throw new TypeError("Lifecycle capability is withheld");
					const args = value.arguments as readonly unknown[];
					const result = closed(await invoke(evaluate(args[0])));
					budget?.assertAvailable();
					if (
						result !== null &&
						(!result || typeof result !== "object" || Array.isArray(result))
					)
						throw new TypeError("Lifecycle read cardinality is invalid");
					locals.set(Number(statement.slot), result);
				} else locals.set(Number(statement.slot), evaluate(statement.value));
				continue;
			}
			if (statement.op === "if") {
				const result = await run(
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
			if (statement.op === "throwIssue") raiseIssue(String(statement.issue));
		}
		return undefined;
	};
	const outcome = await run(program.phases[phase]);
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
