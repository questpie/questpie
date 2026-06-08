/**
 * STATIC AST scan of a mini-app `server.ts` for its OPT-IN action registry, its
 * inline `manifest`, and its cron exports — WITHOUT executing the untrusted
 * guest source.
 *
 * v2 (`.private/miniapps-v2-design.md` ★ RESOLVED + §3.2): the HTTP surface is
 * OPT-IN via an explicit `export const actions = { … }` object literal, NOT
 * inferred from "every export" (the corrected Val Town lesson — an export is
 * HTTP-callable only if it opts in). The resolver determines the callable surface
 * from the KEYS of that object, read STATICALLY.
 *
 * WHY THE TYPESCRIPT COMPILER, NOT A REGEX OR `acorn`:
 *   - The old `export-scan.ts` is a REGEX scan whose own docstring concedes it is
 *     "a syntactic scan, not a parse … acceptable for the trusted-guest MVP" — it
 *     can yield phantom names from strings/comments and cannot read an object's
 *     keys. That is unacceptable for the UNTRUSTED HTTP surface (a phantom or
 *     missed key changes what is reachable).
 *   - `acorn` parses JS, not TS — `server.ts` carries TS syntax (type annotations,
 *     `import type`, generics). The TypeScript compiler API (`ts.createSourceFile`)
 *     is ALREADY a workspace dependency, parses TS natively, and NEVER executes
 *     the source (it only builds an AST). So it is the correct no-`eval` parser.
 *
 * FAIL-CLOSED posture (security): anything the static parse CANNOT resolve to a
 * concrete, safe string key is surfaced as a flag, and the resolver REJECTS the
 * bundle rather than guess:
 *   - a spread (`...x`) or computed (`[k]`) property in `actions` → `hadSpread` /
 *     `hadComputed` (the real key set is not statically knowable);
 *   - `actions` not assigned a plain object literal → `actionsIsLiteral:false`;
 *   - a key colliding with a reserved framework name is reported verbatim so the
 *     resolver can reject it (it is NOT silently dropped here).
 */

import ts from "typescript";

/** Result of {@link scanServerModule}. */
export interface ScannedServerModule {
	/** True iff a top-level `export const manifest = …` exists. */
	hasManifestExport: boolean;
	/** True iff a top-level `export const actions = …` exists. */
	hasActionsExport: boolean;
	/**
	 * True iff `export const actions` is initialized with a plain OBJECT LITERAL
	 * (`{ … }`). When false (e.g. `export const actions = build()`), the key set is
	 * not statically knowable and the resolver MUST fail closed.
	 */
	actionsIsLiteral: boolean;
	/**
	 * Statically-resolved keys of the `actions` object literal (identifier or
	 * string-literal property names, and method-shorthand names). Excludes spread
	 * / computed entries (see {@link hadSpread} / {@link hadComputed}).
	 */
	actionKeys: string[];
	/** True iff the `actions` literal contained a spread (`...x`) entry. */
	hadSpread: boolean;
	/** True iff the `actions` literal contained a computed (`[expr]`) key. */
	hadComputed: boolean;
	/**
	 * Per top-level `const NAME = defineAction({ … })`, whether that call's options
	 * object literal statically declares an `input` property (the host-visible
	 * signal that the action carries an input schema). Maps the VARIABLE name; the
	 * resolver joins it to the registry keys (a key whose value is that variable).
	 */
	defineActionInputByVar: Record<string, boolean>;
	/**
	 * True iff the module has an `export default` (function/class/assignment). The
	 * v2 registry does NOT expose `default` as HTTP (it is reserved — a default
	 * handler is treated as cron, per §3.2); reported so the resolver can detect a
	 * reserved-name collision against it.
	 */
	hasDefault: boolean;
}

/** True for a `defineAction(...)` call expression. */
function isDefineActionCall(node: ts.Expression | undefined): node is ts.CallExpression {
	return (
		!!node &&
		ts.isCallExpression(node) &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === "defineAction"
	);
}

/** True iff a `defineAction({ … })` first-arg literal declares an `input` property. */
function defineActionDeclaresInput(call: ts.CallExpression): boolean {
	const arg = call.arguments[0];
	if (!arg || !ts.isObjectLiteralExpression(arg)) return false;
	return arg.properties.some(
		(p) =>
			(ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
			p.name !== undefined &&
			ts.isIdentifier(p.name) &&
			p.name.text === "input",
	);
}

/** Read an object-literal property's static key name, or `null` if not static. */
function staticPropKey(prop: ts.ObjectLiteralElementLike): string | null {
	if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
	if (
		ts.isPropertyAssignment(prop) ||
		ts.isMethodDeclaration(prop) ||
		ts.isGetAccessorDeclaration(prop) ||
		ts.isSetAccessorDeclaration(prop)
	) {
		const name = prop.name;
		if (ts.isIdentifier(name)) return name.text;
		if (ts.isStringLiteral(name)) return name.text;
		if (ts.isNumericLiteral(name)) return name.text;
		// Computed (`[expr]`) or private (`#x`) — not a static string key.
		return null;
	}
	return null;
}

/**
 * Parse a mini-app `server.ts` into its static export/registry shape. Does NOT
 * execute the source — it builds a TypeScript AST and walks the top-level
 * statements only.
 */
export function scanServerModule(source: string): ScannedServerModule {
	const sf = ts.createSourceFile(
		"server.ts",
		source,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		ts.ScriptKind.TS,
	);

	const out: ScannedServerModule = {
		hasManifestExport: false,
		hasActionsExport: false,
		actionsIsLiteral: false,
		actionKeys: [],
		hadSpread: false,
		hadComputed: false,
		defineActionInputByVar: {},
		hasDefault: false,
	};

	const hasExportModifier = (node: ts.HasModifiers): boolean =>
		ts.canHaveModifiers(node) &&
		(ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
			false);
	const hasDefaultModifier = (node: ts.HasModifiers): boolean =>
		ts.canHaveModifiers(node) &&
		(ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ??
			false);

	// Pass 1: index every top-level `const NAME = defineAction({ … })` (whether or
	// not it is exported — the registry may reference a non-exported local).
	for (const stmt of sf.statements) {
		if (!ts.isVariableStatement(stmt)) continue;
		for (const decl of stmt.declarationList.declarations) {
			if (!ts.isIdentifier(decl.name)) continue;
			if (decl.initializer && isDefineActionCall(decl.initializer)) {
				out.defineActionInputByVar[decl.name.text] =
					defineActionDeclaresInput(decl.initializer);
			}
		}
	}

	// Pass 2: the exported surface (manifest / actions / default).
	for (const stmt of sf.statements) {
		if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
			for (const decl of stmt.declarationList.declarations) {
				if (!ts.isIdentifier(decl.name)) continue;
				const name = decl.name.text;
				if (name === "manifest") out.hasManifestExport = true;
				if (name === "actions") {
					out.hasActionsExport = true;
					const init = decl.initializer;
					if (init && ts.isObjectLiteralExpression(init)) {
						out.actionsIsLiteral = true;
						for (const prop of init.properties) {
							if (ts.isSpreadAssignment(prop)) {
								out.hadSpread = true;
								continue;
							}
							const key = staticPropKey(prop);
							if (key === null) {
								out.hadComputed = true;
								continue;
							}
							out.actionKeys.push(key);
						}
					} else {
						out.actionsIsLiteral = false;
					}
				}
			}
			continue;
		}
		if (
			(ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
			hasExportModifier(stmt) &&
			hasDefaultModifier(stmt)
		) {
			out.hasDefault = true;
			continue;
		}
		if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
			out.hasDefault = true;
		}
	}

	return out;
}
