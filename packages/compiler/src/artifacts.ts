import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";

import {
	canonicalBytes,
	compareAscii,
	contentDigest,
	digest,
} from "./canonical";
import { projectExecutionComposition } from "./composition";
import {
	renderAppContract,
	renderClientContract,
	renderPackageContract,
} from "./generate";
import { projectManifest, projectMemberContributions } from "./schema";
import type {
	ApplicationConfiguration,
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
	};
	const originMapBytes = canonicalBytes(originMap);
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
	const generated: Record<string, string> = {
		"app.ts": renderAppContract(input.resources, manifest.data, schema),
		"build-input.json": canonicalBytes(buildInput),
		"client.ts": renderClientContract(input.resources),
		"context-projection.json": canonicalBytes(executionComposition.context),
		"internal/package-inventories.json": canonicalBytes(inventoryArtifact),
		"manifest.json": canonicalBytes(manifest),
		"origin-map.json": originMapBytes,
		"schema-projection.json": canonicalBytes(schema),
		"service-projection.json": canonicalBytes(executionComposition.services),
	};
	for (const compilation of input.packageCompilations)
		generated[packageContractPath(compilation.name)] = renderPackageContract(
			compilation.name,
			compilation.resources,
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
