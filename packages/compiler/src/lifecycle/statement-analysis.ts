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
	statements: readonly LifecycleStatement[];
	issues: readonly LifecycleIdentity[];
	issueStatements: readonly Extract<LifecycleStatement, { op: "throwIssue" }>[];
	capabilities: readonly InvokedLifecycleCapability[];
}>;

function analyzeSequence(
	statements: readonly LifecycleStatement[],
): LifecycleStatementAnalysis & Readonly<{ fallsThrough: boolean }> {
	const issues: LifecycleIdentity[] = [];
	const issueStatements: Extract<LifecycleStatement, { op: "throwIssue" }>[] =
		[];
	const capabilities: InvokedLifecycleCapability[] = [];
	const reachableStatements: LifecycleStatement[] = [];
	for (const statement of statements) {
		if (statement.op === "throwIssue") {
			issues.push(statement.issue);
			issueStatements.push(statement);
			reachableStatements.push(statement);
			return {
				statements: reachableStatements,
				issues,
				issueStatements,
				capabilities,
				fallsThrough: false,
			};
		}
		if (statement.op === "return") {
			reachableStatements.push(statement);
			return {
				statements: reachableStatements,
				issues,
				issueStatements,
				capabilities,
				fallsThrough: false,
			};
		}
		if (statement.op === "effect") {
			reachableStatements.push(statement);
			capabilities.push({
				identity: statement.value.identity,
				argumentKeys: statement.value.arguments.flatMap((argument) =>
					argumentKeys(argument),
				),
			});
			continue;
		}
		if (statement.op === "const" && statement.value.op === "capability") {
			reachableStatements.push(statement);
			capabilities.push({
				identity: statement.value.identity,
				argumentKeys: statement.value.arguments.flatMap((argument) =>
					argumentKeys(argument),
				),
			});
			continue;
		}
		if (statement.op !== "if") {
			if (statement.op === "forOf") {
				const analyzed = analyzeSequence(statement.body);
				issues.push(...analyzed.issues);
				issueStatements.push(...analyzed.issueStatements);
				capabilities.push(...analyzed.capabilities);
				reachableStatements.push({
					...statement,
					body: Object.freeze(analyzed.statements),
				});
				continue;
			}
			reachableStatements.push(statement);
			continue;
		}
		const test = statement.test;
		const literalBranch =
			test.op === "literal" && typeof test.value === "boolean"
				? test.value
					? "consequent"
					: "otherwise"
				: null;
		const branches = [
			...(literalBranch === "otherwise" ? [] : [statement.consequent]),
			...(literalBranch === "consequent" ? [] : [statement.otherwise]),
		];
		const analyzedBranches = branches.map(analyzeSequence);
		let branchFallsThrough = false;
		for (const analyzed of analyzedBranches) {
			issues.push(...analyzed.issues);
			issueStatements.push(...analyzed.issueStatements);
			capabilities.push(...analyzed.capabilities);
			branchFallsThrough ||= analyzed.fallsThrough;
		}
		const consequent =
			literalBranch === "otherwise"
				? []
				: (analyzedBranches[0]?.statements ?? []);
		const otherwise =
			literalBranch === "consequent"
				? []
				: (analyzedBranches[literalBranch === "otherwise" ? 0 : 1]
						?.statements ?? []);
		reachableStatements.push({
			...statement,
			consequent: Object.freeze(consequent),
			otherwise: Object.freeze(otherwise),
		});
		if (!branchFallsThrough)
			return {
				statements: reachableStatements,
				issues,
				issueStatements,
				capabilities,
				fallsThrough: false,
			};
	}
	return {
		statements: reachableStatements,
		issues,
		issueStatements,
		capabilities,
		fallsThrough: true,
	};
}

export function analyzeLifecycleStatements(
	statements: readonly LifecycleStatement[],
): LifecycleStatementAnalysis {
	const {
		statements: reachableStatements,
		issues,
		issueStatements,
		capabilities,
	} = analyzeSequence(statements);
	return Object.freeze({
		statements: Object.freeze(reachableStatements),
		issues: Object.freeze(issues),
		issueStatements: Object.freeze(issueStatements),
		capabilities: Object.freeze(capabilities),
	});
}
