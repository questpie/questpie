import ts from "typescript";

import { CompilerDiagnosticError } from "../diagnostic";
import type { SourceSpan } from "../types";
import type {
	LifecycleBindings,
	LifecycleExpression,
	LifecycleIdentity,
	LifecycleObjectEntry,
	LifecyclePhase,
	LifecycleStatement,
} from "./contract";

export type LifecycleCapabilityCandidate = Readonly<{
	kind: "write";
	identity: LifecycleIdentity;
	argumentKeys: readonly string[];
	requiredArgumentKeys: readonly string[];
	requireNonEmptyWriteLane: boolean;
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

const publicMembers = {
	normalize: { input: "input" },
	validate: {
		candidate: "candidate",
		current: "current",
		now: "now",
		issues: "issues",
	},
	afterWrite: {
		row: "written",
		previous: "previous",
		ctx: "capabilities",
	},
} as const;
const binaryOperators = new Set([
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
]);
const stringMethods = new Set([
	"trim",
	"toUpperCase",
	"toLowerCase",
	"startsWith",
	"endsWith",
	"includes",
]);
const sourcePrefix = "const __phase = ";

interface Environment {
	readonly phase: "normalize" | "validate" | "afterWrite";
	readonly source: ts.SourceFile;
	readonly module: string;
	readonly base: SourceSpan;
	readonly bindings: LifecycleLoweringBindings;
	readonly parameters: Map<string, string>;
	readonly locals: Map<string, number>;
	readonly issueOrigins: Map<LifecycleIdentity, LifecycleOrigin>;
	readonly capabilityArgumentKeys: Map<LifecycleIdentity, readonly string[]>;
	nextSlot: number;
}

function capabilityArgument(
	node: ts.Expression,
	env: Environment,
	argumentKeys: readonly string[],
	prefix = "",
): LifecycleExpression {
	if (!ts.isObjectLiteralExpression(node))
		return fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"pass one exact generated Operation argument object",
		);
	const admittedAtLevel = [
		...new Set(
			argumentKeys
				.filter((key) => key.startsWith(prefix))
				.map((key) => key.slice(prefix.length).split(".")[0]!),
		),
	];
	if (prefix && node.properties.length === 0 && admittedAtLevel.length > 0)
		return fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"provide at least one generated Operation argument property",
		);
	const entries = new Map<string, LifecycleObjectEntry>();
	for (const member of node.properties) {
		if (
			!ts.isPropertyAssignment(member) ||
			(!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name))
		)
			return fail(
				env,
				member,
				"unsupportedLifecycleSyntax",
				"use exact static Operation argument properties",
			);
		const key = member.name.text;
		if (!admittedAtLevel.includes(key) || entries.has(key))
			fail(
				env,
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
						`${prefix}${key}.`,
					)
				: expression(member.initializer, env),
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

function capability(
	node: ts.Expression,
	env: Environment,
): Extract<LifecycleExpression, { op: "capability" }> {
	if (
		!ts.isCallExpression(node) ||
		!ts.isPropertyAccessExpression(node.expression)
	)
		return fail(
			env,
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
		env.phase !== "afterWrite" ||
		!ts.isIdentifier(target) ||
		env.parameters.get(target.text) !== "capabilities" ||
		!binding ||
		binding.kind !== "write"
	)
		return fail(
			env,
			node,
			"unsupportedLifecycleCapability",
			"use an awaited generated ctx.data.<collection>.<create|update> capability only in afterWrite",
		);
	if (node.arguments.length !== 1)
		return fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"pass one exact generated Operation argument object",
		);
	const argument = capabilityArgument(
		node.arguments[0]!,
		env,
		binding.argumentKeys,
	);
	const actualKeys = flattenedArgumentKeys(argument);
	if (binding.requiredArgumentKeys.some((key) => !actualKeys.includes(key)))
		return fail(
			env,
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
		return fail(
			env,
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			"provide at least one update patch or trusted value Field",
		);
	const priorKeys = env.capabilityArgumentKeys.get(binding.identity);
	if (
		priorKeys &&
		(priorKeys.length !== actualKeys.length ||
			priorKeys.some((key, index) => key !== actualKeys[index]))
	)
		return fail(
			env,
			node.arguments[0]!,
			"unsupportedLifecycleSyntax",
			"use one exact argument shape for every call to this generated Operation capability",
		);
	env.capabilityArgumentKeys.set(binding.identity, actualKeys);
	return {
		op: "capability",
		capability: "write",
		identity: binding.identity,
		arguments: [argument],
	};
}

export type LifecycleOrigin = Readonly<{
	module: string;
	line: number;
	column: number;
}>;

export type LoweredLifecyclePhase = Readonly<{
	statements: readonly LifecycleStatement[];
	issueOrigins: ReadonlyMap<LifecycleIdentity, LifecycleOrigin>;
}>;

function origin(env: Environment, node: ts.Node): LifecycleOrigin {
	const point = env.source.getLineAndCharacterOfPosition(
		node.getStart(env.source),
	);
	return {
		module: env.module,
		line: env.base.start.line + point.line,
		column:
			point.line === 0
				? env.base.start.column + point.character - sourcePrefix.length
				: point.character + 1,
	};
}

function fail(
	env: Environment,
	node: ts.Node,
	reason: DiagnosticReason,
	rewrite: string,
): never {
	const point = origin(env, node);
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-026",
		reason,
		`${reason} in ${env.phase} at ${point.module}:${point.line}:${point.column}; ${rewrite}`,
		{ phase: env.phase, origin: point, rewrite },
	);
}

function fieldIdentity(
	env: Environment,
	name: string,
	node: ts.Node,
): LifecycleIdentity {
	const identity = env.bindings.fields[name];
	if (!identity)
		fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			`declare Field ${JSON.stringify(name)} and use its static member`,
		);
	return identity;
}

function expression(
	node: ts.Expression,
	env: Environment,
): LifecycleExpression {
	if (ts.isParenthesizedExpression(node)) {
		const value = expression(node.expression, env);
		return ts.isOptionalChain(node.expression)
			? { op: "optionalBoundary", value }
			: value;
	}
	if (node.kind === ts.SyntaxKind.NullKeyword)
		return { op: "literal", value: null };
	if (
		node.kind === ts.SyntaxKind.TrueKeyword ||
		node.kind === ts.SyntaxKind.FalseKeyword
	)
		return { op: "literal", value: node.kind === ts.SyntaxKind.TrueKeyword };
	if (ts.isNumericLiteral(node)) {
		const value = Number(node.text);
		if (!Number.isFinite(value))
			fail(env, node, "unsupportedLifecycleSyntax", "use a finite number");
		return { op: "literal", value };
	}
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return { op: "literal", value: node.text };
	if (ts.isIdentifier(node)) {
		const slot = env.locals.get(node.text);
		if (slot !== undefined) return { op: "local", slot };
		const role = env.parameters.get(node.text);
		if (role && role !== "issues")
			return {
				op: "root",
				root: role as Extract<LifecycleExpression, { op: "root" }>["root"],
			};
		return fail(
			env,
			node,
			"lifecycleCapture",
			"pass data through a phase input or immutable local",
		);
	}
	if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node))
		return {
			op: "member",
			target: expression(node.expression, env),
			field: fieldIdentity(env, node.name.text, node.name),
			optional: !!node.questionDotToken,
		};
	if (ts.isElementAccessExpression(node))
		return fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"use static property access",
		);
	if (ts.isPrefixUnaryExpression(node)) {
		const operator =
			node.operator === ts.SyntaxKind.ExclamationToken
				? "!"
				: node.operator === ts.SyntaxKind.MinusToken
					? "-"
					: null;
		if (!operator)
			return fail(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"use only ! or unary -",
			);
		return { op: "unary", operator, value: expression(node.operand, env) };
	}
	if (ts.isBinaryExpression(node)) {
		const operator = node.operatorToken.getText(env.source);
		if (!binaryOperators.has(operator))
			return fail(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"use a deterministic Lifecycle Program operator",
			);
		return {
			op: "binary",
			operator: operator as Extract<
				LifecycleExpression,
				{ op: "binary" }
			>["operator"],
			left: expression(node.left, env),
			right: expression(node.right, env),
		};
	}
	if (ts.isConditionalExpression(node))
		return {
			op: "conditional",
			test: expression(node.condition, env),
			yes: expression(node.whenTrue, env),
			no: expression(node.whenFalse, env),
		};
	if (ts.isArrayLiteralExpression(node)) {
		if (node.elements.some(ts.isSpreadElement))
			return fail(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"construct an exact array without spread",
			);
		return {
			op: "array",
			values: node.elements.map((item) => expression(item, env)),
		};
	}
	if (ts.isObjectLiteralExpression(node)) {
		const entries: LifecycleObjectEntry[] = [];
		for (const member of node.properties) {
			if (ts.isSpreadAssignment(member)) {
				if (
					env.phase !== "normalize" ||
					!ts.isIdentifier(member.expression) ||
					env.parameters.get(member.expression.text) !== "input"
				)
					fail(
						env,
						member,
						"unsupportedLifecycleSyntax",
						"spread only the normalize input",
					);
				entries.push({ kind: "spreadInput" });
				continue;
			}
			if (!ts.isPropertyAssignment(member) || !ts.isIdentifier(member.name))
				fail(
					env,
					member,
					"unsupportedLifecycleSyntax",
					"use exact static object properties",
				);
			entries.push({
				kind: "field",
				field: fieldIdentity(env, member.name.text, member.name),
				value: expression(member.initializer, env),
			});
		}
		return { op: "object", entries };
	}
	if (ts.isTemplateExpression(node))
		return {
			op: "template",
			head: node.head.text,
			spans: node.templateSpans.map((span) => ({
				value: expression(span.expression, env),
				tail: span.literal.text,
			})),
		};
	if (ts.isCallExpression(node)) {
		if (
			ts.isPropertyAccessExpression(node.expression) &&
			stringMethods.has(node.expression.name.text)
		) {
			const method = node.expression.name.text as Extract<
				LifecycleExpression,
				{ op: "stringMethod" }
			>["method"];
			const arity = ["trim", "toUpperCase", "toLowerCase"].includes(method)
				? 0
				: 1;
			if (node.arguments.length !== arity)
				return fail(
					env,
					node,
					"unsupportedLifecycleSyntax",
					`use ${method} with exactly ${arity} arguments`,
				);
			return {
				op: "stringMethod",
				method,
				target: expression(node.expression.expression, env),
				arguments: node.arguments.map((item) => expression(item, env)),
				optional: !!node.questionDotToken || !!node.expression.questionDotToken,
			};
		}
		let target: ts.Expression = node.expression;
		while (ts.isPropertyAccessExpression(target)) target = target.expression;
		if (ts.isIdentifier(target) && !env.parameters.has(target.text))
			return fail(
				env,
				target,
				"lifecycleCapture",
				"remove imported, ambient, or captured calls",
			);
		return fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"use a closed string method",
		);
	}
	return fail(
		env,
		node,
		"unsupportedLifecycleSyntax",
		"rewrite with Lifecycle Program v1 forms",
	);
}

function statements(
	nodes: readonly ts.Statement[],
	env: Environment,
): readonly LifecycleStatement[] {
	const output: LifecycleStatement[] = [];
	for (const node of nodes) {
		if (ts.isVariableStatement(node)) {
			if (
				!(node.declarationList.flags & ts.NodeFlags.Const) ||
				node.declarationList.declarations.length !== 1
			)
				fail(
					env,
					node,
					"unsupportedLifecycleSyntax",
					"use one const declaration per statement",
				);
			const declaration = node.declarationList.declarations[0]!;
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
				fail(
					env,
					declaration,
					"unsupportedLifecycleSyntax",
					"initialize a simple const local",
				);
			const slot = env.nextSlot++;
			const value = expression(declaration.initializer, env);
			env.locals.set(declaration.name.text, slot);
			output.push({ op: "const", slot, value });
			continue;
		}
		if (ts.isIfStatement(node)) {
			const branch = (candidate: ts.Statement | undefined) =>
				candidate
					? statements(
							ts.isBlock(candidate) ? candidate.statements : [candidate],
							{ ...env, locals: new Map(env.locals) },
						)
					: [];
			output.push({
				op: "if",
				test: expression(node.expression, env),
				consequent: branch(node.thenStatement),
				otherwise: branch(node.elseStatement),
			});
			continue;
		}
		if (ts.isReturnStatement(node)) {
			output.push({
				op: "return",
				value: node.expression ? expression(node.expression, env) : null,
			});
			continue;
		}
		if (ts.isThrowStatement(node)) {
			if (env.phase !== "validate")
				fail(
					env,
					node,
					"unsupportedLifecycleCapability",
					"throw declared issues only from validate",
				);
			const call = node.expression;
			if (
				!ts.isCallExpression(call) ||
				call.arguments.length !== 0 ||
				!ts.isPropertyAccessExpression(call.expression) ||
				!ts.isIdentifier(call.expression.expression) ||
				env.parameters.get(call.expression.expression.text) !== "issues"
			)
				fail(
					env,
					node,
					"unsupportedLifecycleSyntax",
					"throw issues.<declared>()",
				);
			const issue = env.bindings.issues[call.expression.name.text];
			if (!issue)
				fail(
					env,
					call.expression.name,
					"unsupportedLifecycleSyntax",
					"throw a declared generated issue",
				);
			env.issueOrigins.set(
				issue,
				env.issueOrigins.get(issue) ?? origin(env, node),
			);
			output.push({ op: "throwIssue", issue });
			continue;
		}
		if (ts.isExpressionStatement(node)) {
			if (ts.isAwaitExpression(node.expression)) {
				output.push({
					op: "effect",
					value: capability(node.expression.expression, env),
				});
				continue;
			}
			expression(node.expression, env);
			fail(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"remove detached work and return the supported result",
			);
		}
		fail(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"rewrite with const, if/else, return, or an issue throw",
		);
	}
	return output;
}

export function lowerLifecyclePhase(
	phase: LifecyclePhase,
	authoredSource: string,
	module: string,
	base: SourceSpan,
	bindings: LifecycleLoweringBindings,
): LoweredLifecyclePhase {
	if (phase === "check")
		throw new TypeError("check is not implemented before LIFE-03");
	const source = ts.createSourceFile(
		module,
		`${sourcePrefix}${authoredSource}`,
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.TS,
	);
	const declaration = source.statements[0];
	const callback =
		declaration && ts.isVariableStatement(declaration)
			? declaration.declarationList.declarations[0]?.initializer
			: undefined;
	const empty: Environment = {
		phase,
		source,
		module,
		base,
		bindings,
		parameters: new Map(),
		locals: new Map(),
		issueOrigins: new Map(),
		capabilityArgumentKeys: new Map(),
		nextSlot: 0,
	};
	if (
		!callback ||
		(!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
	)
		fail(
			empty,
			callback ?? source,
			"unsupportedLifecycleSyntax",
			"author a function or arrow callback",
		);
	const asynchronous = Boolean(
		callback.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
		),
	);
	if (callback.asteriskToken || asynchronous !== (phase === "afterWrite"))
		fail(
			empty,
			callback,
			"unsupportedLifecycleSyntax",
			phase === "afterWrite"
				? "use an async afterWrite callback"
				: "use synchronous normalize and validate callbacks",
		);
	if (
		callback.parameters.length !== 1 ||
		!ts.isObjectBindingPattern(callback.parameters[0]!.name)
	)
		fail(
			empty,
			callback,
			"unsupportedLifecycleSyntax",
			"use one destructured phase parameter",
		);
	for (const element of callback.parameters[0]!.name.elements) {
		if (
			element.dotDotDotToken ||
			element.initializer ||
			!ts.isIdentifier(element.name) ||
			(element.propertyName && !ts.isIdentifier(element.propertyName))
		)
			fail(
				empty,
				element,
				"unsupportedLifecycleSyntax",
				"use static destructured phase members",
			);
		const publicName = element.propertyName?.text ?? element.name.text;
		const role = publicMembers[phase][
			publicName as keyof (typeof publicMembers)[typeof phase]
		] as string | undefined;
		if (!role)
			fail(
				empty,
				element,
				"unsupportedLifecycleSyntax",
				`use only ${Object.keys(publicMembers[phase]).join(", ")}`,
			);
		empty.parameters.set(element.name.text, role);
	}
	const lowered: readonly LifecycleStatement[] = ts.isBlock(callback.body)
		? statements(callback.body.statements, empty)
		: [{ op: "return", value: expression(callback.body, empty) }];
	return Object.freeze({
		statements: Object.freeze(lowered),
		issueOrigins: empty.issueOrigins,
	});
}
