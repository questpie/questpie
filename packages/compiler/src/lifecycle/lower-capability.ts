import ts from "typescript";

import type {
	LifecycleBindings,
	LifecycleExpression,
	LifecycleIdentity,
	LifecycleObjectEntry,
	LifecyclePhase,
} from "./contract";

export type LifecycleCapabilityCandidate =
	| Readonly<{
			kind: "read";
			identity: LifecycleIdentity;
			argumentKeys: readonly string[];
			argumentRoots: readonly string[];
			requiredArgumentKeys: readonly string[];
			requiredArgumentRoots: readonly string[];
			requireNonEmptyWriteLane: false;
			requireNonEmptySelect: true;
			cardinality: "one" | "many";
			first: boolean;
			maxRows: number;
			resultFields: Readonly<Record<string, LifecycleIdentity>>;
	  }>
	| Readonly<{
			kind: "write";
			identity: LifecycleIdentity;
			argumentKeys: readonly string[];
			argumentRoots: readonly string[];
			requiredArgumentKeys: readonly string[];
			requiredArgumentRoots: readonly string[];
			requireNonEmptyWriteLane: boolean;
			requireNonEmptySelect: false;
	  }>;

export type LifecycleLoweringBindings = Omit<
	LifecycleBindings,
	"capabilities"
> &
	Readonly<{
		capabilities: Readonly<Record<string, LifecycleCapabilityCandidate>>;
	}>;

type DiagnosticReason =
	| "unsupportedLifecycleSyntax"
	| "lifecycleCapture"
	| "unsupportedLifecycleCapability";

type CapabilityLoweringContext = Readonly<{
	phase: LifecyclePhase;
	bindings: LifecycleLoweringBindings;
	parameters: ReadonlyMap<string, string>;
	capabilityArgumentKeys: Map<LifecycleIdentity, readonly string[]>;
	lowerExpression(node: ts.Expression): LifecycleExpression;
	fail(
		node: ts.Node,
		reason: DiagnosticReason,
		supportedRewrite: string,
	): never;
}>;

function capabilityArgument(
	node: ts.Expression,
	env: CapabilityLoweringContext,
	argumentKeys: readonly string[],
	argumentRoots: readonly string[],
	prefix = "",
): LifecycleExpression {
	if (!ts.isObjectLiteralExpression(node))
		return env.fail(
			node,
			"unsupportedLifecycleSyntax",
			"pass one exact generated Operation argument object",
		);
	const admittedAtLevel =
		prefix === ""
			? argumentRoots
			: [
					...new Set(
						argumentKeys
							.filter((key) => key.startsWith(prefix))
							.map((key) => key.slice(prefix.length).split(".")[0]!),
					),
				];
	const entries = new Map<string, LifecycleObjectEntry>();
	for (const member of node.properties) {
		if (
			!ts.isPropertyAssignment(member) ||
			(!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name))
		)
			return env.fail(
				member,
				"unsupportedLifecycleSyntax",
				"use exact static Operation argument properties",
			);
		const key = member.name.text;
		if (!admittedAtLevel.includes(key) || entries.has(key))
			env.fail(
				member.name,
				"unsupportedLifecycleSyntax",
				"use each generated Operation argument property at most once",
			);
		entries.set(key, {
			kind: "argument" as const,
			key,
			value: ts.isObjectLiteralExpression(member.initializer)
				? capabilityArgument(
						member.initializer,
						env,
						argumentKeys,
						argumentRoots,
						`${prefix}${key}.`,
					)
				: env.lowerExpression(member.initializer),
		});
	}
	return {
		op: "object",
		entries: admittedAtLevel.flatMap((key) => {
			const entry = entries.get(key);
			return entry ? [entry] : [];
		}),
	};
}

function flattenedArgumentKeys(
	value: LifecycleExpression,
	prefix = "",
): readonly string[] {
	if (value.op !== "object") return [];
	return value.entries.flatMap((entry) => {
		if (entry.kind !== "argument") return [];
		const path = `${prefix}${entry.key}`;
		const nested = flattenedArgumentKeys(entry.value, `${path}.`);
		return nested.length === 0 ? [path] : nested;
	});
}

export function lowerLifecycleCapability(
	node: ts.Expression,
	env: CapabilityLoweringContext,
): Extract<LifecycleExpression, { op: "capability" }> {
	if (
		!ts.isCallExpression(node) ||
		!ts.isPropertyAccessExpression(node.expression)
	)
		return env.fail(
			node,
			"unsupportedLifecycleCapability",
			"await a generated ctx.data Collection write",
		);
	const segments: string[] = [];
	let target: ts.Expression = node.expression;
	while (ts.isPropertyAccessExpression(target)) {
		segments.unshift(target.name.text);
		target = target.expression;
	}
	const name = segments.join(".");
	const binding = env.bindings.capabilities[name];
	if (
		(env.phase === "check"
			? binding?.kind !== "read"
			: env.phase === "afterWrite"
				? binding?.kind !== "write"
				: true) ||
		!ts.isIdentifier(target) ||
		env.parameters.get(target.text) !== "capabilities" ||
		!binding
	)
		return env.fail(
			node,
			"unsupportedLifecycleCapability",
			"use an awaited generated read in check or generated write in afterWrite",
		);
	if (node.arguments.length !== 1)
		return env.fail(
			node,
			"unsupportedLifecycleSyntax",
			"pass one exact generated Operation argument object",
		);
	const argument = capabilityArgument(
		node.arguments[0]!,
		env,
		binding.argumentKeys,
		binding.argumentRoots,
	);
	const actualKeys = flattenedArgumentKeys(argument);
	const actualRoots =
		argument.op === "object"
			? argument.entries.flatMap((entry) =>
					entry.kind === "argument" ? [entry.key] : [],
				)
			: [];
	if (binding.requiredArgumentRoots.some((key) => !actualRoots.includes(key)))
		return env.fail(
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			`provide required generated Operation arguments ${binding.requiredArgumentRoots.join(", ")}`,
		);
	if (binding.requiredArgumentKeys.some((key) => !actualKeys.includes(key)))
		return env.fail(
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			`provide required generated Operation arguments ${binding.requiredArgumentKeys.join(", ")}`,
		);
	if (
		binding.requireNonEmptyWriteLane &&
		!actualKeys.some(
			(key) => key.startsWith("patch.") || key.startsWith("values."),
		)
	)
		return env.fail(
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			"provide at least one update patch or trusted value Field",
		);
	if (
		binding.requireNonEmptySelect &&
		!actualKeys.some((key) => key.startsWith("select."))
	)
		return env.fail(
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			"select at least one generated Operation result Field",
		);
	const priorKeys = env.capabilityArgumentKeys.get(binding.identity);
	if (
		priorKeys &&
		(priorKeys.length !== actualKeys.length ||
			priorKeys.some((key, index) => key !== actualKeys[index]))
	)
		return env.fail(
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			"use one exact argument shape for every call to this generated Operation capability",
		);
	env.capabilityArgumentKeys.set(binding.identity, actualKeys);
	return {
		op: "capability",
		capability: binding.kind,
		identity: binding.identity,
		arguments: [argument],
	};
}
