import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
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
	projectLiveQueryChangeCapture,
	projectLiveQueryCompilation,
} from "./live-query";
import {
	lowerPostgresCollectionOperationPlans,
	projectCollectionOperationSets,
	projectMutationGeneratedContract,
	projectCollectionOperationResourceMetadata,
	projectMutations,
} from "./mutation";
import {
	lowerPostgresQueryPlans,
	projectPostgresContextBootstrapPlans,
	projectRelationalCompilation,
	projectRelationalNondisclosure,
} from "./relational";
import {
	projectCommittedMigrations,
	projectRealtimeWireContract,
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

function runtimeBundleEntry(specifier: string, filename: string): string {
	try {
		return fileURLToPath(import.meta.resolve(specifier));
	} catch {
		const vendored = resolve(import.meta.dir, "../runtime", filename);
		if (existsSync(vendored)) return vendored;
		throw new TypeError(`QUESTPIE Runtime bundle is unavailable: ${specifier}`);
	}
}
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
	const baseManifest = projectManifest(input.configuration, input.resources);
	const executionComposition = projectExecutionComposition(input.resources);
	const baseSchema = baseManifest.schema as SchemaProjectionV1;
	const operationSets = projectCollectionOperationSets({
		exports: input.evaluatedExports,
		resources: input.resources,
		schema: baseSchema,
		data: baseManifest.data,
	});
	const operationResourceMetadata = projectCollectionOperationResourceMetadata({
		sets: operationSets.sets,
		programs: operationSets.programs,
		origins: operationSets.origins,
	});
	const baseComposition = baseManifest.composition as Readonly<{
		resources: readonly Readonly<Record<string, unknown>>[];
	}>;
	const manifest: Readonly<Record<string, unknown>> = {
		...baseManifest,
		composition: {
			...baseComposition,
			resources: [
				...baseComposition.resources,
				...operationResourceMetadata.compositionResources,
			].sort((left, right) =>
				compareAscii(String(left.identity), String(right.identity)),
			),
		},
	};
	const relational = projectRelationalCompilation({
		exports: input.evaluatedExports,
		resources: input.resources,
		schema: baseSchema,
		data: manifest.data,
	});
	const liveQuery = projectLiveQueryCompilation({
		resources: input.resources,
		contextProjection: executionComposition.context,
		dataProjection: manifest.data as Readonly<Record<string, unknown>>,
		policyProjection: relational.policy,
		queryProjection: relational.query,
	});
	const changeCapture = projectLiveQueryChangeCapture(baseSchema, liveQuery);
	const schema = Object.freeze({ ...baseSchema, changeCapture });
	const finalManifest: Readonly<Record<string, unknown>> = Object.freeze({
		...manifest,
		schema,
	});
	const mutationDeclarations = projectMutationGeneratedContract(
		operationSets.programs,
		input.resources,
	);
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
	const baseOriginMap = {
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
		...(relational.structuralOrigins.length > 0 ||
		operationSets.origins.length > 0
			? {
					structuralPlans: [
						...relational.structuralOrigins,
						...operationSets.origins,
					],
				}
			: {}),
	};
	const originMap = {
		...baseOriginMap,
		resources: [
			...baseOriginMap.resources,
			...operationResourceMetadata.resourceOrigins,
		].sort((left, right) =>
			compareAscii(String(left.identity), String(right.identity)),
		),
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
	const realtime = projectRealtimeWireContract({
		application: `application:${input.configuration.application.name}`,
		clientContractDigest: runtime.clientContractDigest,
		operationWireDigest: runtime.wireDigest,
		resources: input.resources,
		watchableQueries: (
			liveQuery.artifacts["query-watchability.json"]
				.queries as readonly Readonly<{
				query: string;
				watchable: boolean;
			}>[]
		)
			.filter(({ watchable }) => watchable)
			.map(({ query }) => query),
	});
	const realtimeEnabled = realtime.watchableQueries.length > 0;
	const committedMigrations = await projectCommittedMigrations(
		input.applicationRoot,
	);
	const mutations = projectMutations(input.resources);
	const contextBootstrapPlans = projectPostgresContextBootstrapPlans(schema);
	const generated: Record<string, string> = {
		...liveQuery.bytes,
		"app.ts": renderAppContract(
			input.resources,
			finalManifest.data,
			schema,
			input.configuration.source.root,
			relational.declarations,
			mutationDeclarations,
			realtimeEnabled,
		),
		"build-input.json": canonicalBytes(buildInput),
		"client.ts": renderClientContract(input.resources, {
			application: `application:${input.configuration.application.name}`,
			clientContractDigest: runtime.clientContractDigest,
			wireDigest: runtime.wireDigest,
			path: String(runtime.wire.path),
			mediaType: String(runtime.wire.mediaType),
			realtime: realtimeEnabled ? realtime : undefined,
		}),
		"committed-migrations.json": runtimeArtifactBytes(committedMigrations),
		"context-projection.json": canonicalBytes(executionComposition.context),
		"execution-composition-explain.json": canonicalBytes(executionExplanation),
		"internal/package-inventories.json": canonicalBytes(inventoryArtifact),
		"manifest.json": canonicalBytes(finalManifest),
		"origin-map.json": originMapBytes,
		"schema-projection.json": canonicalBytes(schema),
		"postgres-context-bootstrap-plans.json": canonicalBytes(
			contextBootstrapPlans,
		),
		"service-projection.json": canonicalBytes(executionComposition.services),
		"operation-contracts.json": runtimeArtifactBytes(
			runtime.operationContracts,
		),
		"runtime-executables.json": runtimeArtifactBytes(runtime.executables),
		"realtime-wire-contract.json": runtimeArtifactBytes(realtime),
		"wire-contract.json": runtimeArtifactBytes(runtime.wire),
	};
	if (runtime.reactions.reactions.length > 0) {
		generated["reaction-projection.json"] = canonicalBytes(runtime.reactions);
		generated["durable-kernel.json"] = canonicalBytes(runtime.durableKernel);
	}
	if (mutations.projection.mutations.length > 0) {
		generated["mutation-projection.json"] = canonicalBytes(
			mutations.projection,
		);
		generated["mutation-transaction-plans.json"] = canonicalBytes(
			mutations.transactions,
		);
	}
	if (operationSets.sets.sets.length > 0) {
		generated["collection-operation-set-projections.json"] = canonicalBytes(
			operationSets.sets,
		);
		generated["field-normalizer-programs.json"] = canonicalBytes(
			operationSets.normalizers,
		);
		generated["server-value-programs.json"] = canonicalBytes(
			operationSets.serverValues,
		);
		generated["collection-operation-programs.json"] = canonicalBytes(
			operationSets.programs,
		);
		const postgresCollectionOperationPlans =
			lowerPostgresCollectionOperationPlans({
				collectionOperations: operationSets.programs,
				schemaProjection: schema,
				policyProjection: relational.policy,
				normalizerPrograms: operationSets.normalizers,
				serverValuePrograms: operationSets.serverValues,
			});
		if (postgresCollectionOperationPlans.plans.length > 0)
			generated["postgres-collection-operation-plans.json"] = canonicalBytes(
				postgresCollectionOperationPlans,
			);
		generated["collection-operation-explain.json"] = canonicalBytes(
			operationResourceMetadata.explain,
		);
	}
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
	const runtimeCoreBundleEntry = runtimeBundleEntry(
		"@questpie/runtime/bundle-core",
		"bundle-core.js",
	);
	const runtimeRealtimeBundleEntry = runtimeBundleEntry(
		"@questpie/runtime/bundle-realtime",
		"bundle-realtime.js",
	);
	const readinessEntry = join(
		import.meta.dir,
		"runtime",
		`postgres-readiness${extname(fileURLToPath(import.meta.url))}`,
	);
	Object.assign(
		generated,
		await renderApplicationBundle({
			applicationRoot: input.applicationRoot,
			configuration: input.configuration,
			resources: input.resources,
			slots: runtime.executables.slots,
			inventories: input.inventories,
			queryProjection: relational.query,
			schemaProjection: schema,
			collectionOperationArtifacts: operationSets.sets.sets.length > 0,
			reactionArtifact: runtime.reactions.reactions.length > 0,
			realtime: realtimeEnabled,
			readinessEntry,
			runtimeCoreBundleEntry,
			runtimeRealtimeBundleEntry,
		}),
	);
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
			liveQueryDigests: {
				changeLedger: liveQuery.semanticDigests.changeLedger,
				resume: liveQuery.semanticDigests.resume,
			},
			realtimeWireDigest: realtime.digest,
			postgresContextBootstrapPlansDigest: contextBootstrapPlans.digest,
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
