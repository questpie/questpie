import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

export const CRDT_MANIFEST_ARTIFACT_VERSION = 1 as const;
export const CRDT_MANIFEST_FILENAME = "crdt.manifest.json";

export type CrdtManifestOwnerIdentity = Readonly<{
	kind: 1 | 2;
	key: string;
	identityVersion: number;
}>;

export type CrdtManifestFieldContract = Readonly<{
	format: "text" | "set";
	formatVersion: number;
	engineId: string;
	engineVersion: number;
	codecFingerprint: string;
}>;

export type CrdtManifestDeclaration = Readonly<{
	owner: CrdtManifestOwnerIdentity;
	fields: Readonly<Record<string, CrdtManifestFieldContract>>;
}>;

export type CrdtManifestArtifactField = Readonly<
	CrdtManifestFieldContract & {
		stableFieldId: string;
		fieldSlot: number;
		sourcePath: string;
	}
>;

export type CrdtManifestArtifactSchema = Readonly<{
	version: number;
	fingerprint: string;
	predecessorFingerprint: string | null;
	fields: readonly CrdtManifestArtifactField[];
}>;

export type CrdtManifestArtifactOwner = Readonly<{
	owner: CrdtManifestOwnerIdentity;
	schemas: readonly CrdtManifestArtifactSchema[];
}>;

export type CrdtManifestArtifact = Readonly<{
	artifactVersion: typeof CRDT_MANIFEST_ARTIFACT_VERSION;
	namespace: string;
	owners: readonly CrdtManifestArtifactOwner[];
}>;

export type CrdtManifestRename = Readonly<{
	owner: CrdtManifestOwnerIdentity;
	from: string;
	to: string;
}>;

export type CrdtDesiredManifestField = Readonly<{
	stableFieldId: string;
	fieldSlot: number;
	sourcePath: string;
	format: "text" | "set";
	formatVersion: number;
	engineId: string;
	engineVersion: number;
	codecFingerprint: Uint8Array;
}>;

export type CrdtDesiredManifest = Readonly<{
	namespace: string;
	owner: CrdtManifestOwnerIdentity;
	version: number;
	fingerprint: Uint8Array;
	predecessorFingerprint: Uint8Array | null;
	fields: readonly CrdtDesiredManifestField[];
}>;

/**
 * CLI-only manifest transition primitive. Runtime callers must use
 * resolveCrdtDesiredManifest and can therefore never assign durable identities.
 */
export function updateCrdtManifestArtifact(input: {
	readonly namespace: string;
	readonly declarations: readonly CrdtManifestDeclaration[];
	readonly previous?: CrdtManifestArtifact;
	readonly renames?: readonly CrdtManifestRename[];
	readonly createStableFieldId: () => string;
}): CrdtManifestArtifact {
	validateAscii(input.namespace, 64, "CRDT namespace");
	const previous = input.previous
		? validateCrdtManifestArtifact(input.previous)
		: undefined;
	if (previous && previous.namespace !== input.namespace) {
		throw new TypeError("CRDT manifest namespace cannot change");
	}

	const declarations = snapshotDeclarations(input.declarations);
	const declarationKeys = new Set(
		declarations.map(({ owner }) => ownerIdentityKey(owner)),
	);
	for (const historical of previous?.owners ?? []) {
		if (!declarationKeys.has(ownerIdentityKey(historical.owner))) {
			throw new TypeError(
				`CRDT owner removal requires an explicit manifest migration (${historical.owner.key})`,
			);
		}
	}

	const renameMap = snapshotRenames(input.renames);
	const previousByOwner = new Map(
		previous?.owners.map((entry) => [ownerIdentityKey(entry.owner), entry]) ??
			[],
	);
	const owners = declarations.map((declaration) => {
		const key = ownerIdentityKey(declaration.owner);
		const historical = previousByOwner.get(key);
		if (!historical) {
			const fields = assignInitialFields(
				declaration.fields,
				input.createStableFieldId,
			);
			return freezeArtifactOwner({
				owner: declaration.owner,
				schemas: [
					createArtifactSchema({
						namespace: input.namespace,
						owner: declaration.owner,
						version: 1,
						predecessorFingerprint: null,
						fields,
					}),
				],
			});
		}

		const current = historical.schemas.at(-1)!;
		const fields = transitionFields({
			declaration,
			current,
			renames: renameMap.get(key) ?? new Map(),
			createStableFieldId: input.createStableFieldId,
		});
		if (equalArtifactFields(fields, current.fields)) {
			return historical;
		}
		const next = createArtifactSchema({
			namespace: input.namespace,
			owner: declaration.owner,
			version: current.version + 1,
			predecessorFingerprint: current.fingerprint,
			fields,
		});
		return freezeArtifactOwner({
			owner: declaration.owner,
			schemas: [...historical.schemas, next],
		});
	});

	return freezeArtifact({
		artifactVersion: CRDT_MANIFEST_ARTIFACT_VERSION,
		namespace: input.namespace,
		owners,
	});
}

/**
 * Runtime/codegen validation path. The declaration must exactly match the
 * checked-in current schema; missing or stale artifacts fail closed.
 */
export function resolveCrdtDesiredManifest(
	artifactInput: unknown,
	declarationInput: CrdtManifestDeclaration,
): CrdtDesiredManifest {
	const artifact = validateCrdtManifestArtifact(artifactInput);
	const [declaration] = snapshotDeclarations([declarationInput]);
	const owner = artifact.owners.find(
		(candidate) =>
			ownerIdentityKey(candidate.owner) === ownerIdentityKey(declaration.owner),
	);
	if (!owner) {
		throw new TypeError(
			`CRDT manifest is missing owner ${declaration.owner.key}; run questpie crdt:manifest`,
		);
	}
	const current = owner.schemas.at(-1)!;
	assertDeclarationMatchesSchema(declaration, current);

	return Object.freeze({
		namespace: artifact.namespace,
		owner: Object.freeze({ ...owner.owner }),
		version: current.version,
		fingerprint: decodeHash(current.fingerprint, "CRDT schema fingerprint"),
		predecessorFingerprint: current.predecessorFingerprint
			? decodeHash(
					current.predecessorFingerprint,
					"CRDT predecessor fingerprint",
				)
			: null,
		fields: Object.freeze(
			current.fields.map((field) =>
				Object.freeze({
					...field,
					codecFingerprint: decodeHash(
						field.codecFingerprint,
						"CRDT codec fingerprint",
					),
				}),
			),
		),
	});
}

export function validateCrdtManifestArtifact(
	input: unknown,
): CrdtManifestArtifact {
	if (!isRecord(input) || input.artifactVersion !== 1) {
		throw new TypeError("Unsupported CRDT manifest artifact version");
	}
	validateAscii(input.namespace, 64, "CRDT namespace");
	if (!Array.isArray(input.owners)) {
		throw new TypeError("CRDT manifest owners must be an array");
	}
	const ownerKeys = new Set<string>();
	const owners = input.owners.map((value) => {
		if (!isRecord(value) || !isRecord(value.owner)) {
			throw new TypeError("Invalid CRDT manifest owner");
		}
		const owner = snapshotOwner(value.owner);
		const ownerKey = ownerIdentityKey(owner);
		if (ownerKeys.has(ownerKey)) {
			throw new TypeError("CRDT manifest owner identity is duplicated");
		}
		ownerKeys.add(ownerKey);
		if (!Array.isArray(value.schemas) || value.schemas.length < 1) {
			throw new TypeError("CRDT manifest owner must contain a schema");
		}
		const stableContracts = new Map<
			string,
			Pick<
				CrdtManifestArtifactField,
				"fieldSlot" | "format" | "formatVersion" | "engineId" | "engineVersion"
			> & { codecFingerprint: string }
		>();
		let predecessor: string | null = null;
		const schemas = value.schemas.map((candidate, index) => {
			const schema = snapshotArtifactSchema(candidate);
			if (schema.version !== index + 1) {
				throw new TypeError("CRDT manifest schema versions must be contiguous");
			}
			if (schema.predecessorFingerprint !== predecessor) {
				throw new TypeError("CRDT manifest predecessor chain is invalid");
			}
			for (const field of schema.fields) {
				const stable = stableContracts.get(field.stableFieldId);
				if (
					stable &&
					(stable.fieldSlot !== field.fieldSlot ||
						stable.format !== field.format ||
						stable.formatVersion !== field.formatVersion ||
						stable.engineId !== field.engineId ||
						stable.engineVersion !== field.engineVersion ||
						stable.codecFingerprint !== field.codecFingerprint)
				) {
					throw new TypeError(
						"CRDT stable field identity changed its permanent contract",
					);
				}
				stableContracts.set(field.stableFieldId, field);
			}
			const expected = schemaFingerprint({
				namespace: input.namespace,
				owner,
				version: schema.version,
				predecessorFingerprint: schema.predecessorFingerprint,
				fields: schema.fields,
			});
			if (schema.fingerprint !== expected) {
				throw new TypeError("CRDT manifest schema fingerprint is invalid");
			}
			predecessor = schema.fingerprint;
			return schema;
		});
		return freezeArtifactOwner({ owner, schemas });
	});
	owners.sort(compareOwners);
	return freezeArtifact({
		artifactVersion: CRDT_MANIFEST_ARTIFACT_VERSION,
		namespace: input.namespace,
		owners,
	});
}

export function serializeCrdtManifestArtifact(
	artifact: CrdtManifestArtifact,
): string {
	return `${JSON.stringify(validateCrdtManifestArtifact(artifact), null, "\t")}\n`;
}

function snapshotDeclarations(
	input: readonly CrdtManifestDeclaration[],
): CrdtManifestDeclaration[] {
	const seen = new Set<string>();
	const result = input.map((entry) => {
		const owner = snapshotOwner(entry.owner);
		const key = ownerIdentityKey(owner);
		if (seen.has(key)) {
			throw new TypeError("CRDT manifest declaration owner is duplicated");
		}
		seen.add(key);
		const fields: Record<string, CrdtManifestFieldContract> = {};
		for (const sourcePath of Object.keys(entry.fields).sort()) {
			validateSourcePath(sourcePath);
			fields[sourcePath] = snapshotFieldContract(entry.fields[sourcePath]!);
		}
		if (Object.keys(fields).length < 1 || Object.keys(fields).length > 32) {
			throw new TypeError("CRDT manifest must contain between 1 and 32 fields");
		}
		return Object.freeze({ owner, fields: Object.freeze(fields) });
	});
	result.sort((left, right) =>
		compareOwners({ owner: left.owner }, { owner: right.owner }),
	);
	return result;
}

function snapshotOwner(input: unknown): CrdtManifestOwnerIdentity {
	if (!isRecord(input)) throw new TypeError("Invalid CRDT owner identity");
	validateAscii(input.key, 128, "CRDT owner key");
	if (input.kind !== 1 && input.kind !== 2) {
		throw new TypeError("CRDT owner kind must identify a collection or global");
	}
	if (!Number.isInteger(input.identityVersion) || input.identityVersion < 1) {
		throw new TypeError("CRDT owner identity version must be positive");
	}
	return Object.freeze({
		kind: input.kind,
		key: input.key,
		identityVersion: input.identityVersion,
	});
}

function snapshotFieldContract(input: unknown): CrdtManifestFieldContract {
	if (!isRecord(input) || (input.format !== "text" && input.format !== "set")) {
		throw new TypeError("CRDT field format is invalid");
	}
	validateVersion(input.formatVersion, 65_535, "CRDT field format version");
	validateAscii(input.engineId, 128, "CRDT engine ID");
	validateVersion(input.engineVersion, 4_294_967_295, "CRDT engine version");
	validateHashHex(input.codecFingerprint, "CRDT codec fingerprint");
	return Object.freeze({
		format: input.format,
		formatVersion: input.formatVersion,
		engineId: input.engineId,
		engineVersion: input.engineVersion,
		codecFingerprint: input.codecFingerprint,
	});
}

function snapshotArtifactSchema(input: unknown): CrdtManifestArtifactSchema {
	if (!isRecord(input)) throw new TypeError("Invalid CRDT manifest schema");
	validateVersion(input.version, 4_294_967_295, "CRDT schema version", 1);
	validateHashHex(input.fingerprint, "CRDT schema fingerprint");
	if (input.predecessorFingerprint !== null) {
		validateHashHex(
			input.predecessorFingerprint,
			"CRDT predecessor fingerprint",
		);
	}
	if (
		!Array.isArray(input.fields) ||
		input.fields.length < 1 ||
		input.fields.length > 32
	) {
		throw new TypeError("CRDT manifest must contain between 1 and 32 fields");
	}
	const slots = new Set<number>();
	const paths = new Set<string>();
	const ids = new Set<string>();
	const fields = input.fields.map((value) => {
		if (!isRecord(value)) throw new TypeError("Invalid CRDT manifest field");
		assertUuid(value.stableFieldId);
		validateVersion(value.fieldSlot, 65_535, "CRDT field slot", 1);
		validateSourcePath(value.sourcePath);
		if (
			slots.has(value.fieldSlot) ||
			paths.has(value.sourcePath) ||
			ids.has(value.stableFieldId)
		) {
			throw new TypeError("CRDT manifest field identity is duplicated");
		}
		slots.add(value.fieldSlot);
		paths.add(value.sourcePath);
		ids.add(value.stableFieldId);
		return Object.freeze({
			...snapshotFieldContract(value),
			stableFieldId: value.stableFieldId,
			fieldSlot: value.fieldSlot,
			sourcePath: value.sourcePath,
		});
	});
	fields.sort((left, right) => left.fieldSlot - right.fieldSlot);
	return Object.freeze({
		version: input.version,
		fingerprint: input.fingerprint,
		predecessorFingerprint: input.predecessorFingerprint,
		fields: Object.freeze(fields),
	});
}

function assignInitialFields(
	fields: Readonly<Record<string, CrdtManifestFieldContract>>,
	createStableFieldId: () => string,
): readonly CrdtManifestArtifactField[] {
	return Object.freeze(
		Object.keys(fields)
			.sort()
			.map((sourcePath, index) =>
				createArtifactField({
					...fields[sourcePath]!,
					sourcePath,
					fieldSlot: index + 1,
					stableFieldId: createStableFieldId(),
				}),
			),
	);
}

function transitionFields(input: {
	declaration: CrdtManifestDeclaration;
	current: CrdtManifestArtifactSchema;
	renames: ReadonlyMap<string, string>;
	createStableFieldId: () => string;
}): readonly CrdtManifestArtifactField[] {
	const currentByPath = new Map(
		input.current.fields.map((field) => [field.sourcePath, field]),
	);
	const renamedFrom = new Set<string>();
	for (const [to, from] of input.renames) {
		if (
			!Object.hasOwn(input.declaration.fields, to) ||
			!currentByPath.has(from) ||
			to === from ||
			renamedFrom.has(from)
		) {
			throw new TypeError("CRDT generated rename mapping is invalid");
		}
		renamedFrom.add(from);
	}

	const result: CrdtManifestArtifactField[] = [];
	const assigned = new Set<string>();
	for (const previous of input.current.fields) {
		const nextPath = Object.hasOwn(
			input.declaration.fields,
			previous.sourcePath,
		)
			? previous.sourcePath
			: [...input.renames].find(
					([, from]) => from === previous.sourcePath,
				)?.[0];
		if (!nextPath) {
			throw new TypeError(
				`CRDT field removal or rename requires an explicit generated migration (${previous.sourcePath})`,
			);
		}
		const contract = input.declaration.fields[nextPath]!;
		assertCompatibleFieldContract(previous, contract, nextPath);
		assigned.add(nextPath);
		result.push(
			createArtifactField({
				...contract,
				stableFieldId: previous.stableFieldId,
				fieldSlot: previous.fieldSlot,
				sourcePath: nextPath,
			}),
		);
	}
	let nextSlot = input.current.fields.reduce(
		(maximum, field) => Math.max(maximum, field.fieldSlot),
		0,
	);
	for (const sourcePath of Object.keys(input.declaration.fields).sort()) {
		if (assigned.has(sourcePath)) continue;
		nextSlot += 1;
		result.push(
			createArtifactField({
				...input.declaration.fields[sourcePath]!,
				stableFieldId: input.createStableFieldId(),
				fieldSlot: nextSlot,
				sourcePath,
			}),
		);
	}
	result.sort((left, right) => left.fieldSlot - right.fieldSlot);
	return Object.freeze(result);
}

function createArtifactField(
	field: CrdtManifestArtifactField,
): CrdtManifestArtifactField {
	assertUuid(field.stableFieldId);
	return Object.freeze({ ...field });
}

function createArtifactSchema(input: {
	namespace: string;
	owner: CrdtManifestOwnerIdentity;
	version: number;
	predecessorFingerprint: string | null;
	fields: readonly CrdtManifestArtifactField[];
}): CrdtManifestArtifactSchema {
	return Object.freeze({
		version: input.version,
		fingerprint: schemaFingerprint(input),
		predecessorFingerprint: input.predecessorFingerprint,
		fields: input.fields,
	});
}

function assertDeclarationMatchesSchema(
	declaration: CrdtManifestDeclaration,
	schema: CrdtManifestArtifactSchema,
): void {
	const paths = Object.keys(declaration.fields).sort();
	if (
		paths.length !== schema.fields.length ||
		schema.fields.some((field) => {
			const declared = declaration.fields[field.sourcePath];
			return !declared || !equalFieldContract(field, declared);
		})
	) {
		throw new TypeError(
			`CRDT manifest is stale for owner ${declaration.owner.key}; run questpie crdt:manifest`,
		);
	}
}

function assertCompatibleFieldContract(
	previous: CrdtManifestArtifactField,
	next: CrdtManifestFieldContract,
	path: string,
): void {
	if (!equalFieldContract(previous, next)) {
		throw new TypeError(
			`CRDT field contract change requires an explicit incompatible manifest migration (${path})`,
		);
	}
}

function equalFieldContract(
	left: CrdtManifestFieldContract,
	right: CrdtManifestFieldContract,
): boolean {
	return (
		left.format === right.format &&
		left.formatVersion === right.formatVersion &&
		left.engineId === right.engineId &&
		left.engineVersion === right.engineVersion &&
		left.codecFingerprint === right.codecFingerprint
	);
}

function equalArtifactFields(
	left: readonly CrdtManifestArtifactField[],
	right: readonly CrdtManifestArtifactField[],
): boolean {
	return (
		left.length === right.length &&
		left.every((field, index) => {
			const candidate = right[index];
			return (
				candidate !== undefined &&
				field.stableFieldId === candidate.stableFieldId &&
				field.fieldSlot === candidate.fieldSlot &&
				field.sourcePath === candidate.sourcePath &&
				equalFieldContract(field, candidate)
			);
		})
	);
}

function snapshotRenames(
	input: readonly CrdtManifestRename[] | undefined,
): Map<string, Map<string, string>> {
	const result = new Map<string, Map<string, string>>();
	for (const rename of input ?? []) {
		const owner = snapshotOwner(rename.owner);
		validateSourcePath(rename.from);
		validateSourcePath(rename.to);
		const ownerKey = ownerIdentityKey(owner);
		const mappings = result.get(ownerKey) ?? new Map<string, string>();
		if (mappings.has(rename.to)) {
			throw new TypeError("CRDT generated rename mapping is duplicated");
		}
		mappings.set(rename.to, rename.from);
		result.set(ownerKey, mappings);
	}
	return result;
}

function schemaFingerprint(input: {
	namespace: string;
	owner: CrdtManifestOwnerIdentity;
	version: number;
	predecessorFingerprint: string | null;
	fields: readonly CrdtManifestArtifactField[];
}): string {
	const hash = createHash("sha256");
	hash.update("questpie-crdt-owner-manifest-v2\0");
	hash.update(input.namespace);
	hash.update("\0");
	hash.update(String(input.owner.kind));
	hash.update("\0");
	hash.update(input.owner.key);
	hash.update("\0");
	writeU32(hash, input.owner.identityVersion);
	writeU32(hash, input.version);
	hash.update(input.predecessorFingerprint ?? "");
	hash.update("\0");
	for (const field of input.fields) {
		hash.update(field.stableFieldId);
		hash.update("\0");
		writeU32(hash, field.fieldSlot);
		hash.update(field.sourcePath);
		hash.update("\0");
		hash.update(field.format);
		hash.update("\0");
		writeU32(hash, field.formatVersion);
		hash.update(field.engineId);
		hash.update("\0");
		writeU32(hash, field.engineVersion);
		hash.update(Buffer.from(field.codecFingerprint, "hex"));
	}
	return hash.digest("hex");
}

function writeU32(hash: ReturnType<typeof createHash>, value: number): void {
	const bytes = Buffer.allocUnsafe(4);
	bytes.writeUInt32BE(value);
	hash.update(bytes);
}

function ownerIdentityKey(owner: CrdtManifestOwnerIdentity): string {
	return `${owner.kind}\0${owner.key}\0${owner.identityVersion}`;
}

function compareOwners(
	left: Pick<CrdtManifestArtifactOwner, "owner">,
	right: Pick<CrdtManifestArtifactOwner, "owner">,
): number {
	return (
		left.owner.kind - right.owner.kind ||
		left.owner.key.localeCompare(right.owner.key) ||
		left.owner.identityVersion - right.owner.identityVersion
	);
}

function freezeArtifact(input: CrdtManifestArtifact): CrdtManifestArtifact {
	return Object.freeze({
		artifactVersion: CRDT_MANIFEST_ARTIFACT_VERSION,
		namespace: input.namespace,
		owners: Object.freeze([...input.owners]),
	});
}

function freezeArtifactOwner(
	input: CrdtManifestArtifactOwner,
): CrdtManifestArtifactOwner {
	return Object.freeze({
		owner: Object.freeze({ ...input.owner }),
		schemas: Object.freeze([...input.schemas]),
	});
}

function validateAscii(value: unknown, maximum: number, label: string): void {
	if (
		typeof value !== "string" ||
		value.length < 1 ||
		value.length > maximum ||
		!/^[\x21-\x7e]+$/.test(value)
	) {
		throw new TypeError(
			`${label} must contain between 1 and ${maximum} printable ASCII bytes`,
		);
	}
}

function validateSourcePath(value: unknown): asserts value is string {
	if (
		typeof value !== "string" ||
		value.length < 1 ||
		new TextEncoder().encode(value).byteLength > 256
	) {
		throw new TypeError("CRDT field source path is invalid");
	}
}

function validateVersion(
	value: unknown,
	maximum: number,
	label: string,
	minimum = 0,
): asserts value is number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new TypeError(`${label} is invalid`);
	}
}

function validateHashHex(
	value: unknown,
	label: string,
): asserts value is string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
		throw new TypeError(`${label} must contain 32 lowercase hexadecimal bytes`);
	}
}

function decodeHash(value: string, label: string): Uint8Array {
	validateHashHex(value, label);
	return Buffer.from(value, "hex");
}

function assertUuid(value: unknown): asserts value is string {
	if (
		typeof value !== "string" ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			value,
		)
	) {
		throw new TypeError("CRDT stable field ID must be a UUID");
	}
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
