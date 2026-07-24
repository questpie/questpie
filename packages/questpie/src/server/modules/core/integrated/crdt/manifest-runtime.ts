import type { CrdtRuntimeConfig } from "./config.js";
import { createDeterministicSetEngine } from "./deterministic-engine.js";
import {
	type CrdtDesiredManifest,
	type CrdtManifestArtifact,
	type CrdtManifestDeclaration,
	type CrdtManifestFieldContract,
	resolveCrdtDesiredManifest,
	validateCrdtManifestArtifact,
} from "./manifest.js";
import type { CrdtOwnerRegistration, CrdtRegistry } from "./registry.js";

export type CrdtRuntimeManifests = Readonly<{
	collections: Readonly<Record<string, CrdtDesiredManifest>>;
	globals: Readonly<Record<string, CrdtDesiredManifest>>;
}>;

export function createCrdtManifestDeclarations(input: {
	registry: CrdtRegistry;
	config: CrdtRuntimeConfig;
}): readonly CrdtManifestDeclaration[] {
	const setEngine = createDeterministicSetEngine();
	const declarations: CrdtManifestDeclaration[] = [];
	appendOwnerDeclarations(
		declarations,
		1,
		input.registry.collections,
		input.config,
		setEngine,
	);
	appendOwnerDeclarations(
		declarations,
		2,
		input.registry.globals,
		input.config,
		setEngine,
	);
	return Object.freeze(declarations);
}

export function createCrdtRuntimeManifests(input: {
	registry: CrdtRegistry;
	config: CrdtRuntimeConfig | undefined;
	artifact: unknown;
	allowMissingForGeneration?: boolean;
}): CrdtRuntimeManifests {
	const ownerCount =
		Object.keys(input.registry.collections).length +
		Object.keys(input.registry.globals).length;
	if (ownerCount === 0) {
		return Object.freeze({
			collections: Object.freeze({}),
			globals: Object.freeze({}),
		});
	}
	if (!input.config) {
		throw new Error(
			"Collaborative owners require runtimeConfig({ crdt: { namespace } })",
		);
	}
	if (input.allowMissingForGeneration && input.artifact === undefined) {
		createCrdtManifestDeclarations({
			registry: input.registry,
			config: input.config,
		});
		return Object.freeze({
			collections: Object.freeze({}),
			globals: Object.freeze({}),
		});
	}
	const artifact = validateCrdtManifestArtifact(input.artifact);
	if (artifact.namespace !== input.config.namespace) {
		throw new Error("CRDT runtime namespace does not match crdt.manifest.json");
	}
	const declarations = createCrdtManifestDeclarations({
		registry: input.registry,
		config: input.config,
	});
	const byIdentity = new Map(
		declarations.map((declaration) => [
			`${declaration.owner.kind}\0${declaration.owner.key}`,
			declaration,
		]),
	);
	return Object.freeze({
		collections: resolveRegistryKind(
			input.registry.collections,
			1,
			artifact,
			byIdentity,
		),
		globals: resolveRegistryKind(
			input.registry.globals,
			2,
			artifact,
			byIdentity,
		),
	});
}

function resolveRegistryKind(
	owners: Readonly<Record<string, CrdtOwnerRegistration>>,
	kind: 1 | 2,
	artifact: CrdtManifestArtifact,
	declarations: ReadonlyMap<string, CrdtManifestDeclaration>,
): Readonly<Record<string, CrdtDesiredManifest>> {
	const result: Record<string, CrdtDesiredManifest> = {};
	for (const registryKey of Object.keys(owners).sort()) {
		const owner = owners[registryKey]!;
		const declaration = declarations.get(`${kind}\0${owner.ownerName}`);
		if (!declaration) {
			throw new Error(`Missing CRDT declaration for ${owner.ownerName}`);
		}
		result[registryKey] = resolveCrdtDesiredManifest(artifact, declaration);
	}
	return Object.freeze(result);
}

function appendOwnerDeclarations(
	declarations: CrdtManifestDeclaration[],
	kind: 1 | 2,
	owners: Readonly<Record<string, CrdtOwnerRegistration>>,
	config: CrdtRuntimeConfig,
	setEngine: ReturnType<typeof createDeterministicSetEngine>,
): void {
	for (const registryKey of Object.keys(owners).sort()) {
		const registration = owners[registryKey]!;
		const fields: Record<string, CrdtManifestFieldContract> = {};
		for (const sourcePath of Object.keys(registration.fields).sort()) {
			const field = registration.fields[sourcePath]!;
			const engine = field.format === "text" ? config.engines?.text : setEngine;
			if (!engine) {
				throw new Error(
					`CRDT text owner "${registration.ownerName}" requires a configured text engine`,
				);
			}
			if (engine.format !== field.format) {
				throw new Error(
					`CRDT engine format does not match "${registration.ownerName}.${sourcePath}"`,
				);
			}
			fields[sourcePath] = Object.freeze({
				format: field.format,
				formatVersion: engine.formatVersion,
				engineId: engine.engineId,
				engineVersion: engine.engineVersion,
				codecFingerprint: engine.codecFingerprint,
			});
		}
		declarations.push(
			Object.freeze({
				owner: Object.freeze({
					kind,
					key: registration.ownerName,
					identityVersion: 1,
				}),
				fields: Object.freeze(fields),
			}),
		);
	}
}
