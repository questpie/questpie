import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { createArtifacts } from "./artifacts";
import {
	canonicalBytes,
	compareAscii,
	contentDigest,
	digest,
} from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import {
	discoverSourceFiles,
	evaluateModules,
	packageSourceFiles,
	resolveWorkspacePackages,
	validateStructuralSources,
} from "./discovery";
import {
	createPackageInventory,
	normalizeResources,
	semanticDraft,
} from "./model";
import { typecheckCurrentContract } from "./typecheck";
import type {
	ApplicationConfiguration,
	PackageInventory,
	PackageResolution,
} from "./types";
import { replaceGeneratedDirectory } from "./write";

export { CompilerDiagnosticError } from "./diagnostic";

export interface CompileApplicationOptions {
	readonly applicationRoot: string;
	readonly outputDirectory?: string;
}

export interface CompileApplicationResult {
	readonly generatedFiles: Readonly<Record<string, string>>;
	readonly packageInventories: readonly Readonly<{
		name: string;
		digest: string;
	}>[];
	readonly measurements: Readonly<{
		compileMs: number;
		typecheckMs: number;
		generatedBytes: number;
		publicDeclarationBytes: number;
		typescriptTypes: number;
		typescriptInstantiations: number;
		typescriptMemoryKiB: number;
	}>;
}

async function packageFiles(root: string): Promise<string[]> {
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) files.push(path);
		}
	}
	await visit(root);
	return files.sort();
}

async function resolvePackages(
	applicationRoot: string,
	configuration: ApplicationConfiguration,
): Promise<Map<string, PackageResolution>> {
	const unresolved = await resolveWorkspacePackages(
		applicationRoot,
		Object.keys(configuration.packages),
	);
	const resolved = new Map<string, PackageResolution>();
	for (const [name, candidate] of unresolved) {
		const files = await packageFiles(candidate.root);
		const graph = await Promise.all(
			files.map(async (path) => ({
				path: path.slice(candidate.root.length + 1).replaceAll("\\", "/"),
				contentDigest: contentDigest(await readFile(path)),
			})),
		);
		const packageContentDigest = digest("questpie-module-graph-v1", graph);
		const resolutionFacts = {
			name: candidate.name,
			version: candidate.version,
			resolution: candidate.resolution,
			integrity: candidate.integrity,
			commit: candidate.commit,
			contentDigest: packageContentDigest,
		};
		resolved.set(name, {
			...candidate,
			contentDigest: packageContentDigest,
			id: digest("questpie-package-resolution-v1", resolutionFacts),
		});
	}
	return resolved;
}

function configuration(value: unknown): ApplicationConfiguration {
	const invalid = (message: string): never => {
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-017",
			"invalidApplicationRoot",
			message,
		);
	};
	const object = (
		candidate: unknown,
		label: string,
	): Record<string, unknown> => {
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
			return invalid(`${label} must be an object`);
		return candidate as Record<string, unknown>;
	};
	const exactKeys = (
		candidate: Record<string, unknown>,
		keys: readonly string[],
		label: string,
	): void => {
		const expected = new Set(keys);
		const unknown = Object.keys(candidate).filter((key) => !expected.has(key));
		if (unknown.length > 0)
			invalid(`${label} has unknown key ${unknown.sort(compareAscii)[0]}`);
	};
	const nonempty = (candidate: unknown, label: string): string => {
		if (typeof candidate !== "string" || candidate.length === 0)
			return invalid(`${label} must be a non-empty string`);
		return candidate;
	};
	const semanticSet = (candidate: unknown, label: string): string[] => {
		if (!Array.isArray(candidate)) return invalid(`${label} must be an array`);
		const values = candidate.map((item, index) =>
			nonempty(item, `${label}[${index}]`),
		);
		if (new Set(values).size !== values.length)
			return invalid(`${label} must contain unique values`);
		return values.sort(compareAscii);
	};

	const root = object(value, "questpie.json");
	exactKeys(
		root,
		["$schema", "version", "application", "postgres", "source", "packages"],
		"questpie.json",
	);
	if (
		root.$schema !== "https://questpie.dev/schema/application-v1.json" ||
		root.version !== 1
	)
		invalid("questpie.json does not match application-v1");

	const application = object(root.application, "application");
	exactKeys(application, ["name"], "application");
	const postgres = object(root.postgres, "postgres");
	exactKeys(
		postgres,
		[
			"schema",
			"minimumMajor",
			"databaseCollation",
			"databaseCType",
			"extensions",
			"physicalNames",
		],
		"postgres",
	);
	if (postgres.minimumMajor !== 16)
		invalid("postgres.minimumMajor must equal 16");
	const physicalNames = object(
		postgres.physicalNames,
		"postgres.physicalNames",
	);
	for (const [identity, name] of Object.entries(physicalNames)) {
		nonempty(identity, "postgres.physicalNames identity");
		nonempty(name, `postgres.physicalNames.${identity}`);
	}
	const source = object(root.source, "source");
	exactKeys(source, ["root", "exclude"], "source");
	const sourceRoot = nonempty(source.root, "source.root");
	const resolvedSourceRoot = resolve("/application", sourceRoot);
	if (
		resolvedSourceRoot !== "/application" &&
		!resolvedSourceRoot.startsWith("/application/")
	)
		invalid("source.root must stay inside the application package");
	const excludes = semanticSet(source.exclude, "source.exclude");
	for (const pattern of excludes)
		if (
			["{", "}", "[", "]", "!", "\\"].some((token) => pattern.includes(token))
		)
			invalid(`source.exclude contains unsupported pattern ${pattern}`);

	const rawPackages = object(root.packages, "packages");
	const packages: Record<string, Readonly<{ inventoryDigest: string }>> = {};
	for (const name of Object.keys(rawPackages).sort(compareAscii)) {
		const activated = object(rawPackages[name], `packages.${name}`);
		exactKeys(activated, ["inventoryDigest"], `packages.${name}`);
		const inventoryDigest = nonempty(
			activated.inventoryDigest,
			`packages.${name}.inventoryDigest`,
		);
		if (!/^[0-9a-f]{64}$/.test(inventoryDigest))
			invalid(`packages.${name}.inventoryDigest must be lowercase SHA-256`);
		packages[name] = { inventoryDigest };
	}

	return {
		$schema: "https://questpie.dev/schema/application-v1.json",
		version: 1,
		application: { name: nonempty(application.name, "application.name") },
		postgres: {
			schema: nonempty(postgres.schema, "postgres.schema"),
			minimumMajor: 16,
			databaseCollation: nonempty(
				postgres.databaseCollation,
				"postgres.databaseCollation",
			),
			databaseCType: nonempty(postgres.databaseCType, "postgres.databaseCType"),
			extensions: semanticSet(postgres.extensions, "postgres.extensions"),
			physicalNames: Object.fromEntries(
				Object.entries(physicalNames).sort(([left], [right]) =>
					compareAscii(left, right),
				),
			) as Readonly<Record<string, string>>,
		},
		source: { root: sourceRoot, exclude: excludes },
		packages,
	};
}

export async function compileApplication(
	options: CompileApplicationOptions,
): Promise<CompileApplicationResult> {
	const started = performance.now();
	const applicationRoot = resolve(options.applicationRoot);
	const compilerRoot = dirname(import.meta.dir);
	const repositoryRoot = resolve(compilerRoot, "../..");
	const frameworkEntry = resolve(
		repositoryRoot,
		"packages/questpie/src/index.ts",
	);
	const configurationText = await readFile(
		join(applicationRoot, "questpie.json"),
		"utf8",
	);
	const applicationConfiguration = configuration(JSON.parse(configurationText));
	const packageManifestText = await readFile(
		join(applicationRoot, "package.json"),
		"utf8",
	);
	const typescriptConfigText = await readFile(
		join(applicationRoot, "tsconfig.json"),
		"utf8",
	);
	const lockfileText = await readFile(
		join(applicationRoot, "bun.lock"),
		"utf8",
	);
	const sourceFiles = await discoverSourceFiles(
		applicationRoot,
		applicationConfiguration,
	);
	const packages = await resolvePackages(
		applicationRoot,
		applicationConfiguration,
	);
	await validateStructuralSources(
		sourceFiles,
		"application",
		new Set(packages.keys()),
	);

	const inventories: PackageInventory[] = [];
	for (const packageResolution of packages.values()) {
		const files = await packageSourceFiles(packageResolution.entry);
		await validateStructuralSources(files, "package", new Set(packages.keys()));
		const evaluated = await evaluateModules({
			applicationRoot: packageResolution.root,
			files,
			frameworkEntry,
			packages,
		});
		const inventory = createPackageInventory(packageResolution, evaluated);
		const accepted =
			applicationConfiguration.packages[packageResolution.name]
				?.inventoryDigest;
		if (accepted !== inventory.digest)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-008",
				"packageInventoryChanged",
				`${packageResolution.name} inventory ${inventory.digest} is not accepted`,
				{ accepted, actual: inventory.digest },
			);
		inventories.push(inventory);
	}

	const firstExports = await evaluateModules({
		applicationRoot,
		files: sourceFiles,
		frameworkEntry,
		packages,
	});
	const secondExports = await evaluateModules({
		applicationRoot,
		files: sourceFiles,
		frameworkEntry,
		packages,
		reverse: true,
	});
	const firstResources = normalizeResources(firstExports, inventories);
	const secondResources = normalizeResources(secondExports, inventories);
	if (semanticDraft(firstResources) !== semanticDraft(secondResources))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-011",
			"nondeterministicEvaluation",
			"reverse discovery order changed the normalized draft",
		);
	const generatedFiles = await createArtifacts({
		applicationRoot,
		configuration: applicationConfiguration,
		packageManifestText,
		typescriptConfigText,
		lockfileText,
		sourceFiles,
		frameworkRoot: resolve(repositoryRoot, "packages/questpie"),
		frameworkFiles: [frameworkEntry],
		inventories,
		resources: firstResources,
	});
	const typecheck = await typecheckCurrentContract({
		applicationFiles: sourceFiles,
		generatedFiles,
		frameworkEntry,
		packages,
		compilerRoot,
	});
	const outputDirectory =
		options.outputDirectory ?? resolve(applicationRoot, ".questpie/generated");
	await replaceGeneratedDirectory(outputDirectory, generatedFiles);
	return {
		generatedFiles,
		packageInventories: inventories.map((inventory) => ({
			name: inventory.package.name,
			digest: inventory.digest,
		})),
		measurements: {
			compileMs: performance.now() - started,
			typecheckMs: typecheck.elapsedMs,
			generatedBytes: Object.values(generatedFiles).reduce(
				(total, value) => total + Buffer.byteLength(value),
				0,
			),
			publicDeclarationBytes: [
				"app.ts",
				"client.ts",
				"internal/package-contracts/collaboration-audit.ts",
			].reduce(
				(total, path) => total + Buffer.byteLength(generatedFiles[path] ?? ""),
				0,
			),
			typescriptTypes: typecheck.types,
			typescriptInstantiations: typecheck.instantiations,
			typescriptMemoryKiB: typecheck.memoryKiB,
		},
	};
}

export function canonicalArtifactBytes(value: unknown): string {
	return canonicalBytes(value);
}
