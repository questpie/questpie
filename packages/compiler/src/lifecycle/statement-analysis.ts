import type { LifecycleIdentity, LifecycleStatement } from "./contract";

export type InvokedLifecycleCapability = Readonly<{
	identity: LifecycleIdentity;
	argumentKeys: readonly string[];
}>;

function argumentKeys(
	value: Extract<
		LifecycleStatement,
		{ op: "effect" }
	>["value"]["arguments"][number],
	prefix = "",
): readonly string[] {
	if (value.op !== "object") return [];
	return value.entries.flatMap((entry) => {
		if (entry.kind !== "argument") return [];
		const path = `${prefix}${entry.key}`;
		const nested = argumentKeys(entry.value, `${path}.`);
		return nested.length === 0 ? [path] : nested;
	});
}

export type LifecycleStatementAnalysis = Readonly<{
	issues: readonly LifecycleIdentity[];
	capabilities: readonly InvokedLifecycleCapability[];
}>;

function analyzeSequence(
	statements: readonly LifecycleStatement[],
): LifecycleStatementAnalysis & Readonly<{ fallsThrough: boolean }> {
	const issues: LifecycleIdentity[] = [];
	const capabilities: InvokedLifecycleCapability[] = [];
	for (const statement of statements) {
		if (statement.op === "throwIssue") {
			issues.push(statement.issue);
			return { issues, capabilities, fallsThrough: false };
		}
		if (statement.op === "return")
			return { issues, capabilities, fallsThrough: false };
		if (statement.op === "effect") {
			capabilities.push({
				identity: statement.value.identity,
				argumentKeys: statement.value.arguments.flatMap((argument) =>
					argumentKeys(argument),
				),
			});
			continue;
		}
		if (statement.op !== "if") continue;
		const test = statement.test;
		const branches =
			test.op === "literal" && typeof test.value === "boolean"
				? [test.value ? statement.consequent : statement.otherwise]
				: [statement.consequent, statement.otherwise];
		let branchFallsThrough = false;
		for (const branch of branches) {
			const analyzed = analyzeSequence(branch);
			issues.push(...analyzed.issues);
			capabilities.push(...analyzed.capabilities);
			branchFallsThrough ||= analyzed.fallsThrough;
		}
		if (!branchFallsThrough)
			return { issues, capabilities, fallsThrough: false };
	}
	return { issues, capabilities, fallsThrough: true };
}

export function analyzeLifecycleStatements(
	statements: readonly LifecycleStatement[],
): LifecycleStatementAnalysis {
	const { issues, capabilities } = analyzeSequence(statements);
	return Object.freeze({
		issues: Object.freeze(issues),
		capabilities: Object.freeze(capabilities),
	});
}
