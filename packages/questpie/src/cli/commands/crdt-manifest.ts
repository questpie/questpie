import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Questpie } from "#questpie/server/config/questpie.js";
import type { CrdtRuntimeConfig } from "#questpie/server/modules/core/integrated/crdt/config.js";
import { createDeterministicSetEngine } from "#questpie/server/modules/core/integrated/crdt/deterministic-engine.js";
import {
	CRDT_MANIFEST_FILENAME,
	type CrdtManifestArtifact,
	type CrdtManifestDeclaration,
	type CrdtManifestFieldContract,
	type CrdtManifestRename,
	serializeCrdtManifestArtifact,
	updateCrdtManifestArtifact,
} from "#questpie/server/modules/core/integrated/crdt/manifest.js";
import type {
	CrdtOwnerRegistration,
	CrdtRegistry,
} from "#questpie/server/modules/core/integrated/crdt/registry.js";

import { loadQuestpieConfig, resolveConfigRoot } from "../config.js";
import { resolveCliPath } from "../utils.js";

export type WriteCrdtManifestResult = Readonly<{
	path: string;
	changed: boolean;
	artifact: CrdtManifestArtifact;
}>;

export async function generateCrdtManifestCommand(options: {
	configPath: string;
	renames?: readonly string[];
}): Promise<WriteCrdtManifestResult | undefined> {
	const requestedConfigPath = resolveCliPath(options.configPath);
	const { configPath, rootDir } = await resolveConfigRoot(requestedConfigPath);
	const loaded = await loadQuestpieConfig(configPath);
	const app = loaded.app as Questpie;
	const registry = app.crdtRegistry;
	const ownerCount =
		Object.keys(registry.collections).length +
		Object.keys(registry.globals).length;
	if (ownerCount === 0 && app.config.crdt === undefined) {
		console.log("No collaborative owners; CRDT runtime remains dormant.");
		return undefined;
	}
	if (app.config.crdt === undefined) {
		throw new Error(
			"Collaborative owners require runtimeConfig({ crdt: { namespace } })",
		);
	}

	const declarations = createCrdtManifestDeclarations({
		registry,
		config: app.config.crdt,
	});
	const renames = parseCrdtManifestRenames(options.renames ?? [], declarations);
	const result = await writeCrdtManifestFile({
		rootDir,
		namespace: app.config.crdt.namespace,
		declarations,
		renames,
	});
	console.log(
		result.changed
			? `Generated ${result.path}`
			: `${result.path} is already current`,
	);
	return result;
}

export function createCrdtManifestDeclarations(input: {
	registry: CrdtRegistry;
	config: CrdtRuntimeConfig;
}): readonly CrdtManifestDeclaration[] {
	const setEngine = createDeterministicSetEngine();
	const declarations: CrdtManifestDeclaration[] = [];
	appendOwnerDeclarations({
		declarations,
		kind: 1,
		owners: input.registry.collections,
		config: input.config,
		setEngine,
	});
	appendOwnerDeclarations({
		declarations,
		kind: 2,
		owners: input.registry.globals,
		config: input.config,
		setEngine,
	});
	return Object.freeze(declarations);
}

export async function writeCrdtManifestFile(input: {
	rootDir: string;
	namespace: string;
	declarations: readonly CrdtManifestDeclaration[];
	renames?: readonly CrdtManifestRename[];
	createStableFieldId?: () => string;
}): Promise<WriteCrdtManifestResult> {
	const path = join(input.rootDir, CRDT_MANIFEST_FILENAME);
	const previousText = await readOptionalFile(path);
	let previous: CrdtManifestArtifact | undefined;
	if (previousText !== undefined) {
		try {
			previous = JSON.parse(previousText) as CrdtManifestArtifact;
		} catch {
			throw new TypeError(`Invalid JSON in ${path}`);
		}
	}
	const artifact = updateCrdtManifestArtifact({
		namespace: input.namespace,
		declarations: input.declarations,
		previous,
		renames: input.renames,
		createStableFieldId: input.createStableFieldId ?? randomUUID,
	});
	const nextText = serializeCrdtManifestArtifact(artifact);
	if (nextText === previousText) {
		return Object.freeze({ path, changed: false, artifact });
	}

	const temporaryPath = join(
		input.rootDir,
		`.${CRDT_MANIFEST_FILENAME}.${randomUUID()}.tmp`,
	);
	try {
		await writeFile(temporaryPath, nextText, {
			encoding: "utf8",
			flag: "wx",
		});
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
	return Object.freeze({ path, changed: true, artifact });
}

function appendOwnerDeclarations(input: {
	declarations: CrdtManifestDeclaration[];
	kind: 1 | 2;
	owners: Readonly<Record<string, CrdtOwnerRegistration>>;
	config: CrdtRuntimeConfig;
	setEngine: ReturnType<typeof createDeterministicSetEngine>;
}): void {
	for (const registryKey of Object.keys(input.owners).sort()) {
		const registration = input.owners[registryKey]!;
		const fields: Record<string, CrdtManifestFieldContract> = {};
		for (const sourcePath of Object.keys(registration.fields).sort()) {
			const field = registration.fields[sourcePath]!;
			const engine =
				field.format === "text" ? input.config.engines?.text : input.setEngine;
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
		input.declarations.push(
			Object.freeze({
				owner: Object.freeze({
					kind: input.kind,
					key: registration.ownerName,
					identityVersion: 1,
				}),
				fields: Object.freeze(fields),
			}),
		);
	}
}

function parseCrdtManifestRenames(
	values: readonly string[],
	declarations: readonly CrdtManifestDeclaration[],
): readonly CrdtManifestRename[] {
	const owners = new Map(
		declarations.map((declaration) => [
			`${declaration.owner.kind}:${declaration.owner.key}`,
			declaration.owner,
		]),
	);
	return Object.freeze(
		values.map((value) => {
			const match = /^(collection|global):([^:]+):([^=]+)=(.+)$/.exec(value);
			if (!match) {
				throw new TypeError(
					`Invalid CRDT rename "${value}"; expected collection:owner:newPath=oldPath`,
				);
			}
			const kind = match[1] === "collection" ? 1 : 2;
			const owner = owners.get(`${kind}:${match[2]}`);
			if (!owner) {
				throw new TypeError(`Unknown CRDT rename owner "${match[2]}"`);
			}
			return Object.freeze({
				owner,
				to: match[3]!,
				from: match[4]!,
			});
		}),
	);
}

async function readOptionalFile(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return undefined;
		}
		throw error;
	}
}
