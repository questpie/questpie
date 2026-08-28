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

interface Environment {
	readonly phase: "normalize" | "validate";
	readonly source: ts.SourceFile;
	readonly module: string;
	readonly base: SourceSpan;
	readonly bindings: LifecycleBindings;
	readonly parameters: Map<string, string>;
	readonly locals: Map<string, number>;
	nextSlot: number;
}

function fail(
	env: Environment,
	node: ts.Node,
	reason: DiagnosticReason,
	rewrite: string,
): never {
	const point = env.source.getLineAndCharacterOfPosition(
		node.getStart(env.source),
	);
	const line = env.base.start.line + point.line;
	const column =
		point.line === 0
			? env.base.start.column + point.character
			: point.character + 1;
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-026",
		reason,
		`${reason} in ${env.phase} at ${env.module}:${line}:${column}; ${rewrite}`,
		{ phase: env.phase, origin: { module: env.module, line, column }, rewrite },
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
			output.push({ op: "throwIssue", issue });
			continue;
		}
		if (ts.isExpressionStatement(node)) {
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
	bindings: LifecycleBindings,
): readonly LifecycleStatement[] {
	if (phase !== "normalize" && phase !== "validate")
		throw new TypeError(`${phase} is not implemented by LIFE-01`);
	const source = ts.createSourceFile(
		module,
		`const __phase = ${authoredSource}`,
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
	if (
		callback.asteriskToken ||
		callback.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
		)
	)
		fail(
			empty,
			callback,
			"unsupportedLifecycleSyntax",
			"use synchronous normalize and validate callbacks",
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
	return ts.isBlock(callback.body)
		? statements(callback.body.statements, empty)
		: [{ op: "return", value: expression(callback.body, empty) }];
}
