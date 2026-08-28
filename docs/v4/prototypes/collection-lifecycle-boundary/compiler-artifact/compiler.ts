import { createHash } from "node:crypto";

import ts from "typescript";

export const FORMAT = "questpie.lifecycle-program.v1" as const;
export const INTERPRETER = "questpie.lifecycle-interpreter.v1" as const;
const DIGEST_DOMAIN = "questpie.collection-lifecycle-program.v1\0";

export type Phase = "normalize" | "validate" | "check" | "afterWrite";
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
			root: "input" | "candidate" | "current" | "written" | "previous" | "now";
	  }>
	| Readonly<{ op: "local"; slot: number }>
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
	  }>
	| Readonly<{
			op: "capability";
			capability: "read" | "write" | "acceptJob";
			identity: Identity;
			arguments: readonly Expression[];
	  }>;

export type ObjectEntry =
	| Readonly<{ kind: "field"; field: Identity; value: Expression }>
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
			Readonly<{ kind: "read" | "write" | "acceptJob"; identity: Identity }>
		>
	>;
	operations: readonly Identity[];
	jobs: readonly Identity[];
}>;

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
	afterWrite: new Set(["written", "previous", "now"]),
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
	if (ts.isParenthesizedExpression(node))
		return lowerExpression(node.expression, env);
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
			node.name.text === "now"
		)
			return { op: "root", root: "now" };
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
		)
			return {
				op: "stringMethod",
				method: node.expression.name.text as StringMethod,
				target: lowerExpression(node.expression.expression, env),
				arguments: node.arguments.map((argument) =>
					lowerExpression(argument, env),
				),
			};
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
	return {
		op: "capability",
		capability: declared.kind,
		identity: declared.identity,
		arguments: node.arguments.map((argument) => lowerExpression(argument, env)),
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
			if (value.op === "capability" && value.capability === "read")
				env.bounded.add(slot);
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
	return deepFreeze({
		format: FORMAT,
		interpreter: INTERPRETER,
		runtimeBuild: options.runtimeBuild,
		reentryLimit: options.reentryLimit,
		bindings: options.bindings,
		phases: lowered,
	});
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
			else {
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
		exactKeys(expression, ["op", "method", "target", "arguments"], "method");
		if (
			!stringMethods.has(String(expression.method)) ||
			!Array.isArray(expression.arguments)
		)
			throw new TypeError("invalid string method");
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
		expression.arguments.forEach(recurse);
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
			)
				boundedReadSlots.add(statement.slot as number);
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
		exactKeys(capability, ["kind", "identity"], "capability binding");
		if (!["read", "write", "acceptJob"].includes(capability.kind))
			throw new TypeError("invalid capability kind");
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
	expected: Readonly<{
		runtimeBuild: string;
		schema: Identity;
		collection: Identity;
		interpreter?: string;
	}>,
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
		parsed.bindings.schema !== expected.schema ||
		parsed.bindings.collection !== expected.collection
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
	capabilities: Readonly<
		Record<
			string,
			(...argumentValues: readonly unknown[]) => unknown | Promise<unknown>
		>
	> = {},
): Promise<unknown> {
	validateArtifact(artifact);
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
		afterWrite: ["written", "previous", "now", "capabilities"],
	};
	const rootValues = new Map(
		runtimeRootOrder[phase].map((role, index) => [role, inputs[index]]),
	);
	const locals = new Map<number, unknown>();
	const member = (
		target: unknown,
		identity: Identity,
		optional: boolean,
	): unknown => {
		if (target === null || target === undefined) {
			if (optional) return undefined;
			throw new TypeError("static member target is absent");
		}
		if (typeof target !== "object")
			throw new TypeError("static member target is not an object");
		const name = fields.get(identity);
		if (!name) throw new TypeError("unbound interpreted Field");
		return (target as Record<string, unknown>)[name];
	};
	const evaluate = async (expression: Expression): Promise<unknown> => {
		switch (expression.op) {
			case "literal":
				return expression.value;
			case "root":
				return rootValues.get(expression.root);
			case "local":
				return locals.get(expression.slot);
			case "member":
				return member(
					await evaluate(expression.target),
					expression.field,
					expression.optional,
				);
			case "unary": {
				const value = await evaluate(expression.value);
				return expression.operator === "!" ? !value : -(value as number);
			}
			case "binary": {
				const left = await evaluate(expression.left);
				if (expression.operator === "&&")
					return left && (await evaluate(expression.right));
				if (expression.operator === "||")
					return left || (await evaluate(expression.right));
				if (expression.operator === "??")
					return left ?? (await evaluate(expression.right));
				const right = await evaluate(expression.right);
				switch (expression.operator) {
					case "+":
						return (left as number) + (right as number);
					case "-":
						return (left as number) - (right as number);
					case "*":
						return (left as number) * (right as number);
					case "/":
						return (left as number) / (right as number);
					case "%":
						return (left as number) % (right as number);
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
					default:
						throw new TypeError("unknown binary operator");
				}
			}
			case "conditional":
				return (await evaluate(expression.test))
					? evaluate(expression.yes)
					: evaluate(expression.no);
			case "array":
				return Promise.all(expression.values.map(evaluate));
			case "object": {
				const result: Record<string, unknown> = {};
				for (const entry of expression.entries) {
					if (entry.kind === "spreadInput")
						Object.assign(result, rootValues.get("input"));
					else {
						const name = fields.get(entry.field);
						if (!name) throw new TypeError("unbound object Field");
						result[name] = await evaluate(entry.value);
					}
				}
				return Object.freeze(result);
			}
			case "template": {
				let result = expression.head;
				for (const span of expression.spans)
					result += String(await evaluate(span.value)) + span.tail;
				return result;
			}
			case "stringMethod": {
				const target = await evaluate(expression.target);
				if (typeof target !== "string")
					throw new TypeError("string method target is not a string");
				const argumentValues = await Promise.all(
					expression.arguments.map(evaluate),
				);
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
				return invoke(
					...(await Promise.all(expression.arguments.map(evaluate))),
				);
			}
		}
	};
	type Control = Readonly<{ returned: boolean; value: unknown }>;
	const run = async (statements: readonly Statement[]): Promise<Control> => {
		for (const statement of statements) {
			if (statement.op === "const") {
				locals.set(statement.slot, await evaluate(statement.value));
				continue;
			}
			if (statement.op === "if") {
				const result = await run(
					(await evaluate(statement.test))
						? statement.consequent
						: statement.otherwise,
				);
				if (result.returned) return result;
				continue;
			}
			if (statement.op === "return")
				return {
					returned: true,
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
		return { returned: false, value: undefined };
	};
	return (await run(artifact.phases[phase])).value;
}
