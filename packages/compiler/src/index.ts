import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import { createArtifacts, packageContractPath } from "./artifacts";
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
	collectReachableSourceFiles,
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
export {
	createCommittedMigration,
	createMigrationPlan,
	verifyCommittedMigration,
	verifyCommittedMigrationChain,
} from "./schema";
export {
	applyCommittedMigrations,
	inspectSchemaFingerprint,
} from "./schema-postgres";
export type {
	ApplyMigrationsResult,
	SchemaFingerprintV1,
} from "./schema-postgres";
export type {
	CommittedMigration,
	CommittedMigrationFilesV1,
	MigrationPlanV1,
	MigrationStepKindV1,
	MigrationStepV1,
	PlannedMigration,
	SchemaProjectionV1,
} from "./schema";

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

async function typescriptConfigurationGraph(
	applicationRoot: string,
	rootPath: string,
): Promise<Array<{ path: string; text: string }>> {
	const pending = [rootPath];
	const visited = new Set<string>();
	const graph: Array<{ path: string; text: string }> = [];
	while (pending.length > 0) {
		const path = resolve(pending.pop()!);
		if (visited.has(path)) continue;
		visited.add(path);
		const text = await readFile(path, "utf8");
		const parsed = ts.parseConfigFileTextToJson(path, text);
		if (parsed.error)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
			);
		const raw = parsed.config as Readonly<{
			extends?: string | readonly string[];
			references?: readonly Readonly<{ path?: string }>[];
		}>;
		const resolveConfig = (specifier: string): string => {
			if (specifier.startsWith(".")) {
				const candidate = resolve(dirname(path), specifier);
				return candidate.endsWith(".json") ? candidate : `${candidate}.json`;
			}
			try {
				return Bun.resolveSync(specifier, dirname(path));
			} catch {
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`cannot resolve TypeScript configuration ${specifier}`,
				);
			}
		};
		const extended = Array.isArray(raw.extends)
			? raw.extends
			: raw.extends
				? [raw.extends]
				: [];
		for (const specifier of extended) pending.push(resolveConfig(specifier));
		for (const reference of raw.references ?? [])
			if (reference.path) {
				const candidate = resolve(dirname(path), reference.path);
				pending.push(
					candidate.endsWith(".json")
						? candidate
						: join(candidate, "tsconfig.json"),
				);
			}
		graph.push({
			path: relative(applicationRoot, path)
				.split(sep)
				.join("/")
				.normalize("NFC"),
			text,
		});
	}
	return graph.sort((left, right) => compareAscii(left.path, right.path));
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
	const applicationTsconfig = join(applicationRoot, "tsconfig.json");
	const typescriptConfigFiles = await typescriptConfigurationGraph(
		applicationRoot,
		applicationTsconfig,
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
	const applicationGraph = await collectReachableSourceFiles(
		sourceFiles,
		packages,
	);
	await validateStructuralSources(
		applicationGraph,
		"application",
		new Set(packages.keys()),
	);

	const inventories: PackageInventory[] = [];
	const packageCompilations: Array<{
		name: string;
		files: readonly string[];
		resources: ReturnType<typeof normalizeResources>;
		reversedResources: ReturnType<typeof normalizeResources>;
	}> = [];
	const packageExports: Awaited<ReturnType<typeof evaluateModules>> = [];
	for (const packageResolution of packages.values()) {
		const files = await packageSourceFiles(packageResolution.entry);
		await validateStructuralSources(files, "package", new Set(packages.keys()));
		const evaluated = await evaluateModules({
			applicationRoot: packageResolution.root,
			files: [packageResolution.entry],
			metadataFiles: files,
			frameworkEntry,
			packages,
			packageId: packageResolution.id,
		});
		const reversed = await evaluateModules({
			applicationRoot: packageResolution.root,
			files: [packageResolution.entry],
			metadataFiles: files,
			frameworkEntry,
			packages,
			packageId: packageResolution.id,
			reverse: true,
		});
		const inventory = createPackageInventory(packageResolution, evaluated);
		const reversedInventory = createPackageInventory(
			packageResolution,
			reversed,
		);
		if (canonicalBytes(inventory) !== canonicalBytes(reversedInventory))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-011",
				"nondeterministicEvaluation",
				`${packageResolution.name} Package Inventory changed under reversed evaluation`,
			);
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
		const resources = normalizeResources(evaluated, [inventory]);
		const reversedResources = normalizeResources(reversed, [reversedInventory]);
		if (semanticDraft(resources) !== semanticDraft(reversedResources))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-011",
				"nondeterministicEvaluation",
				`${packageResolution.name} normalized Package draft changed under reversed evaluation`,
			);
		packageCompilations.push({
			name: packageResolution.name,
			files,
			resources,
			reversedResources,
		});
		packageExports.push(...evaluated);
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
	const firstResources = normalizeResources(
		[...firstExports, ...packageExports],
		inventories,
	);
	const secondResources = normalizeResources(
		[...secondExports, ...packageExports],
		inventories,
	);
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
		typescriptConfigFiles,
		lockfileText,
		sourceFiles: applicationGraph,
		frameworkRoot: resolve(repositoryRoot, "packages/questpie"),
		frameworkFiles: await collectReachableSourceFiles(
			[frameworkEntry],
			packages,
		),
		inventories,
		resources: firstResources,
		packageCompilations,
	});
	const reversedGeneratedFiles = await createArtifacts({
		applicationRoot,
		configuration: applicationConfiguration,
		packageManifestText,
		typescriptConfigFiles,
		lockfileText,
		sourceFiles: applicationGraph,
		frameworkRoot: resolve(repositoryRoot, "packages/questpie"),
		frameworkFiles: await collectReachableSourceFiles(
			[frameworkEntry],
			packages,
		),
		inventories,
		resources: secondResources,
		packageCompilations: packageCompilations.map((compilation) => ({
			...compilation,
			resources: compilation.reversedResources,
		})),
	});
	if (canonicalBytes(generatedFiles) !== canonicalBytes(reversedGeneratedFiles))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-011",
			"nondeterministicEvaluation",
			"reverse discovery order changed generated artifact bytes",
		);
	const typecheck = await typecheckCurrentContract({
		applicationFiles: applicationGraph,
		generatedFiles,
		frameworkEntry,
		packages,
		compilerRoot,
		applicationTsconfig,
		packageCompilations: packageCompilations.map((compilation) => ({
			...compilation,
			contractPath: packageContractPath(compilation.name),
		})),
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
			publicDeclarationBytes: Object.entries(generatedFiles)
				.filter(
					([path]) =>
						path === "app.ts" ||
						path === "client.ts" ||
						path.startsWith("internal/package-contracts/"),
				)
				.reduce((total, [, value]) => total + Buffer.byteLength(value), 0),
			typescriptTypes: typecheck.types,
			typescriptInstantiations: typecheck.instantiations,
			typescriptMemoryKiB: typecheck.memoryKiB,
		},
	};
}

export function canonicalArtifactBytes(value: unknown): string {
	return canonicalBytes(value);
}
