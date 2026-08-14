import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { compareAscii } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import type {
	ApplicationConfiguration,
	EvaluatedExport,
	PackageResolution,
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
			if (names.length === 0) continue;
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

export async function evaluateModules(
	input: Readonly<{
		applicationRoot: string;
		files: readonly string[];
		frameworkEntry: string;
		packages: ReadonlyMap<string, PackageResolution>;
		reverse?: boolean;
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
		await writeFile(
			bundlePath,
			`${source}\n// fresh-realm ${crypto.randomUUID()}\n`,
		);
		const loaded = (await import(pathToFileURL(bundlePath).href)) as Readonly<{
			default: readonly Readonly<{
				logicalPath: string;
				exports: Readonly<Record<string, unknown>>;
			}>[];
		}>;
		const found: EvaluatedExport[] = [];
		const seen = new WeakSet<object>();
		for (const record of loaded.default) {
			for (const [exportName, value] of Object.entries(record.exports).sort(
				([left], [right]) => compareAscii(left, right),
			)) {
				if (!value || typeof value !== "object") continue;
				if (seen.has(value)) continue;
				const brand = (value as Readonly<Record<string, unknown>>)[
					"__questpie"
				];
				if (!brand || typeof brand !== "object") continue;
				seen.add(value);
				found.push({
					logicalPath: record.logicalPath,
					exportName,
					value: value as Readonly<Record<string, unknown>>,
				});
			}
		}
		return found;
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
	return [entry];
}
