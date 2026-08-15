import { readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
	canonicalBytes,
	compareAscii,
	contentDigest,
	digest,
} from "./canonical";
import {
	explainExecutionComposition,
	projectExecutionComposition,
} from "./composition";
import { renderAppContract, renderPackageContract } from "./generate";
import {
	lowerPostgresQueryPlans,
	projectRelationalCompilation,
	projectRelationalNondisclosure,
} from "./relational";
import {
	projectCommittedMigrations,
	projectRuntimeBuild,
	projectRuntimeContract,
	renderApplicationBundle,
	renderApplicationDeclaration,
	renderClientContract,
	runtimeArtifactBytes,
} from "./runtime";
import {
	expectedComparable,
	projectManifest,
	projectMemberContributions,
} from "./schema";
import type { SchemaProjectionV1 } from "./schema";
import type {
	ApplicationConfiguration,
	EvaluatedExport,
	NormalizedResource,
	PackageInventory,
} from "./types";

function logical(root: string, path: string): string {
	return relative(root, path).split(sep).join("/").normalize("NFC");
}

export function packageContractPath(packageName: string): string {
	const readableName = packageName.replace(/^@/, "").replaceAll("/", "-");
	return `internal/package-contracts/${readableName}-${contentDigest(packageName)}.ts`;
}

async function graph(
	root: string,
	files: readonly string[],
): Promise<Readonly<{ path: string; contentDigest: string }>[]> {
	return Promise.all(
		[...files]
			.sort((left, right) =>
				compareAscii(logical(root, left), logical(root, right)),
			)
			.map(async (path) => ({
				path: logical(root, path),
				contentDigest: contentDigest(await readFile(path)),
			})),
	);
}

export async function createArtifacts(
	input: Readonly<{
		applicationRoot: string;
		configuration: ApplicationConfiguration;
		packageManifestText: string;
		typescriptConfigFiles: readonly Readonly<{ path: string; text: string }>[];
		lockfileText: string;
		sourceFiles: readonly string[];
		frameworkRoot: string;
		frameworkFiles: readonly string[];
		inventories: readonly PackageInventory[];
		resources: readonly NormalizedResource[];
		evaluatedExports: readonly EvaluatedExport[];
		packageCompilations: readonly Readonly<{
			name: string;
			files: readonly string[];
			resources: readonly NormalizedResource[];
		}>[];
	}>,
): Promise<Readonly<Record<string, string>>> {
	const manifest = projectManifest(input.configuration, input.resources);
	const executionComposition = projectExecutionComposition(input.resources);
	const schema = manifest.schema;
	const relational = projectRelationalCompilation({
		exports: input.evaluatedExports,
		resources: input.resources,
		schema,
		data: manifest.data,
	});
	const sourceGraph = await graph(input.applicationRoot, input.sourceFiles);
	const frameworkGraph = await graph(input.frameworkRoot, input.frameworkFiles);
	const packageGraphs = await Promise.all(
		input.inventories.map(async (inventory) => ({
			inventory,
			graph: await graph(
				inventory.package.root,
				input.packageCompilations.find(
					(compilation) => compilation.name === inventory.package.name,
				)?.files ?? [inventory.package.entry],
			),
		})),
	);
	const inputs = {
		compilerVersion: "4.0.0-beta.1",
		bunVersion: Bun.version,
		applicationConfigDigest: digest(
			"questpie-build-input-component-v1:applicationConfigDigest",
			input.configuration,
		),
		packageManifestDigest: digest(
			"questpie-build-input-component-v1:packageManifestDigest",
			JSON.parse(input.packageManifestText),
		),
		typescriptConfigGraphDigest: digest(
			"questpie-build-input-component-v1:typescriptConfigGraphDigest",
			input.typescriptConfigFiles.map((file) => ({
				path: file.path,
				contentDigest: contentDigest(file.text),
			})),
		),
		lockfileDigest: digest(
			"questpie-build-input-component-v1:lockfileDigest",
			input.lockfileText,
		),
		structuralGraphDigest: digest(
			"questpie-build-input-component-v1:structuralGraphDigest",
			[
				...sourceGraph.map((entry) => ({ ...entry, scope: "application" })),
				...frameworkGraph.map((entry) => ({ ...entry, scope: "framework" })),
				...packageGraphs.flatMap(({ inventory, graph }) =>
					graph.map((entry) => ({
						...entry,
						scope: `package:${inventory.package.name}`,
					})),
				),
			].sort((left, right) =>
				compareAscii(
					`${left.scope}/${left.path}`,
					`${right.scope}/${right.path}`,
				),
			),
		),
		dependencies: [
			{
				name: "questpie",
				role: "framework",
				resolutionDigest: digest("questpie-package-resolution-v1", {
					name: "questpie",
					version: "4.0.0-beta.1",
					resolution: "workspace",
					integrity: null,
					commit: null,
					contentDigest: digest("questpie-module-graph-v1", frameworkGraph),
				}),
				moduleGraphDigest: digest("questpie-module-graph-v1", frameworkGraph),
				inventoryDigest: null,
			},
			...packageGraphs.map(({ inventory, graph }) => ({
				name: inventory.package.name,
				role: "activatedPackage",
				resolutionDigest: inventory.package.id,
				moduleGraphDigest: digest("questpie-module-graph-v1", graph),
				inventoryDigest: inventory.digest,
			})),
		].sort((left, right) =>
			compareAscii(`${left.role}/${left.name}`, `${right.role}/${right.name}`),
		),
	};
	const buildInputDigest = digest("questpie-build-input-v1", inputs);
	const originMap = {
		format: "questpie.origin-map",
		version: 1,
		buildInputDigest,
		packages: input.inventories
			.map((inventory) => {
				const { root: _root, entry: _entry, ...resolution } = inventory.package;
				return resolution;
			})
			.sort((left, right) => compareAscii(left.id, right.id)),
		resources: input.resources.map((resource) => ({
			identity: resource.identity,
			establishedAt: {
				kind: "export",
				packageId: resource.origin.packageId,
				path: resource.origin.logicalPath,
				exportName: resource.origin.exportName,
				span: resource.origin.span,
				declaredAt: null,
			},
			augmentations: resource.contributions.map((contribution) => ({
				identity: contribution.identity,
				definedAt: {
					kind: "export",
					packageId: contribution.packageId,
					path: contribution.logicalPath,
					exportName: contribution.exportName,
					span: contribution.definedSpan,
					declaredAt: null,
				},
				acceptedAt: {
					packageId: null,
					path: resource.origin.logicalPath,
					span: contribution.acceptedSpan,
				},
			})),
			members: projectMemberContributions(resource).map((member) => {
				const contribution = resource.contributions.find(
					(candidate) => candidate.identity === member.contributionIdentity,
				);
				const memberKey = member.identity.slice(resource.identity.length + 1);
				return {
					...member,
					declaredAt: contribution
						? {
								packageId: contribution.packageId,
								path: contribution.logicalPath,
								span: contribution.memberSpans[memberKey] ?? null,
							}
						: {
								packageId: null,
								path: resource.origin.logicalPath,
								span: resource.origin.memberSpans[memberKey] ?? null,
							},
				};
			}),
		})),
		...(relational.structuralOrigins.length > 0
			? { structuralPlans: relational.structuralOrigins }
			: {}),
	};
	const originMapBytes = canonicalBytes(originMap);
	const executionExplanation = explainExecutionComposition(
		executionComposition,
		originMap,
	);
	const buildInput = {
		format: "questpie.build-input",
		version: 1,
		digest: buildInputDigest,
		originMapDigest: digest("questpie-origin-map-v1", originMap),
		inputs,
	};
	const inventoryArtifact = {
		format: "questpie.package-inventories",
		version: 1,
		packages: input.inventories.map((inventory) => ({
			name: inventory.package.name,
			digest: inventory.digest,
			entries: inventory.entries,
		})),
	};
	const runtime = projectRuntimeContract({
		configuration: input.configuration,
		resources: input.resources,
		sourceGraph: [
			...sourceGraph.map((file) => ({ ...file, packageId: null })),
			...packageGraphs.flatMap(({ inventory, graph: packageGraph }) =>
				packageGraph.map((file) => ({
					...file,
					packageId: inventory.package.id,
				})),
			),
		],
		contextProjection: executionComposition.context,
	});
	const committedMigrations = await projectCommittedMigrations(
		input.applicationRoot,
	);
	const generated: Record<string, string> = {
		"app.ts": renderAppContract(
			input.resources,
			manifest.data,
			schema,
			input.configuration.source.root,
			relational.declarations,
		),
		"build-input.json": canonicalBytes(buildInput),
		"client.ts": renderClientContract(input.resources, {
			application: `application:${input.configuration.application.name}`,
			clientContractDigest: runtime.clientContractDigest,
			wireDigest: runtime.wireDigest,
			path: String(runtime.wire.path),
			mediaType: String(runtime.wire.mediaType),
		}),
		"committed-migrations.json": runtimeArtifactBytes(committedMigrations),
		"context-projection.json": canonicalBytes(executionComposition.context),
		"execution-composition-explain.json": canonicalBytes(executionExplanation),
		"internal/package-inventories.json": canonicalBytes(inventoryArtifact),
		"manifest.json": canonicalBytes(manifest),
		"origin-map.json": originMapBytes,
		"schema-projection.json": canonicalBytes(schema),
		"service-projection.json": canonicalBytes(executionComposition.services),
		"runtime-executables.json": runtimeArtifactBytes(runtime.executables),
		"wire-contract.json": runtimeArtifactBytes(runtime.wire),
	};
	let postgresQueryPlans: unknown = {
		format: "questpie.postgres-query-plans",
		version: 1,
		plans: [],
	};
	if (relational.hasRelationalArtifacts) {
		postgresQueryPlans = lowerPostgresQueryPlans({
			schema,
			policyProjection: relational.policy,
			queryProjection: relational.query,
		});
		generated["policy-projection.json"] = canonicalBytes(relational.policy);
		generated["query-projection.json"] = canonicalBytes(relational.query);
		generated["postgres-query-plans.json"] = canonicalBytes(postgresQueryPlans);
		generated["relational-nondisclosure.json"] = canonicalBytes(
			projectRelationalNondisclosure({
				policyProjection: relational.policy,
				queryProjection: relational.query,
				postgresQueryPlans,
			}),
		);
		generated["relational-explain.json"] = canonicalBytes(relational.explain);
	}
	for (const compilation of input.packageCompilations)
		generated[packageContractPath(compilation.name)] = renderPackageContract(
			compilation.name,
			compilation.resources,
		);
	generated["internal/application.d.ts"] = renderApplicationDeclaration();
	const runtimeBundleEntry = fileURLToPath(
		import.meta.resolve("@questpie/runtime/bundle"),
	);
	const readinessEntry = join(
		import.meta.dir,
		"runtime",
		`postgres-readiness${extname(fileURLToPath(import.meta.url))}`,
	);
	generated["internal/application.js"] = await renderApplicationBundle({
		applicationRoot: input.applicationRoot,
		configuration: input.configuration,
		resources: input.resources,
		slots: runtime.executables.slots,
		inventories: input.inventories,
		queryProjection: relational.query,
		postgresQueryPlans,
		schemaProjection: schema,
		readinessEntry,
		runtimeBundleEntry,
	});
	generated["runtime-build.json"] = runtimeArtifactBytes(
		projectRuntimeBuild({
			configuration: input.configuration,
			files: generated,
			runtime,
			migrationHead: committedMigrations.head,
			schemaFingerprint: digest(
				"questpie-schema-fingerprint-v1",
				expectedComparable(schema as SchemaProjectionV1),
			),
		}),
	);
	generated["internal/checksums.json"] = canonicalBytes({
		format: "questpie.generated-checksums",
		version: 1,
		files: Object.entries(generated)
			.map(([path, contents]) => ({ path, digest: contentDigest(contents) }))
			.sort((left, right) => compareAscii(left.path, right.path)),
	});
	return generated;
}
