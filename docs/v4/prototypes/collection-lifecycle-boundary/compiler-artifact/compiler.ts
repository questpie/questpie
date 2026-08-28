import { createHash } from "node:crypto";
import { types as nodeTypes } from "node:util";

import ts from "typescript";

export const FORMAT = "questpie.lifecycle-program.v1" as const;
export const INTERPRETER = "questpie.lifecycle-interpreter.v1" as const;
const DIGEST_DOMAIN = "questpie.collection-lifecycle-program.v1\0";
const OPTIONAL_ABSENCE = Symbol("questpie.lifecycle.optional-absence");
const VOID_RESULT = Symbol("questpie.lifecycle.void-result");
const MAX_RUNTIME_ARRAY_LENGTH = 10_000;

export type Phase = "normalize" | "validate" | "check" | "afterWrite";
/** The sole non-scalar Lifecycle Program v1 timestamp representation. */
export type LifecycleTimestamp = Date;
export type Origin = Readonly<{ module: string; line: number; column: number }>;
export type Identity =
	`${"schema" | "collection" | "field" | "issue" | "operation" | "job"}:${string}`;

export type DiagnosticReason =
	| "unsupportedLifecycleSyntax"
	| "lifecycleCapture"
	| "unsupportedLifecycleCapability";

export class LifecycleDiagnostic extends Error {
	readonly code = "QP-COMPOSE-026";
	constructor(
		readonly reason: DiagnosticReason,
		readonly phase: Phase,
		readonly origin: Origin,
		readonly rewrite: string,
	) {
		super(
			`${reason} in ${phase} at ${origin.module}:${origin.line}:${origin.column}; ${rewrite}`,
		);
	}
}

type Scalar = null | boolean | number | string;
type BinaryOperator =
	| "+"
	| "-"
	| "*"
	| "/"
	| "%"
	| "==="
	| "!=="
	| "<"
	| "<="
	| ">"
	| ">="
	| "&&"
	| "||"
	| "??";
type StringMethod =
	| "trim"
	| "toUpperCase"
	| "toLowerCase"
	| "startsWith"
	| "endsWith"
	| "includes";
export type Expression =
	| Readonly<{ op: "literal"; value: Scalar }>
	| Readonly<{
			op: "root";
			root:
				| "input"
				| "candidate"
				| "current"
				| "written"
				| "previous"
				| "now"
				| "callId";
	  }>
	| Readonly<{ op: "local"; slot: number }>
	| Readonly<{ op: "optionalBoundary"; value: Expression }>
	| Readonly<{
			op: "member";
			target: Expression;
			field: Identity;
			optional: boolean;
	  }>
	| Readonly<{ op: "unary"; operator: "!" | "-"; value: Expression }>
	| Readonly<{
			op: "binary";
			operator: BinaryOperator;
			left: Expression;
			right: Expression;
	  }>
	| Readonly<{
			op: "conditional";
			test: Expression;
			yes: Expression;
			no: Expression;
	  }>
	| Readonly<{ op: "array"; values: readonly Expression[] }>
	| Readonly<{ op: "object"; entries: readonly ObjectEntry[] }>
	| Readonly<{
			op: "template";
			head: string;
			spans: readonly Readonly<{ value: Expression; tail: string }>[];
	  }>
	| Readonly<{
			op: "stringMethod";
			method: StringMethod;
			target: Expression;
			arguments: readonly Expression[];
			optional: boolean;
	  }>
	| Readonly<{
			op: "capability";
			capability: "read" | "write" | "acceptJob";
			identity: Identity;
			arguments: readonly Expression[];
	  }>;

export type ObjectEntry =
	| Readonly<{ kind: "field"; field: Identity; value: Expression }>
	| Readonly<{ kind: "argument"; key: string; value: Expression }>
	| Readonly<{ kind: "spreadInput" }>;

export type Statement =
	| Readonly<{ op: "const"; slot: number; value: Expression }>
	| Readonly<{
			op: "if";
			test: Expression;
			consequent: readonly Statement[];
			otherwise: readonly Statement[];
	  }>
	| Readonly<{ op: "return"; value: Expression | null }>
	| Readonly<{ op: "throwIssue"; issue: Identity }>
	| Readonly<{ op: "effect"; value: Extract<Expression, { op: "capability" }> }>
	| Readonly<{
			op: "forOf";
			slot: number;
			sourceSlot: number;
			body: readonly Statement[];
	  }>;

export type Bindings = Readonly<{
	schema: Identity;
	collection: Identity;
	fields: Readonly<Record<string, Identity>>;
	issues: Readonly<Record<string, Identity>>;
	capabilities: Readonly<
		Record<
			string,
			| Readonly<{
					kind: "read";
					identity: Identity;
					argumentKeys: readonly string[];
					cardinality: "one" | "many";
					first: boolean;
					maxRows: number;
			  }>
			| Readonly<{
					kind: "write" | "acceptJob";
					identity: Identity;
					argumentKeys: readonly string[];
			  }>
		>
	>;
	operations: readonly Identity[];
	jobs: readonly Identity[];
}>;

export type ExpectedArtifactContract = Readonly<{
	runtimeBuild: string;
	interpreter?: string;
	bindings: Bindings;
}>;

export type ExecutionBudget = {
	readonly signal: AbortSignal;
	readonly deadline: number;
	readonly maxStatements: number;
	readonly maxRows: number;
	readonly maxDependencies: number;
	readonly maxDurationMilliseconds: number;
	readonly maxArtifactReentry: number;
	readonly clock: () => number;
	readonly startedAt: number;
	statements: number;
	rows: number;
	dependencies: number;
	artifactReentry: number;
};

export type CapabilityInvocation = Readonly<{
	arguments: readonly unknown[];
	budget: ExecutionBudget;
	artifact: Artifact;
}>;

export type OperationAdapter = Readonly<
	Record<
		string,
		(invocation: CapabilityInvocation) => unknown | Promise<unknown>
	>
>;

export function createExecutionBudget(
	options: Readonly<{
		signal?: AbortSignal;
		deadline: number;
		maxStatements: number;
		maxRows: number;
		maxDependencies: number;
		maxDurationMilliseconds: number;
		maxArtifactReentry: number;
		clock?: () => number;
	}>,
): ExecutionBudget {
	const clock = options.clock ?? Date.now;
	for (const [name, value] of Object.entries({
		maxStatements: options.maxStatements,
		maxRows: options.maxRows,
		maxDependencies: options.maxDependencies,
		maxDurationMilliseconds: options.maxDurationMilliseconds,
		maxArtifactReentry: options.maxArtifactReentry,
	}))
		if (!Number.isSafeInteger(value) || value < 1)
			throw new TypeError(`${name} must be a positive safe integer`);
	if (!Number.isFinite(options.deadline))
		throw new TypeError("deadline must be finite");
	const budget: ExecutionBudget = {
		signal: options.signal ?? new AbortController().signal,
		deadline: options.deadline,
		maxStatements: options.maxStatements,
		maxRows: options.maxRows,
		maxDependencies: options.maxDependencies,
		maxDurationMilliseconds: options.maxDurationMilliseconds,
		maxArtifactReentry: options.maxArtifactReentry,
		clock,
		startedAt: clock(),
		statements: 0,
		rows: 0,
		dependencies: 0,
		artifactReentry: 0,
	};
	for (const name of [
		"signal",
		"deadline",
		"maxStatements",
		"maxRows",
		"maxDependencies",
		"maxDurationMilliseconds",
		"maxArtifactReentry",
		"clock",
		"startedAt",
	] as const)
		Object.defineProperty(budget, name, {
			value: budget[name],
			enumerable: true,
			configurable: false,
			writable: false,
		});
	return Object.seal(budget);
}

export type Artifact = Readonly<{
	format: typeof FORMAT;
	interpreter: typeof INTERPRETER;
	runtimeBuild: string;
	reentryLimit: number;
	bindings: Bindings;
	phases: Readonly<Record<Phase, readonly Statement[]>>;
}>;

const phases: readonly Phase[] = [
	"normalize",
	"validate",
	"check",
	"afterWrite",
];
const publicMembers: Record<Phase, Readonly<Record<string, string>>> = {
	normalize: { input: "input" },
	validate: {
		candidate: "candidate",
		current: "current",
		now: "now",
		issues: "issues",
	},
	check: {
		candidate: "candidate",
		current: "current",
		ctx: "capabilities",
		issues: "issues",
	},
	afterWrite: {
		row: "written",
		previous: "previous",
		ctx: "capabilities",
	},
};
const binaryOperators: ReadonlySet<string> = new Set<BinaryOperator>([
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
const stringMethods: ReadonlySet<string> = new Set<StringMethod>([
	"trim",
	"toUpperCase",
	"toLowerCase",
	"startsWith",
	"endsWith",
	"includes",
]);
const phaseCapabilities: Record<Phase, ReadonlySet<string>> = {
	normalize: new Set(),
	validate: new Set(),
	check: new Set(["read"]),
	afterWrite: new Set(["read", "write", "acceptJob"]),
};
const phaseRoots: Record<Phase, ReadonlySet<string>> = {
	normalize: new Set(["input"]),
	validate: new Set(["candidate", "current", "now"]),
	check: new Set(["candidate", "current", "now"]),
	afterWrite: new Set(["written", "previous", "now", "callId"]),
};

type Environment = {
	phase: Phase;
	source: ts.SourceFile;
	bindings: Bindings;
	parameters: Map<string, string>;
	locals: Map<string, number>;
	bounded: Set<number>;
	nextSlot: number;
};

function origin(env: Environment, node: ts.Node): Origin {
	const point = env.source.getLineAndCharacterOfPosition(
		node.getStart(env.source),
	);
	return {
		module: env.source.fileName,
		line: point.line + 1,
		column: point.character + 1,
	};
}

function reject(
	env: Environment,
	node: ts.Node,
	reason: DiagnosticReason,
	rewrite: string,
): never {
	throw new LifecycleDiagnostic(reason, env.phase, origin(env, node), rewrite);
}

function fieldIdentity(
	env: Environment,
	name: string,
	node: ts.Node,
): Identity {
	const identity = Object.hasOwn(env.bindings.fields, name)
		? env.bindings.fields[name]
		: undefined;
	if (!identity)
		reject(
			env,
			node,
			"unsupportedLifecycleSyntax",
			`declare Field ${JSON.stringify(name)} and use its generated static member`,
		);
	return identity;
}

function lowerExpression(node: ts.Expression, env: Environment): Expression {
	if (ts.isParenthesizedExpression(node)) {
		const value = lowerExpression(node.expression, env);
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
			reject(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"use a finite numeric literal",
			);
		return { op: "literal", value };
	}
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
		return { op: "literal", value: node.text };
	if (ts.isIdentifier(node)) {
		const slot = env.locals.get(node.text);
		if (slot !== undefined) return { op: "local", slot };
		const role = env.parameters.get(node.text);
		if (role && role !== "issues" && role !== "capabilities")
			return {
				op: "root",
				root: role as Extract<Expression, { op: "root" }>["root"],
			};
		return reject(
			env,
			node,
			"lifecycleCapture",
			"pass data through a declared phase input or immutable local",
		);
	}
	if (ts.isPropertyAccessExpression(node) || ts.isPropertyAccessChain(node)) {
		if (
			ts.isIdentifier(node.expression) &&
			env.parameters.get(node.expression.text) === "capabilities" &&
			(node.name.text === "now" ||
				(env.phase === "afterWrite" && node.name.text === "callId"))
		)
			return { op: "root", root: node.name.text as "now" | "callId" };
		return {
			op: "member",
			target: lowerExpression(node.expression, env),
			field: fieldIdentity(env, node.name.text, node.name),
			optional: !!node.questionDotToken,
		};
	}
	if (ts.isElementAccessExpression(node))
		return reject(
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
			return reject(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"use only ! or unary -",
			);
		return { op: "unary", operator, value: lowerExpression(node.operand, env) };
	}
	if (ts.isBinaryExpression(node)) {
		const operator = node.operatorToken.getText(env.source);
		if (!binaryOperators.has(operator))
			return reject(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"use a Lifecycle Program v1 deterministic operator",
			);
		return {
			op: "binary",
			operator: operator as BinaryOperator,
			left: lowerExpression(node.left, env),
			right: lowerExpression(node.right, env),
		};
	}
	if (ts.isConditionalExpression(node))
		return {
			op: "conditional",
			test: lowerExpression(node.condition, env),
			yes: lowerExpression(node.whenTrue, env),
			no: lowerExpression(node.whenFalse, env),
		};
	if (ts.isArrayLiteralExpression(node)) {
		if (node.elements.some(ts.isSpreadElement))
			return reject(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"construct an exact array without spread",
			);
		return {
			op: "array",
			values: node.elements.map((value) => lowerExpression(value, env)),
		};
	}
	if (ts.isObjectLiteralExpression(node)) {
		const entries: ObjectEntry[] = [];
		for (const member of node.properties) {
			if (ts.isSpreadAssignment(member)) {
				const role = ts.isIdentifier(member.expression)
					? env.parameters.get(member.expression.text)
					: undefined;
				if (env.phase !== "normalize" || role !== "input")
					reject(
						env,
						member,
						"unsupportedLifecycleSyntax",
						"spread only the normalize phase input",
					);
				entries.push({ kind: "spreadInput" });
				continue;
			}
			if (!ts.isPropertyAssignment(member) || !ts.isIdentifier(member.name))
				reject(
					env,
					member,
					"unsupportedLifecycleSyntax",
					"use exact static object properties",
				);
			entries.push({
				kind: "field",
				field: fieldIdentity(env, member.name.text, member.name),
				value: lowerExpression(member.initializer, env),
			});
		}
		return { op: "object", entries };
	}
	if (ts.isTemplateExpression(node))
		return {
			op: "template",
			head: node.head.text,
			spans: node.templateSpans.map((span) => ({
				value: lowerExpression(span.expression, env),
				tail: span.literal.text,
			})),
		};
	if (ts.isAwaitExpression(node))
		return reject(
			env,
			node,
			"unsupportedLifecycleCapability",
			"lift each awaited capability into its own sequential const or effect statement",
		);
	if (ts.isCallExpression(node)) {
		if (
			ts.isPropertyAccessExpression(node.expression) &&
			stringMethods.has(node.expression.name.text)
		) {
			const method = node.expression.name.text as StringMethod;
			const requiredArity = ["trim", "toUpperCase", "toLowerCase"].includes(
				method,
			)
				? 0
				: 1;
			if (node.arguments.length !== requiredArity)
				return reject(
					env,
					node,
					"unsupportedLifecycleSyntax",
					`use ${method} with exactly ${requiredArity} argument${requiredArity === 1 ? "" : "s"}`,
				);
			return {
				op: "stringMethod",
				method,
				target: lowerExpression(node.expression.expression, env),
				arguments: node.arguments.map((argument) =>
					lowerExpression(argument, env),
				),
				optional: !!node.questionDotToken || !!node.expression.questionDotToken,
			};
		}
		let target: ts.Expression = node.expression;
		while (ts.isPropertyAccessExpression(target)) target = target.expression;
		if (
			ts.isIdentifier(target) &&
			!env.parameters.has(target.text) &&
			!env.locals.has(target.text)
		)
			return reject(
				env,
				target,
				"lifecycleCapture",
				"replace imported, ambient, or captured calls with a generated phase capability",
			);
		return reject(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"use a closed string method or await a generated phase capability",
		);
	}
	if (
		ts.isTaggedTemplateExpression(node) &&
		ts.isIdentifier(node.tag) &&
		!env.parameters.has(node.tag.text) &&
		!env.locals.has(node.tag.text)
	)
		return reject(
			env,
			node.tag,
			"lifecycleCapture",
			"remove the imported or captured template tag",
		);
	return reject(
		env,
		node,
		"unsupportedLifecycleSyntax",
		"rewrite with Lifecycle Program v1 forms",
	);
}

function lowerCapabilityArgument(
	node: ts.Expression,
	env: Environment,
	argumentKeys: readonly string[],
	prefix = "",
): Expression {
	if (!ts.isObjectLiteralExpression(node)) return lowerExpression(node, env);
	const entries: ObjectEntry[] = [];
	const admittedAtLevel = [
		...new Set(
			argumentKeys
				.filter((key) => key.startsWith(prefix))
				.map((key) => key.slice(prefix.length).split(".")[0]!),
		),
	];
	const seen = new Set<string>();
	for (const member of node.properties) {
		if (!ts.isPropertyAssignment(member) || !ts.isIdentifier(member.name))
			reject(
				env,
				member,
				"unsupportedLifecycleSyntax",
				"use exact generated Operation or Job argument properties",
			);
		const key = member.name.text;
		if (!admittedAtLevel.includes(key) || seen.has(key))
			reject(
				env,
				member.name,
				"unsupportedLifecycleSyntax",
				"use each generated Operation or Job argument property exactly once",
			);
		seen.add(key);
		entries.push({
			kind: "argument",
			key,
			value: lowerCapabilityArgument(
				member.initializer,
				env,
				argumentKeys,
				`${prefix}${key}.`,
			),
		});
	}
	if (seen.size !== admittedAtLevel.length)
		reject(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"provide every generated Operation or Job argument property",
		);
	return {
		op: "object",
		entries: admittedAtLevel.map(
			(key) =>
				entries.find(
					(entry) => entry.kind === "argument" && entry.key === key,
				)!,
		),
	};
}

function lowerCapability(
	node: ts.Expression,
	env: Environment,
	reportedNode: ts.Node,
): Extract<Expression, { op: "capability" }> {
	if (
		!ts.isCallExpression(node) ||
		!ts.isPropertyAccessExpression(node.expression)
	)
		return reject(
			env,
			reportedNode,
			"unsupportedLifecycleCapability",
			"await a generated capability member",
		);
	const segments: string[] = [];
	let target: ts.Expression = node.expression;
	while (ts.isPropertyAccessExpression(target)) {
		segments.unshift(target.name.text);
		target = target.expression;
	}
	if (
		!ts.isIdentifier(target) ||
		env.parameters.get(target.text) !== "capabilities"
	)
		return reject(
			env,
			reportedNode,
			"unsupportedLifecycleCapability",
			"await a generated ctx.data or ctx.jobs capability",
		);
	const capabilityName = segments.join(".");
	const declared = Object.hasOwn(env.bindings.capabilities, capabilityName)
		? env.bindings.capabilities[capabilityName]
		: undefined;
	if (!declared || !phaseCapabilities[env.phase].has(declared.kind))
		return reject(
			env,
			reportedNode,
			"unsupportedLifecycleCapability",
			`use only ${[...phaseCapabilities[env.phase]].join(", ") || "no capabilities"} in ${env.phase}`,
		);
	if (
		node.arguments.length !== 1 ||
		!ts.isObjectLiteralExpression(node.arguments[0]!)
	)
		return reject(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"pass one exact generated Operation or Job argument object",
		);
	return {
		op: "capability",
		capability: declared.kind,
		identity: declared.identity,
		arguments: node.arguments.map((argument) =>
			lowerCapabilityArgument(argument, env, declared.argumentKeys),
		),
	};
}

function lowerStatements(
	nodes: readonly ts.Statement[],
	env: Environment,
): readonly Statement[] {
	const output: Statement[] = [];
	for (const node of nodes) {
		if (ts.isVariableStatement(node)) {
			if (
				!(node.declarationList.flags & ts.NodeFlags.Const) ||
				node.declarationList.declarations.length !== 1
			)
				reject(
					env,
					node,
					"unsupportedLifecycleSyntax",
					"use one const declaration per statement",
				);
			const declaration = node.declarationList.declarations[0]!;
			if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
				reject(
					env,
					declaration,
					"unsupportedLifecycleSyntax",
					"initialize a simple const local",
				);
			const slot = env.nextSlot++;
			const value = ts.isAwaitExpression(declaration.initializer)
				? lowerCapability(
						declaration.initializer.expression,
						env,
						declaration.initializer,
					)
				: lowerExpression(declaration.initializer, env);
			env.locals.set(declaration.name.text, slot);
			if (value.op === "capability" && value.capability === "read") {
				const binding = Object.values(env.bindings.capabilities).find(
					(candidate) =>
						candidate.kind === "read" && candidate.identity === value.identity,
				);
				if (binding?.kind === "read" && binding.cardinality === "many")
					env.bounded.add(slot);
			}
			output.push({ op: "const", slot, value });
			continue;
		}
		if (ts.isIfStatement(node)) {
			const branch = (statement: ts.Statement | undefined) =>
				statement
					? lowerStatements(
							ts.isBlock(statement) ? statement.statements : [statement],
							{
								...env,
								locals: new Map(env.locals),
								bounded: new Set(env.bounded),
							},
						)
					: [];
			output.push({
				op: "if",
				test: lowerExpression(node.expression, env),
				consequent: branch(node.thenStatement),
				otherwise: branch(node.elseStatement),
			});
			continue;
		}
		if (ts.isReturnStatement(node)) {
			output.push({
				op: "return",
				value: node.expression ? lowerExpression(node.expression, env) : null,
			});
			continue;
		}
		if (ts.isThrowStatement(node)) {
			if (env.phase !== "validate" && env.phase !== "check")
				reject(
					env,
					node,
					"unsupportedLifecycleCapability",
					"throw declared issues only from validate or check",
				);
			const call = node.expression;
			if (
				!ts.isCallExpression(call) ||
				call.arguments.length !== 0 ||
				!ts.isPropertyAccessExpression(call.expression) ||
				!ts.isIdentifier(call.expression.expression) ||
				env.parameters.get(call.expression.expression.text) !== "issues"
			)
				reject(
					env,
					node,
					"unsupportedLifecycleSyntax",
					"throw issues.<declared>()",
				);
			const issue = Object.hasOwn(
				env.bindings.issues,
				call.expression.name.text,
			)
				? env.bindings.issues[call.expression.name.text]
				: undefined;
			if (!issue)
				reject(
					env,
					call.expression.name,
					"unsupportedLifecycleSyntax",
					"throw a declared generated issue",
				);
			output.push({ op: "throwIssue", issue });
			continue;
		}
		if (
			ts.isExpressionStatement(node) &&
			ts.isAwaitExpression(node.expression)
		) {
			output.push({
				op: "effect",
				value: lowerCapability(
					node.expression.expression,
					env,
					node.expression,
				),
			});
			continue;
		}
		if (ts.isExpressionStatement(node)) {
			lowerExpression(node.expression, env);
			reject(
				env,
				node,
				"unsupportedLifecycleSyntax",
				"remove detached work and return or await the supported result",
			);
		}
		if (ts.isForOfStatement(node)) {
			if (
				env.phase !== "afterWrite" ||
				node.awaitModifier ||
				!ts.isVariableDeclarationList(node.initializer) ||
				!(node.initializer.flags & ts.NodeFlags.Const) ||
				node.initializer.declarations.length !== 1 ||
				!ts.isIdentifier(node.initializer.declarations[0]!.name) ||
				!ts.isIdentifier(node.expression)
			)
				reject(
					env,
					node,
					"unsupportedLifecycleSyntax",
					"use bounded for...of over a const read result in afterWrite",
				);
			const sourceSlot = env.locals.get(node.expression.text);
			if (sourceSlot === undefined || !env.bounded.has(sourceSlot))
				reject(
					env,
					node.expression,
					"unsupportedLifecycleSyntax",
					"iterate only a compiler-known bounded read result",
				);
			const slot = env.nextSlot++;
			const nested = {
				...env,
				locals: new Map(env.locals),
				bounded: new Set(env.bounded),
			};
			nested.locals.set(
				node.initializer.declarations[0]!.name.getText(env.source),
				slot,
			);
			output.push({
				op: "forOf",
				slot,
				sourceSlot,
				body: lowerStatements(
					ts.isBlock(node.statement)
						? node.statement.statements
						: [node.statement],
					nested,
				),
			});
			continue;
		}
		reject(
			env,
			node,
			"unsupportedLifecycleSyntax",
			"rewrite with const, if/else, return, issue throw, awaited capability, or bounded afterWrite for...of",
		);
	}
	return output;
}

function lowerCallback(
	phase: Phase,
	callback: ts.ArrowFunction | ts.FunctionExpression,
	source: ts.SourceFile,
	bindings: Bindings,
): readonly Statement[] {
	const module = source.fileName;
	const emptyEnvironment = {
		phase,
		source,
		bindings,
		parameters: new Map<string, string>(),
		locals: new Map<string, number>(),
		bounded: new Set<number>(),
		nextSlot: 0,
	};
	if (
		callback.asteriskToken ||
		(callback.modifiers?.some(
			(modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
		) &&
			(phase === "normalize" || phase === "validate"))
	)
		throw new LifecycleDiagnostic(
			"unsupportedLifecycleSyntax",
			phase,
			origin(emptyEnvironment, callback),
			"use synchronous normalize/validate and non-generator callbacks",
		);
	if (
		callback.parameters.length !== 1 ||
		!ts.isObjectBindingPattern(callback.parameters[0]!.name)
	)
		throw new LifecycleDiagnostic(
			"unsupportedLifecycleSyntax",
			phase,
			origin(emptyEnvironment, callback),
			`use one destructured parameter ({ ${Object.keys(publicMembers[phase]).join(", ")} })`,
		);
	const parameters = new Map<string, string>();
	for (const element of callback.parameters[0]!.name.elements) {
		if (
			element.dotDotDotToken ||
			element.initializer ||
			!ts.isIdentifier(element.name) ||
			(element.propertyName && !ts.isIdentifier(element.propertyName))
		)
			throw new LifecycleDiagnostic(
				"unsupportedLifecycleSyntax",
				phase,
				origin({ ...emptyEnvironment, parameters }, element),
				"use static destructured phase members without defaults or rest",
			);
		const publicName = element.propertyName?.text ?? element.name.text;
		const role = Object.hasOwn(publicMembers[phase], publicName)
			? publicMembers[phase][publicName]
			: undefined;
		if (!role)
			throw new LifecycleDiagnostic(
				"unsupportedLifecycleSyntax",
				phase,
				origin({ ...emptyEnvironment, parameters }, element),
				`use only ${Object.keys(publicMembers[phase]).join(", ")} in ${phase}`,
			);
		parameters.set(element.name.text, role);
	}
	const env: Environment = {
		phase,
		source,
		bindings,
		parameters,
		locals: new Map(),
		bounded: new Set(),
		nextSlot: 0,
	};
	return ts.isBlock(callback.body)
		? lowerStatements(callback.body.statements, env)
		: [{ op: "return", value: lowerExpression(callback.body, env) }];
}

function parseDiagnostics(source: ts.SourceFile): readonly ts.Diagnostic[] {
	return (
		source as ts.SourceFile & {
			readonly parseDiagnostics: readonly ts.Diagnostic[];
		}
	).parseDiagnostics;
}

export function lowerPhase(
	phase: Phase,
	authored: Function | string,
	bindings: Bindings,
	module = "collection.lifecycle.ts",
): readonly Statement[] {
	const text = typeof authored === "function" ? authored.toString() : authored;
	const source = ts.createSourceFile(
		module,
		`const __phase = ${text}`,
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.TS,
	);
	const diagnostics = parseDiagnostics(source);
	if (diagnostics.length) {
		const diagnostic = diagnostics[0]!;
		const point = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
		throw new LifecycleDiagnostic(
			"unsupportedLifecycleSyntax",
			phase,
			{ module, line: point.line + 1, column: point.character + 1 },
			"provide parseable ordinary TypeScript",
		);
	}
	const declaration = source.statements[0];
	if (!declaration || !ts.isVariableStatement(declaration))
		throw new Error("unreachable parser shape");
	const callback = declaration.declarationList.declarations[0]!.initializer;
	if (
		!callback ||
		(!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
	)
		throw new LifecycleDiagnostic(
			"unsupportedLifecycleSyntax",
			phase,
			{ module, line: 1, column: 1 },
			"author a function or arrow callback",
		);
	return lowerCallback(phase, callback, source, bindings);
}

export function lowerPhaseFromModule(
	phase: Phase,
	moduleSource: string,
	exportName: string,
	bindings: Bindings,
	module: string,
): readonly Statement[] {
	const source = ts.createSourceFile(
		module,
		moduleSource,
		ts.ScriptTarget.ESNext,
		true,
		ts.ScriptKind.TS,
	);
	const diagnostics = parseDiagnostics(source);
	if (diagnostics.length) {
		const diagnostic = diagnostics[0]!;
		const point = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
		throw new LifecycleDiagnostic(
			"unsupportedLifecycleSyntax",
			phase,
			{ module, line: point.line + 1, column: point.character + 1 },
			"provide parseable ordinary TypeScript",
		);
	}
	const imported = source.statements.find(
		(statement) =>
			ts.isImportDeclaration(statement) ||
			ts.isImportEqualsDeclaration(statement),
	);
	if (imported) {
		const environment: Environment = {
			phase,
			source,
			bindings,
			parameters: new Map(),
			locals: new Map(),
			bounded: new Set(),
			nextSlot: 0,
		};
		throw new LifecycleDiagnostic(
			"lifecycleCapture",
			phase,
			origin(environment, imported),
			"remove lifecycle imports and use generated phase inputs or capabilities",
		);
	}
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		for (const declaration of statement.declarationList.declarations) {
			if (
				!ts.isIdentifier(declaration.name) ||
				declaration.name.text !== exportName ||
				!declaration.initializer
			)
				continue;
			if (
				!ts.isArrowFunction(declaration.initializer) &&
				!ts.isFunctionExpression(declaration.initializer)
			)
				break;
			return lowerCallback(phase, declaration.initializer, source, bindings);
		}
	}
	throw new LifecycleDiagnostic(
		"unsupportedLifecycleSyntax",
		phase,
		{ module, line: 1, column: 1 },
		`author const ${exportName} as a lifecycle callback`,
	);
}

export function compileArtifact(
	options: Readonly<{
		callbacks: Readonly<Record<Phase, Function | string>>;
		bindings: Bindings;
		runtimeBuild: string;
		reentryLimit: number;
	}>,
): Artifact {
	if (!/^[a-f0-9]{64}$/.test(options.runtimeBuild))
		throw new TypeError("runtimeBuild must be a SHA-256 identity");
	if (
		!Number.isSafeInteger(options.reentryLimit) ||
		options.reentryLimit < 1 ||
		options.reentryLimit > 1024
	)
		throw new TypeError("invalid finite re-entry limit");
	const lowered = Object.fromEntries(
		phases.map((phase) => [
			phase,
			lowerPhase(phase, options.callbacks[phase], options.bindings),
		]),
	) as Record<Phase, readonly Statement[]>;
	const artifact = {
		format: FORMAT,
		interpreter: INTERPRETER,
		runtimeBuild: options.runtimeBuild,
		reentryLimit: options.reentryLimit,
		bindings: options.bindings,
		phases: lowered,
	} as const;
	validateArtifact(artifact);
	return deepFreeze(artifact);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.freeze(value);
		for (const member of Object.values(value)) deepFreeze(member);
	}
	return value;
}

function canonical(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0))
			throw new TypeError(
				"canonical numbers must be finite and not negative zero",
			);
		return JSON.stringify(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (
		value &&
		typeof value === "object" &&
		Object.getPrototypeOf(value) === Object.prototype
	)
		return `{${Object.entries(value)
			.toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`)
			.join(",")}}`;
	throw new TypeError("canonical artifact contains an inadmissible value");
}

export function encodeArtifact(artifact: Artifact): Uint8Array {
	validateArtifact(artifact);
	return new TextEncoder().encode(canonical(artifact));
}

export function artifactDigest(bytes: Uint8Array): string {
	return createHash("sha256").update(DIGEST_DOMAIN).update(bytes).digest("hex");
}

function exactKeys(
	value: object,
	expected: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).toSorted();
	const wanted = [...expected].toSorted();
	if (
		actual.length !== wanted.length ||
		actual.some((key, index) => key !== wanted[index])
	)
		throw new TypeError(`${label} has unknown or missing members`);
}

function requirePlainMap(
	value: unknown,
	label: string,
): asserts value is object {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		throw new TypeError(`${label} must be an exact plain binding map`);
}

function unique(values: readonly unknown[], label: string): void {
	if (new Set(values).size !== values.length)
		throw new TypeError(`${label} identities must be unique`);
}

function validateIdentity(
	value: unknown,
	kind: Identity extends `${infer K}:${string}` ? K : never,
): asserts value is Identity {
	if (
		typeof value !== "string" ||
		!value.startsWith(`${kind}:`) ||
		value.length <= kind.length + 1
	)
		throw new TypeError(`invalid ${kind} identity`);
}

function validateExpression(
	value: unknown,
	bindings: Bindings,
	phase: Phase,
	definedSlots: ReadonlySet<number>,
	capabilityAtRoot = false,
	structuralArgument = false,
): asserts value is Expression {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("invalid expression");
	const expression = value as Record<string, unknown>;
	if (typeof expression.op !== "string")
		throw new TypeError("missing expression opcode");
	const recurse = (member: unknown) =>
		validateExpression(member, bindings, phase, definedSlots);
	if (expression.op === "literal") {
		exactKeys(expression, ["op", "value"], "literal");
		if (
			!(
				expression.value === null ||
				typeof expression.value === "boolean" ||
				typeof expression.value === "string" ||
				(typeof expression.value === "number" &&
					Number.isFinite(expression.value) &&
					!Object.is(expression.value, -0))
			)
		)
			throw new TypeError("invalid finite literal");
		return;
	}
	if (expression.op === "root") {
		exactKeys(expression, ["op", "root"], "root");
		if (!phaseRoots[phase].has(String(expression.root)))
			throw new TypeError(`root is not admitted in ${phase}`);
		return;
	}
	if (expression.op === "local") {
		exactKeys(expression, ["op", "slot"], "local");
		if (
			!Number.isSafeInteger(expression.slot) ||
			(expression.slot as number) < 0 ||
			!definedSlots.has(expression.slot as number)
		)
			throw new TypeError("local slot is invalid or not defined before use");
		return;
	}
	if (expression.op === "optionalBoundary") {
		exactKeys(expression, ["op", "value"], "optional boundary");
		recurse(expression.value);
		return;
	}
	if (expression.op === "member") {
		exactKeys(expression, ["op", "target", "field", "optional"], "member");
		recurse(expression.target);
		validateIdentity(expression.field, "field");
		if (
			!Object.values(bindings.fields).includes(expression.field as Identity) ||
			typeof expression.optional !== "boolean"
		)
			throw new TypeError("unbound field");
		return;
	}
	if (expression.op === "unary") {
		exactKeys(expression, ["op", "operator", "value"], "unary");
		if (!["!", "-"].includes(String(expression.operator)))
			throw new TypeError("invalid unary");
		recurse(expression.value);
		return;
	}
	if (expression.op === "binary") {
		exactKeys(expression, ["op", "operator", "left", "right"], "binary");
		if (!binaryOperators.has(String(expression.operator)))
			throw new TypeError("invalid binary");
		recurse(expression.left);
		recurse(expression.right);
		return;
	}
	if (expression.op === "conditional") {
		exactKeys(expression, ["op", "test", "yes", "no"], "conditional");
		recurse(expression.test);
		recurse(expression.yes);
		recurse(expression.no);
		return;
	}
	if (expression.op === "array") {
		exactKeys(expression, ["op", "values"], "array");
		if (!Array.isArray(expression.values)) throw new TypeError("invalid array");
		expression.values.forEach(recurse);
		return;
	}
	if (expression.op === "object") {
		exactKeys(expression, ["op", "entries"], "object");
		if (!Array.isArray(expression.entries))
			throw new TypeError("invalid object entries");
		for (const entry of expression.entries) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry))
				throw new TypeError("invalid object entry");
			const item = entry as Record<string, unknown>;
			if (item.kind === "spreadInput") exactKeys(item, ["kind"], "spread");
			else if (item.kind === "argument") {
				if (!structuralArgument)
					throw new TypeError(
						"structural argument entry is only admitted inside a capability",
					);
				exactKeys(item, ["kind", "key", "value"], "argument entry");
				if (
					typeof item.key !== "string" ||
					!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.key)
				)
					throw new TypeError("invalid structural argument key");
				validateExpression(
					item.value,
					bindings,
					phase,
					definedSlots,
					false,
					true,
				);
			} else {
				exactKeys(item, ["kind", "field", "value"], "field entry");
				if (item.kind !== "field")
					throw new TypeError("invalid object entry kind");
				validateIdentity(item.field, "field");
				if (!Object.values(bindings.fields).includes(item.field as Identity))
					throw new TypeError("unbound object field");
				recurse(item.value);
			}
		}
		return;
	}
	if (expression.op === "template") {
		exactKeys(expression, ["op", "head", "spans"], "template");
		if (typeof expression.head !== "string" || !Array.isArray(expression.spans))
			throw new TypeError("invalid template");
		for (const span of expression.spans) {
			exactKeys(span as object, ["value", "tail"], "template span");
			recurse((span as Record<string, unknown>).value);
			if (typeof (span as Record<string, unknown>).tail !== "string")
				throw new TypeError("invalid template tail");
		}
		return;
	}
	if (expression.op === "stringMethod") {
		exactKeys(
			expression,
			["op", "method", "target", "arguments", "optional"],
			"method",
		);
		if (
			!stringMethods.has(String(expression.method)) ||
			!Array.isArray(expression.arguments) ||
			typeof expression.optional !== "boolean"
		)
			throw new TypeError("invalid string method");
		const arity = ["trim", "toUpperCase", "toLowerCase"].includes(
			String(expression.method),
		)
			? 0
			: 1;
		if (expression.arguments.length !== arity)
			throw new TypeError("invalid string method arity");
		recurse(expression.target);
		expression.arguments.forEach(recurse);
		return;
	}
	if (expression.op === "capability") {
		if (!capabilityAtRoot)
			throw new TypeError(
				"capability expressions must be top-level sequential statements",
			);
		exactKeys(
			expression,
			["op", "capability", "identity", "arguments"],
			"capability",
		);
		if (
			!["read", "write", "acceptJob"].includes(String(expression.capability)) ||
			!Array.isArray(expression.arguments)
		)
			throw new TypeError("invalid capability");
		if (!phaseCapabilities[phase].has(String(expression.capability)))
			throw new TypeError(`capability is not admitted in ${phase}`);
		const expectedKind =
			expression.capability === "acceptJob" ? "job" : "operation";
		validateIdentity(expression.identity, expectedKind);
		const allowed =
			expression.capability === "acceptJob"
				? bindings.jobs
				: bindings.operations;
		if (!allowed.includes(expression.identity as Identity))
			throw new TypeError("unbound capability identity");
		for (const argument of expression.arguments)
			validateExpression(argument, bindings, phase, definedSlots, false, true);
		const declaration = Object.values(bindings.capabilities).find(
			(binding) =>
				binding.kind === expression.capability &&
				binding.identity === expression.identity,
		);
		if (!declaration) throw new TypeError("unbound capability declaration");
		if (
			expression.arguments.length !== 1 ||
			expression.arguments[0]?.op !== "object"
		)
			throw new TypeError("capability requires one structural argument object");
		const structuralKeys = (
			expression: Expression,
			prefix = "",
		): readonly string[] => {
			if (expression.op !== "object") return [prefix.slice(0, -1)];
			const output: string[] = [];
			for (const entry of expression.entries) {
				if (entry.kind !== "argument")
					throw new TypeError("capability argument is not structural");
				output.push(...structuralKeys(entry.value, `${prefix}${entry.key}.`));
			}
			return output;
		};
		for (const argument of expression.arguments as readonly Expression[]) {
			if (argument.op !== "object") continue;
			const keys = structuralKeys(argument);
			if (
				keys.length !== declaration.argumentKeys.length ||
				keys.some((key, index) => key !== declaration.argumentKeys[index])
			)
				throw new TypeError("capability argument keys do not match binding");
		}
		return;
	}
	throw new TypeError("unknown expression opcode");
}

function validateStatements(
	values: unknown,
	bindings: Bindings,
	phase: Phase,
	definedSlots = new Set<number>(),
	boundedReadSlots = new Set<number>(),
): asserts values is readonly Statement[] {
	if (!Array.isArray(values)) throw new TypeError("invalid statements");
	for (const value of values) {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new TypeError("invalid statement");
		const statement = value as Record<string, unknown>;
		if (statement.op === "const") {
			exactKeys(statement, ["op", "slot", "value"], "const");
			if (
				!Number.isSafeInteger(statement.slot) ||
				(statement.slot as number) < 0 ||
				definedSlots.has(statement.slot as number)
			)
				throw new TypeError("const slot is invalid or already defined");
			validateExpression(statement.value, bindings, phase, definedSlots, true);
			definedSlots.add(statement.slot as number);
			if (
				(statement.value as Expression).op === "capability" &&
				(statement.value as Extract<Expression, { op: "capability" }>)
					.capability === "read"
			) {
				const capability = statement.value as Extract<
					Expression,
					{ op: "capability" }
				>;
				const binding = Object.values(bindings.capabilities).find(
					(candidate) =>
						candidate.kind === "read" &&
						candidate.identity === capability.identity,
				);
				if (binding?.kind === "read" && binding.cardinality === "many")
					boundedReadSlots.add(statement.slot as number);
			}
			continue;
		}
		if (statement.op === "if") {
			exactKeys(statement, ["op", "test", "consequent", "otherwise"], "if");
			validateExpression(statement.test, bindings, phase, definedSlots);
			validateStatements(
				statement.consequent,
				bindings,
				phase,
				new Set(definedSlots),
				new Set(boundedReadSlots),
			);
			validateStatements(
				statement.otherwise,
				bindings,
				phase,
				new Set(definedSlots),
				new Set(boundedReadSlots),
			);
			continue;
		}
		if (statement.op === "return") {
			exactKeys(statement, ["op", "value"], "return");
			if (statement.value !== null)
				validateExpression(statement.value, bindings, phase, definedSlots);
			continue;
		}
		if (statement.op === "throwIssue") {
			if (phase !== "validate" && phase !== "check")
				throw new TypeError(`issue throw is not admitted in ${phase}`);
			exactKeys(statement, ["op", "issue"], "throw");
			validateIdentity(statement.issue, "issue");
			if (!Object.values(bindings.issues).includes(statement.issue as Identity))
				throw new TypeError("unbound issue");
			continue;
		}
		if (statement.op === "effect") {
			exactKeys(statement, ["op", "value"], "effect");
			validateExpression(statement.value, bindings, phase, definedSlots, true);
			if ((statement.value as Expression).op !== "capability")
				throw new TypeError("effect is not capability");
			continue;
		}
		if (statement.op === "forOf") {
			exactKeys(statement, ["op", "slot", "sourceSlot", "body"], "forOf");
			if (
				phase !== "afterWrite" ||
				!Number.isSafeInteger(statement.slot) ||
				(statement.slot as number) < 0 ||
				definedSlots.has(statement.slot as number) ||
				!Number.isSafeInteger(statement.sourceSlot) ||
				(statement.sourceSlot as number) < 0 ||
				!definedSlots.has(statement.sourceSlot as number) ||
				!boundedReadSlots.has(statement.sourceSlot as number)
			)
				throw new TypeError(
					"forOf requires a fresh slot and a prior bounded read result",
				);
			const bodySlots = new Set(definedSlots);
			bodySlots.add(statement.slot as number);
			validateStatements(
				statement.body,
				bindings,
				phase,
				bodySlots,
				new Set(boundedReadSlots),
			);
			continue;
		}
		throw new TypeError("unknown statement opcode");
	}
}

export function validateArtifact(value: unknown): asserts value is Artifact {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("invalid artifact");
	const artifact = value as Record<string, unknown>;
	exactKeys(
		artifact,
		[
			"format",
			"interpreter",
			"runtimeBuild",
			"reentryLimit",
			"bindings",
			"phases",
		],
		"artifact",
	);
	if (
		artifact.format !== FORMAT ||
		artifact.interpreter !== INTERPRETER ||
		typeof artifact.runtimeBuild !== "string" ||
		!/^[a-f0-9]{64}$/.test(artifact.runtimeBuild) ||
		!Number.isSafeInteger(artifact.reentryLimit) ||
		(artifact.reentryLimit as number) < 1 ||
		(artifact.reentryLimit as number) > 1024
	)
		throw new TypeError("incompatible artifact header");
	if (
		!artifact.bindings ||
		typeof artifact.bindings !== "object" ||
		Array.isArray(artifact.bindings)
	)
		throw new TypeError("invalid bindings");
	const bindings = artifact.bindings as unknown as Bindings;
	exactKeys(
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
		"bindings",
	);
	validateIdentity(bindings.schema, "schema");
	validateIdentity(bindings.collection, "collection");
	requirePlainMap(bindings.fields, "Field bindings");
	requirePlainMap(bindings.issues, "issue bindings");
	requirePlainMap(bindings.capabilities, "capability bindings");
	for (const identity of Object.values(bindings.fields))
		validateIdentity(identity, "field");
	for (const identity of Object.values(bindings.issues))
		validateIdentity(identity, "issue");
	unique(Object.values(bindings.fields), "Field");
	unique(Object.values(bindings.issues), "issue");
	if (!Array.isArray(bindings.operations) || !Array.isArray(bindings.jobs))
		throw new TypeError("invalid operation/job bindings");
	bindings.operations.forEach((identity) =>
		validateIdentity(identity, "operation"),
	);
	bindings.jobs.forEach((identity) => validateIdentity(identity, "job"));
	unique(bindings.operations, "Operation");
	unique(bindings.jobs, "Job");
	for (const [name, capability] of Object.entries(bindings.capabilities)) {
		if (!name || !capability || typeof capability !== "object")
			throw new TypeError("invalid capability binding");
		if (Object.getPrototypeOf(capability) !== Object.prototype)
			throw new TypeError("capability binding must be a plain object");
		if (!["read", "write", "acceptJob"].includes(capability.kind))
			throw new TypeError("invalid capability kind");
		if (capability.kind === "read") {
			exactKeys(
				capability,
				["kind", "identity", "argumentKeys", "cardinality", "first", "maxRows"],
				"read capability binding",
			);
			if (
				!Array.isArray(capability.argumentKeys) ||
				!capability.argumentKeys.every(
					(key) =>
						typeof key === "string" &&
						/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(key),
				) ||
				new Set(capability.argumentKeys).size !==
					capability.argumentKeys.length ||
				!["one", "many"].includes(capability.cardinality) ||
				typeof capability.first !== "boolean" ||
				!Number.isSafeInteger(capability.maxRows) ||
				capability.maxRows < 1 ||
				capability.maxRows > 10_000 ||
				(capability.cardinality === "one" &&
					(!capability.first || capability.maxRows !== 1)) ||
				(capability.cardinality === "many" && capability.first)
			)
				throw new TypeError("invalid bounded read capability binding");
		} else {
			exactKeys(
				capability,
				["kind", "identity", "argumentKeys"],
				"effect capability binding",
			);
			if (
				!Array.isArray(capability.argumentKeys) ||
				!capability.argumentKeys.every(
					(key) =>
						typeof key === "string" &&
						/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(key),
				) ||
				new Set(capability.argumentKeys).size !== capability.argumentKeys.length
			)
				throw new TypeError("invalid capability argument binding");
		}
		validateIdentity(
			capability.identity,
			capability.kind === "acceptJob" ? "job" : "operation",
		);
		const identities =
			capability.kind === "acceptJob" ? bindings.jobs : bindings.operations;
		if (!identities.includes(capability.identity))
			throw new TypeError("unbound capability binding");
	}
	if (
		!artifact.phases ||
		typeof artifact.phases !== "object" ||
		Array.isArray(artifact.phases)
	)
		throw new TypeError("invalid phases");
	exactKeys(artifact.phases as object, phases, "phases");
	for (const phase of phases)
		validateStatements(
			(artifact.phases as Record<string, unknown>)[phase],
			bindings,
			phase,
		);
}

export function decodeArtifact(
	bytes: Uint8Array,
	expected: ExpectedArtifactContract,
): Artifact {
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
	} catch {
		throw new TypeError("artifact is not exact UTF-8 JSON");
	}
	validateArtifact(parsed);
	if (
		parsed.interpreter !== (expected.interpreter ?? INTERPRETER) ||
		parsed.runtimeBuild !== expected.runtimeBuild ||
		canonical(parsed.bindings) !== canonical(expected.bindings)
	)
		throw new TypeError("artifact compatibility binding mismatch");
	const exact = encodeArtifact(parsed);
	if (Buffer.compare(Buffer.from(bytes), Buffer.from(exact)) !== 0)
		throw new TypeError("artifact is not canonically encoded");
	return deepFreeze(parsed);
}

export function loadArtifact(
	bytes: Uint8Array,
	digest: string,
	expected: Parameters<typeof decodeArtifact>[1],
): Artifact {
	if (!/^[a-f0-9]{64}$/.test(digest) || artifactDigest(bytes) !== digest)
		throw new TypeError("artifact digest mismatch");
	return decodeArtifact(bytes, expected);
}

export class InterpretedIssue extends Error {
	constructor(readonly identity: Identity) {
		super("Collection lifecycle issue");
	}
}

export async function executePhase(
	artifact: Artifact,
	phase: Phase,
	inputs: readonly unknown[],
	capabilities: OperationAdapter,
	budget: ExecutionBudget,
): Promise<unknown> {
	validateArtifact(artifact);
	const assertBudget = (): void => {
		if (budget.signal.aborted) throw new DOMException("Aborted", "AbortError");
		const now = budget.clock();
		if (now > budget.deadline)
			throw new TypeError("execution deadline exceeded");
		if (now - budget.startedAt > budget.maxDurationMilliseconds)
			throw new TypeError("execution duration budget exceeded");
	};
	assertBudget();
	budget.artifactReentry += 1;
	if (
		budget.artifactReentry > budget.maxArtifactReentry ||
		budget.artifactReentry > artifact.reentryLimit
	) {
		budget.artifactReentry -= 1;
		throw new TypeError("artifact re-entry budget exceeded");
	}
	try {
		const fields = new Map(
			Object.entries(artifact.bindings.fields).map(([name, identity]) => [
				identity,
				name,
			]),
		);
		const runtimeRootOrder: Record<Phase, readonly string[]> = {
			normalize: ["input"],
			validate: ["candidate", "current", "now", "issues"],
			check: ["candidate", "current", "now", "issues", "capabilities"],
			afterWrite: ["written", "previous", "now", "capabilities", "callId"],
		};
		const rootValues = new Map(
			runtimeRootOrder[phase].map((role, index) => [role, inputs[index]]),
		);
		if (
			phase === "afterWrite" &&
			(typeof rootValues.get("callId") !== "string" ||
				(rootValues.get("callId") as string).length === 0)
		)
			throw new TypeError("afterWrite requires immutable root callId");
		const locals = new Map<number, unknown>();
		const finiteDomain = (
			value: unknown,
			label: string,
			seen = new WeakSet<object>(),
		): unknown => {
			if (value === OPTIONAL_ABSENCE)
				throw new TypeError("optional absence cannot escape the interpreter");
			if (value === VOID_RESULT)
				throw new TypeError("void result cannot escape the interpreter");
			if (value === null || typeof value === "boolean") return value;
			if (typeof value === "string") return value;
			if (typeof value === "number") {
				if (!Number.isFinite(value) || Object.is(value, -0))
					throw new TypeError(`${label} left the closed runtime domain`);
				return value;
			}
			if (typeof value !== "object")
				throw new TypeError(`${label} left the closed runtime domain`);
			if (nodeTypes.isProxy(value))
				throw new TypeError(`${label} left the closed runtime domain`);
			if (value instanceof Date) {
				if (
					Object.getPrototypeOf(value) !== Date.prototype ||
					!Number.isFinite(value.getTime()) ||
					Reflect.ownKeys(value).length !== 0
				)
					throw new TypeError(`${label} left the closed runtime domain`);
				return value;
			}
			if (seen.has(value))
				throw new TypeError(`${label} left the closed runtime domain`);
			seen.add(value);
			if (Array.isArray(value)) {
				if (value.length > MAX_RUNTIME_ARRAY_LENGTH)
					throw new TypeError(`${label} left the closed runtime domain`);
				const keys = Reflect.ownKeys(value);
				if (
					keys.length !== value.length + 1 ||
					keys.some(
						(key, index) =>
							key !== (index < value.length ? String(index) : "length"),
					)
				)
					throw new TypeError(`${label} left the closed runtime domain`);
				for (let index = 0; index < value.length; index++) {
					if (!Object.hasOwn(value, index))
						throw new TypeError(`${label} left the closed runtime domain`);
					finiteDomain(value[index], label, seen);
				}
				seen.delete(value);
				return value;
			}
			if (Object.getPrototypeOf(value) !== Object.prototype)
				throw new TypeError(`${label} left the closed runtime domain`);
			for (const key of Reflect.ownKeys(value)) {
				if (typeof key !== "string")
					throw new TypeError(`${label} left the closed runtime domain`);
				const descriptor = Object.getOwnPropertyDescriptor(value, key);
				if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
					throw new TypeError(`${label} left the closed runtime domain`);
				finiteDomain(descriptor.value, label, seen);
			}
			seen.delete(value);
			return value;
		};
		const member = (
			target: unknown,
			identity: Identity,
			optional: boolean,
		): unknown => {
			if (target === OPTIONAL_ABSENCE) return OPTIONAL_ABSENCE;
			if (target === null || target === undefined) {
				if (optional) return OPTIONAL_ABSENCE;
				throw new TypeError("static member target is absent");
			}
			if (typeof target !== "object")
				throw new TypeError("static member target is not an object");
			const name = fields.get(identity);
			if (!name) throw new TypeError("unbound interpreted Field");
			return (target as Record<string, unknown>)[name];
		};
		const evaluate = async (expression: Expression): Promise<unknown> => {
			assertBudget();
			switch (expression.op) {
				case "literal":
					return expression.value;
				case "root":
					return rootValues.get(expression.root) === undefined
						? undefined
						: finiteDomain(
								rootValues.get(expression.root),
								`${expression.root} root`,
							);
				case "local":
					return locals.get(expression.slot);
				case "optionalBoundary": {
					const value = await evaluate(expression.value);
					return value === OPTIONAL_ABSENCE ? undefined : value;
				}
				case "member":
					return member(
						await evaluate(expression.target),
						expression.field,
						expression.optional,
					);
				case "unary": {
					const value = await evaluate(expression.value);
					if (expression.operator === "!")
						return value === OPTIONAL_ABSENCE ? true : !value;
					if (typeof value !== "number")
						throw new TypeError("unary numeric operand is not a number");
					return finiteDomain(-value, "unary result");
				}
				case "binary": {
					const left = await evaluate(expression.left);
					if (expression.operator === "&&")
						return left === OPTIONAL_ABSENCE
							? OPTIONAL_ABSENCE
							: left && (await evaluate(expression.right));
					if (expression.operator === "||")
						return left === OPTIONAL_ABSENCE
							? evaluate(expression.right)
							: left || (await evaluate(expression.right));
					if (expression.operator === "??")
						return left === OPTIONAL_ABSENCE ||
							left === undefined ||
							left === null
							? evaluate(expression.right)
							: left;
					const right = await evaluate(expression.right);
					const ordinaryLeft = left === OPTIONAL_ABSENCE ? undefined : left;
					const ordinaryRight = right === OPTIONAL_ABSENCE ? undefined : right;
					switch (expression.operator) {
						case "+": {
							if (
								typeof ordinaryLeft === "string" &&
								typeof ordinaryRight === "string"
							)
								return ordinaryLeft + ordinaryRight;
							if (
								typeof ordinaryLeft !== "number" ||
								typeof ordinaryRight !== "number"
							)
								throw new TypeError(
									"addition operands have incompatible domains",
								);
							return finiteDomain(
								ordinaryLeft + ordinaryRight,
								"addition result",
							);
						}
						case "-":
						case "*":
						case "/":
						case "%": {
							if (
								typeof ordinaryLeft !== "number" ||
								typeof ordinaryRight !== "number"
							)
								throw new TypeError("arithmetic operands are not numbers");
							const value =
								expression.operator === "-"
									? ordinaryLeft - ordinaryRight
									: expression.operator === "*"
										? ordinaryLeft * ordinaryRight
										: expression.operator === "/"
											? ordinaryLeft / ordinaryRight
											: ordinaryLeft % ordinaryRight;
							return finiteDomain(value, "arithmetic result");
						}
						case "===":
							return ordinaryLeft === ordinaryRight;
						case "!==":
							return ordinaryLeft !== ordinaryRight;
						case "<":
							return (ordinaryLeft as number) < (ordinaryRight as number);
						case "<=":
							return (ordinaryLeft as number) <= (ordinaryRight as number);
						case ">":
							return (ordinaryLeft as number) > (ordinaryRight as number);
						case ">=":
							return (ordinaryLeft as number) >= (ordinaryRight as number);
						default:
							throw new TypeError("unknown binary operator");
					}
				}
				case "conditional": {
					const test = await evaluate(expression.test);
					return test !== OPTIONAL_ABSENCE && test
						? evaluate(expression.yes)
						: evaluate(expression.no);
				}
				case "array": {
					const result: unknown[] = [];
					for (const value of expression.values)
						result.push(await evaluate(value));
					return finiteDomain(result, "computed array");
				}
				case "object": {
					const result: Record<string, unknown> = {};
					for (const entry of expression.entries) {
						if (entry.kind === "spreadInput")
							Object.assign(result, rootValues.get("input"));
						else {
							if (entry.kind === "argument")
								result[entry.key] = await evaluate(entry.value);
							else {
								const name = fields.get(entry.field);
								if (!name) throw new TypeError("unbound object Field");
								result[name] = await evaluate(entry.value);
							}
						}
					}
					return finiteDomain(Object.freeze(result), "computed object");
				}
				case "template": {
					let result = expression.head;
					for (const span of expression.spans) {
						const value = await evaluate(span.value);
						if (value === OPTIONAL_ABSENCE || value === undefined)
							throw new TypeError(
								"template value left the closed runtime domain",
							);
						result += String(value) + span.tail;
					}
					return result;
				}
				case "stringMethod": {
					const target = await evaluate(expression.target);
					if (target === OPTIONAL_ABSENCE) return OPTIONAL_ABSENCE;
					if ((target === null || target === undefined) && expression.optional)
						return OPTIONAL_ABSENCE;
					if (typeof target !== "string")
						throw new TypeError("string method target is not a string");
					const argumentValues: unknown[] = [];
					for (const argument of expression.arguments)
						argumentValues.push(
							finiteDomain(await evaluate(argument), "string method argument"),
						);
					if (argumentValues.some((argument) => typeof argument !== "string"))
						throw new TypeError("string method argument is not a string");
					switch (expression.method) {
						case "trim":
							return target.trim();
						case "toUpperCase":
							return target.toUpperCase();
						case "toLowerCase":
							return target.toLowerCase();
						case "startsWith":
							return target.startsWith(String(argumentValues[0]));
						case "endsWith":
							return target.endsWith(String(argumentValues[0]));
						case "includes":
							return target.includes(String(argumentValues[0]));
						default:
							throw new TypeError("unknown string method");
					}
				}
				case "capability": {
					const invoke = capabilities[expression.identity];
					if (!invoke) throw new TypeError("withheld capability");
					budget.dependencies += 1;
					if (budget.dependencies > budget.maxDependencies)
						throw new TypeError("dependency budget exceeded");
					budget.statements += 1;
					if (budget.statements > budget.maxStatements)
						throw new TypeError("statement budget exceeded");
					const argumentValues: unknown[] = [];
					for (const argument of expression.arguments)
						argumentValues.push(
							finiteDomain(await evaluate(argument), "capability argument"),
						);
					assertBudget();
					const result = await invoke({
						arguments: argumentValues,
						budget,
						artifact,
					});
					assertBudget();
					const declaration = Object.values(
						artifact.bindings.capabilities,
					).find(
						(binding) =>
							binding.kind === expression.capability &&
							binding.identity === expression.identity,
					);
					if (!declaration) throw new TypeError("unbound runtime capability");
					if (declaration.kind === "read") {
						const count = Array.isArray(result)
							? result.length
							: result == null
								? 0
								: 1;
						if (
							(declaration.cardinality === "one" && Array.isArray(result)) ||
							(declaration.cardinality === "many" && !Array.isArray(result)) ||
							count > declaration.maxRows
						)
							throw new TypeError("read cardinality binding violated");
						budget.rows += count;
						if (budget.rows > budget.maxRows)
							throw new TypeError("row budget exceeded");
					}
					if (result === undefined && declaration.kind !== "read")
						return VOID_RESULT;
					return finiteDomain(result, "capability result");
				}
			}
		};
		type Control = Readonly<{
			returned: boolean;
			hasValue: boolean;
			value: unknown;
		}>;
		const run = async (statements: readonly Statement[]): Promise<Control> => {
			for (const statement of statements) {
				assertBudget();
				if (statement.op === "const") {
					locals.set(statement.slot, await evaluate(statement.value));
					continue;
				}
				if (statement.op === "if") {
					const test = await evaluate(statement.test);
					const result = await run(
						test !== OPTIONAL_ABSENCE && test
							? statement.consequent
							: statement.otherwise,
					);
					if (result.returned) return result;
					continue;
				}
				if (statement.op === "return")
					return {
						returned: true,
						hasValue: statement.value !== null,
						value:
							statement.value === null
								? undefined
								: await evaluate(statement.value),
					};
				if (statement.op === "throwIssue")
					throw new InterpretedIssue(statement.issue);
				if (statement.op === "effect") {
					await evaluate(statement.value);
					continue;
				}
				const source = locals.get(statement.sourceSlot);
				if (!Array.isArray(source))
					throw new TypeError("bounded result is not an array");
				for (const item of source) {
					locals.set(statement.slot, item);
					const result = await run(statement.body);
					if (result.returned) return result;
				}
			}
			return { returned: false, hasValue: false, value: undefined };
		};
		const result = await run(artifact.phases[phase]);
		return result.returned && result.hasValue
			? finiteDomain(result.value, `${phase} result`)
			: undefined;
	} finally {
		budget.artifactReentry -= 1;
	}
}
