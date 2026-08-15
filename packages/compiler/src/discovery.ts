import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	basename,
	dirname,
	extname,
	join,
	relative,
	resolve,
	sep,
} from "node:path";

import ts from "typescript";

import { compareAscii } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import type {
	ApplicationConfiguration,
	EvaluatedExport,
	PackageResolution,
	SourceSpan,
} from "./types";

const FACTORIES = new Set([
	"defineAction",
	"defineJob",
	"defineMutation",
	"defineQuery",
	"defineReaction",
	"defineRoute",
	"defineWorkflow",
]);

function logicalPath(root: string, path: string): string {
	return relative(root, path).split(sep).join("/").normalize("NFC");
}

function exclusionPattern(pattern: string): RegExp {
	let source = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "*") {
			if (pattern[index + 1] === "*") {
				source += ".*";
				index += 1;
			} else source += "[^/]*";
		} else if (character === "?") source += "[^/]";
		else source += character?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") ?? "";
	}
	return new RegExp(`${source}$`, "u");
}

export async function discoverSourceFiles(
	applicationRoot: string,
	configuration: ApplicationConfiguration,
): Promise<string[]> {
	const sourceRoot = resolve(applicationRoot, configuration.source.root);
	const exclusions = configuration.source.exclude.map(exclusionPattern);
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) {
				if (
					["__fixtures__", "__tests__", "fixtures", ".questpie"].includes(
						entry.name,
					)
				)
					continue;
				await visit(path);
				continue;
			}
			if (!entry.isFile() || !/\.(?:mts|tsx|ts)$/.test(entry.name)) continue;
			if (/\.d\.ts$|\.(?:spec|test)\./.test(entry.name)) continue;
			if (
				exclusions.some((pattern) =>
					pattern.test(logicalPath(sourceRoot, path)),
				)
			)
				continue;
			files.push(path);
		}
	}
	await visit(sourceRoot);
	return files.sort((left, right) =>
		compareAscii(
			logicalPath(applicationRoot, left),
			logicalPath(applicationRoot, right),
		),
	);
}

function valueImportNames(node: ts.ImportDeclaration): string[] {
	const clause = node.importClause;
	if (!clause || clause.isTypeOnly) return [];
	const names: string[] = [];
	if (clause.name) names.push("default");
	if (clause.namedBindings) {
		if (ts.isNamespaceImport(clause.namedBindings)) names.push("*");
		else
			for (const element of clause.namedBindings.elements)
				if (!element.isTypeOnly)
					names.push((element.propertyName ?? element.name).text);
	}
	return names;
}

function sourceSpan(source: ts.SourceFile, node: ts.Node): SourceSpan {
	const start = source.getLineAndCharacterOfPosition(node.getStart(source));
	const end = source.getLineAndCharacterOfPosition(node.getEnd());
	return {
		start: { line: start.line + 1, column: start.character + 1 },
		end: { line: end.line + 1, column: end.character + 1 },
	};
}

interface ExportMetadata {
	readonly span: SourceSpan;
	readonly memberSpans: Readonly<Record<string, SourceSpan>>;
	readonly acceptanceSpans: readonly (SourceSpan | null)[];
}

function propertyName(node: ts.PropertyName | undefined): string | null {
	if (!node) return null;
	if (
		ts.isIdentifier(node) ||
		ts.isStringLiteral(node) ||
		ts.isNumericLiteral(node)
	)
		return node.text;
	return null;
}

async function directExportMetadata(
	applicationRoot: string,
	files: readonly string[],
): Promise<Map<string, ExportMetadata>> {
	const metadata = new Map<string, ExportMetadata>();
	for (const path of files) {
		const source = ts.createSourceFile(
			path,
			await readFile(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		for (const statement of source.statements) {
			if (
				!ts.isVariableStatement(statement) ||
				!statement.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
				)
			)
				continue;
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
					continue;
				const memberSpans: Record<string, SourceSpan> = {};
				const acceptanceSpans: Array<SourceSpan | null> = [];
				if (
					ts.isCallExpression(declaration.initializer) &&
					declaration.initializer.arguments[0] &&
					ts.isObjectLiteralExpression(declaration.initializer.arguments[0])
				) {
					const definition = declaration.initializer.arguments[0];
					for (const property of definition.properties) {
						if (!ts.isPropertyAssignment(property)) continue;
						const section = propertyName(property.name);
						if (
							section &&
							["fields", "constraints", "indexes", "relations"].includes(
								section,
							) &&
							ts.isObjectLiteralExpression(property.initializer)
						) {
							const kind =
								section === "indexes" ? "index" : section.slice(0, -1);
							for (const member of property.initializer.properties) {
								if (!ts.isPropertyAssignment(member)) continue;
								const name = propertyName(member.name);
								if (name)
									memberSpans[`${kind}:${name}`] = sourceSpan(source, member);
							}
						}
						if (
							section === "augmentations" &&
							ts.isArrayLiteralExpression(property.initializer)
						)
							for (const element of property.initializer.elements)
								acceptanceSpans.push(sourceSpan(source, element));
					}
				}
				metadata.set(
					`${logicalPath(applicationRoot, path)}\0${declaration.name.text}`,
					{
						span: sourceSpan(source, declaration.name),
						memberSpans,
						acceptanceSpans,
					},
				);
			}
		}
	}
	return metadata;
}

export async function validateStructuralSources(
	files: readonly string[],
	scope: "application" | "package",
	activePackages: ReadonlySet<string>,
): Promise<void> {
	for (const path of files) {
		const sourceText = await readFile(path, "utf8");
		const source = ts.createSourceFile(
			path,
			sourceText,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const impure = (summary: string): never => {
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-010",
				"impureStructuralGraph",
				summary,
				{ path: logicalPath(process.cwd(), path) },
			);
		};
		const visit = (node: ts.Node, functionDepth = 0): void => {
			const nextFunctionDepth = ts.isFunctionLike(node)
				? functionDepth + 1
				: functionDepth;
			if (
				ts.isMetaProperty(node) &&
				node.keywordToken === ts.SyntaxKind.ImportKeyword
			)
				impure("import.meta is forbidden in structural source");
			if (
				ts.isCallExpression(node) &&
				node.expression.kind === ts.SyntaxKind.ImportKeyword
			)
				impure("dynamic import is forbidden in structural source");
			if (ts.isAwaitExpression(node) && functionDepth === 0)
				impure("top-level await is forbidden in structural source");
			if (
				ts.isIdentifier(node) &&
				[
					"Bun",
					"Deno",
					"WebAssembly",
					"eval",
					"fetch",
					"navigator",
					"process",
					"require",
				].includes(node.text) &&
				!(
					ts.isPropertyAccessExpression(node.parent) &&
					node.parent.name === node
				) &&
				!(ts.isPropertyAssignment(node.parent) && node.parent.name === node)
			)
				impure(`${node.text} is forbidden in structural source`);
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				((node.expression.expression.getText(source) === "Math" &&
					node.expression.name.text === "random") ||
					(node.expression.expression.getText(source) === "Date" &&
						node.expression.name.text === "now") ||
					node.expression.expression.getText(source) === "Intl" ||
					node.expression.name.text === "localeCompare" ||
					node.expression.name.text.startsWith("toLocale"))
			)
				impure(
					`${node.expression.getText(source)} is forbidden in structural source`,
				);
			if (
				ts.isNewExpression(node) &&
				ts.isIdentifier(node.expression) &&
				["Date", "Function"].includes(node.expression.text)
			)
				impure(
					`${node.expression.text} construction is forbidden in structural source`,
				);
			ts.forEachChild(node, (child) => visit(child, nextFunctionDepth));
		};
		visit(source);
		for (const statement of source.statements) {
			if (
				ts.isModuleDeclaration(statement) &&
				ts.isStringLiteral(statement.name) &&
				statement.name.text.startsWith("#questpie/")
			) {
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					"ambient generated-contract registries are forbidden",
					{ path },
				);
			}
			if (!ts.isImportDeclaration(statement)) continue;
			const specifier = statement.moduleSpecifier;
			if (!ts.isStringLiteral(specifier)) continue;
			const moduleName = specifier.text;
			const names = valueImportNames(statement);
			if (
				(scope === "package" && moduleName === "#questpie/app") ||
				(scope === "application" && moduleName === "#questpie/package")
			)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-012",
					"structuralImportOfGeneratedOutput",
					`${scope} source cannot import ${moduleName}`,
					{ path },
				);
			if (names.length === 0) continue;
			if (
				moduleName.startsWith("node:") ||
				moduleName.startsWith("bun:") ||
				[
					"child_process",
					"cluster",
					"fs",
					"http",
					"https",
					"net",
					"os",
					"process",
					"tls",
					"worker_threads",
				].includes(moduleName)
			)
				impure(`${moduleName} is forbidden in structural source`);
			if (
				moduleName.includes(".questpie/generated") ||
				moduleName === "#questpie/client"
			) {
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-012",
					"structuralImportOfGeneratedOutput",
					`${moduleName} is not structural authority`,
					{ names, path },
				);
			}
			if (moduleName === "#questpie/app") {
				if (scope === "package" || names.some((name) => !FACTORIES.has(name)))
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-012",
						"structuralImportOfGeneratedOutput",
						"only application structural source may import the seven current factories",
						{ names, path },
					);
			}
			if (moduleName === "#questpie/package") {
				if (
					scope === "application" ||
					names.some((name) => !FACTORIES.has(name))
				)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-012",
						"structuralImportOfGeneratedOutput",
						"the Package contract exposes only seven current factories",
						{ names, path },
					);
			}
			if (moduleName.endsWith("/questpie") && moduleName.startsWith("@")) {
				const packageName = moduleName.slice(0, -"/questpie".length);
				if (!activePackages.has(packageName))
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-005",
						"packageCompositionNotActivated",
						`${packageName} is imported but not active`,
						{ path, recovery: `bunx questpie add ${packageName}` },
					);
			}
		}
	}
}

const virtualFactories = `
const make = (resourceKind) => (definition) => Object.freeze({
  ...definition,
  __questpie: Object.freeze({ category: "definition", resourceKind }),
});
export const defineQuery = make("query");
export const defineMutation = make("mutation");
export const defineAction = make("action");
export const defineRoute = make("route");
export const defineReaction = make("reaction");
export const defineJob = make("job");
export const defineWorkflow = make("workflow");
`;

async function resolveSourceModule(
	from: string,
	specifier: string,
): Promise<string | null> {
	let candidate: string;
	if (specifier.startsWith(".") || specifier.startsWith("/"))
		candidate = resolve(dirname(from), specifier);
	else {
		try {
			candidate = Bun.resolveSync(specifier, dirname(from));
		} catch {
			return null;
		}
	}
	for (const path of [
		candidate,
		`${candidate}.ts`,
		`${candidate}.tsx`,
		`${candidate}.mts`,
		`${candidate}.js`,
		`${candidate}.mjs`,
		join(candidate, "index.ts"),
		join(candidate, "index.tsx"),
		join(candidate, "index.mts"),
		join(candidate, "index.js"),
	])
		if (await Bun.file(path).exists()) return resolve(path);
	return null;
}

export async function collectReachableSourceFiles(
	roots: readonly string[],
	packages: ReadonlyMap<string, PackageResolution>,
): Promise<string[]> {
	const pending = [...roots];
	const visited = new Set<string>();
	while (pending.length > 0) {
		const path = resolve(pending.pop()!);
		if (visited.has(path)) continue;
		visited.add(path);
		const source = ts.createSourceFile(
			path,
			await readFile(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
			extname(path).includes("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		for (const statement of source.statements) {
			let specifier: ts.Expression | undefined;
			let typeOnly = false;
			if (ts.isImportDeclaration(statement)) {
				specifier = statement.moduleSpecifier;
				typeOnly = statement.importClause?.isTypeOnly === true;
			} else if (ts.isExportDeclaration(statement)) {
				specifier = statement.moduleSpecifier;
				typeOnly = statement.isTypeOnly;
			}
			if (typeOnly || !specifier || !ts.isStringLiteral(specifier)) continue;
			const moduleName = specifier.text;
			if (
				moduleName === "questpie" ||
				moduleName.startsWith("#questpie/") ||
				(moduleName.endsWith("/questpie") &&
					packages.has(moduleName.slice(0, -"/questpie".length)))
			)
				continue;
			const resolved = await resolveSourceModule(path, moduleName);
			if (resolved) pending.push(resolved);
		}
	}
	return [...visited].sort(compareAscii);
}

export async function evaluateModules(
	input: Readonly<{
		applicationRoot: string;
		files: readonly string[];
		frameworkEntry: string;
		packages: ReadonlyMap<string, PackageResolution>;
		reverse?: boolean;
		packageId?: string | null;
		metadataFiles?: readonly string[];
	}>,
): Promise<EvaluatedExport[]> {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-compiler-eval-"));
	try {
		const files = input.reverse ? input.files.toReversed() : [...input.files];
		const imports = files
			.map(
				(path, index) =>
					`import * as module${index} from ${JSON.stringify(path)};`,
			)
			.join("\n");
		const records = files
			.map(
				(path, index) =>
					`{ logicalPath: ${JSON.stringify(logicalPath(input.applicationRoot, path))}, exports: module${index} }`,
			)
			.join(",\n");
		const entry = join(temporary, "entry.ts");
		await writeFile(entry, `${imports}\nexport default [${records}];\n`);
		const result = await Bun.build({
			entrypoints: [entry],
			format: "esm",
			target: "bun",
			plugins: [
				{
					name: "questpie-current-contract",
					setup(build) {
						build.onResolve({ filter: /^questpie$/ }, () => ({
							path: input.frameworkEntry,
						}));
						build.onResolve({ filter: /^#questpie\/(?:app|package)$/ }, () => ({
							path: "current-factories",
							namespace: "questpie-current",
						}));
						build.onLoad(
							{ filter: /.*/, namespace: "questpie-current" },
							() => ({ contents: virtualFactories, loader: "js" }),
						);
						build.onResolve({ filter: /^@[^/]+\/[^/]+\/questpie$/ }, (args) => {
							const name = args.path.slice(0, -"/questpie".length);
							const resolved = input.packages.get(name);
							return resolved ? { path: resolved.entry } : undefined;
						});
					},
				},
			],
		});
		if (!result.success || !result.outputs[0])
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				result.logs.map((log) => log.message).join("\n") || "bundle failed",
			);
		const source = await result.outputs[0].text();
		const bundlePath = join(temporary, "bundle.mjs");
		await writeFile(bundlePath, source);
		const metadata = await directExportMetadata(
			input.applicationRoot,
			input.metadataFiles ?? input.files,
		);
		const directKeys = [...metadata.keys()].sort(compareAscii);
		const runnerPath = join(temporary, "runner.mjs");
		await writeFile(
			runnerPath,
			`Math.random = () => { throw new Error("QP-COMPOSE-010 Math.random"); };
Date.now = () => { throw new Error("QP-COMPOSE-010 Date.now"); };
if (globalThis.crypto?.randomUUID) globalThis.crypto.randomUUID = () => { throw new Error("QP-COMPOSE-010 crypto.randomUUID"); };
globalThis.fetch = () => { throw new Error("QP-COMPOSE-010 fetch"); };
const { default: records } = await import(${JSON.stringify(`./${basename(bundlePath)}`)});
const direct = new Set(${JSON.stringify(directKeys)});
const candidates = new Map();
for (const record of records) for (const [exportName, value] of Object.entries(record.exports)) {
  if (!value || typeof value !== "object" || !value.__questpie || typeof value.__questpie !== "object") continue;
  const list = candidates.get(value) ?? [];
  list.push({ logicalPath: record.logicalPath, exportName, value });
  candidates.set(value, list);
}
const found = [];
for (const list of candidates.values()) {
  list.sort((left, right) => {
    const leftDirect = direct.has(left.logicalPath + "\\0" + left.exportName) ? 0 : 1;
    const rightDirect = direct.has(right.logicalPath + "\\0" + right.exportName) ? 0 : 1;
    return leftDirect - rightDirect || (left.logicalPath < right.logicalPath ? -1 : left.logicalPath > right.logicalPath ? 1 : left.exportName < right.exportName ? -1 : left.exportName > right.exportName ? 1 : 0);
  });
  found.push(list[0]);
}
found.sort((left, right) => left.logicalPath < right.logicalPath ? -1 : left.logicalPath > right.logicalPath ? 1 : left.exportName < right.exportName ? -1 : left.exportName > right.exportName ? 1 : 0);
process.stdout.write(JSON.stringify(found));
`,
		);
		const sandbox = Bun.which("bwrap");
		const command = sandbox
			? [
					sandbox,
					"--unshare-all",
					"--die-with-parent",
					"--new-session",
					"--ro-bind",
					"/",
					"/",
					"--proc",
					"/proc",
					"--dev",
					"/dev",
					"--chdir",
					temporary,
					process.execPath,
					"--no-env-file",
					"--cwd",
					temporary,
					runnerPath,
				]
			: [process.execPath, "--no-env-file", "--cwd", temporary, runnerPath];
		const child = Bun.spawnSync(command, {
			cwd: temporary,
			env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
			stdout: "pipe",
			stderr: "pipe",
		});
		if (child.exitCode !== 0) {
			if (child.stderr.toString().includes("QP-COMPOSE-010"))
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-010",
					"impureStructuralGraph",
					"controlled child evaluation failed",
				);
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"controlled child evaluation failed",
			);
		}
		const evaluated = JSON.parse(child.stdout.toString()) as Array<{
			logicalPath: string;
			exportName: string;
			value: Readonly<Record<string, unknown>>;
		}>;
		return evaluated.map((item) => {
			const origin = metadata.get(`${item.logicalPath}\0${item.exportName}`);
			return {
				...item,
				span: origin?.span ?? null,
				memberSpans: origin?.memberSpans ?? {},
				acceptanceSpans: origin?.acceptanceSpans ?? [],
				packageId: input.packageId ?? null,
			};
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}

export async function resolveWorkspacePackages(
	applicationRoot: string,
	packageNames: readonly string[],
): Promise<Map<string, Omit<PackageResolution, "id" | "contentDigest">>> {
	const candidatesRoot = resolve(applicationRoot, "packages");
	const result = new Map<
		string,
		Omit<PackageResolution, "id" | "contentDigest">
	>();
	for (const directory of await readdir(candidatesRoot, {
		withFileTypes: true,
	})) {
		if (!directory.isDirectory()) continue;
		const root = join(candidatesRoot, directory.name);
		const manifestPath = join(root, "package.json");
		const manifest = JSON.parse(
			await readFile(manifestPath, "utf8"),
		) as Readonly<{
			name?: string;
			version?: string;
			type?: string;
			exports?: Readonly<Record<string, unknown>>;
			questpie?: Readonly<{ manifestVersion?: number; framework?: string }>;
		}>;
		if (!manifest.name || !packageNames.includes(manifest.name)) continue;
		const exported = manifest.exports?.["./questpie"];
		const target =
			typeof exported === "string"
				? exported
				: exported && typeof exported === "object"
					? (exported as Readonly<Record<string, unknown>>).import
					: undefined;
		if (
			manifest.type !== "module" ||
			manifest.questpie?.manifestVersion !== 1 ||
			typeof target !== "string" ||
			!manifest.version
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-006",
				"invalidPackageManifest",
				`${manifest.name} has no compatible ./questpie ESM export`,
			);
		result.set(manifest.name, {
			name: manifest.name,
			version: manifest.version,
			resolution: "workspace",
			integrity: null,
			commit: null,
			root,
			entry: resolve(root, target),
		});
	}
	for (const name of packageNames)
		if (!result.has(name))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-006",
				"invalidPackageManifest",
				`active Package ${name} cannot be resolved below ${basename(candidatesRoot)}`,
			);
	return result;
}

export async function packageSourceFiles(entry: string): Promise<string[]> {
	return collectReachableSourceFiles([entry], new Map());
}
