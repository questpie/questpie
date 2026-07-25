export type CrdtEngineFormat = "text" | "set";

export type CrdtEngineBasis = Readonly<{
	fieldEpoch: bigint;
	fieldCursor: bigint;
}>;

export type CrdtEngineLimits = Readonly<{
	maxUpdateBytes: number;
	maxSnapshotBytes: number;
	maxProjectionBytes: number;
	maxOperations: number;
	maxElements: number;
	maxElementBytes: number;
}>;

export const DEFAULT_CRDT_ENGINE_LIMITS: CrdtEngineLimits = Object.freeze({
	maxUpdateBytes: 256 * 1024,
	maxSnapshotBytes: 24 * 1024 * 1024,
	maxProjectionBytes: 16 * 1024 * 1024,
	maxOperations: 4096,
	maxElements: 10_000,
	maxElementBytes: 4096,
});

export type CrdtEngineInspection = Readonly<{
	operationCount: number;
	resultBytes: number;
	elementCount: number;
}>;

export interface CrdtEngineReplica<
	TFormat extends CrdtEngineFormat = CrdtEngineFormat,
	TValue = unknown,
> {
	readonly engineId: string;
	readonly format: TFormat;
	readonly formatVersion: number;
	readonly basis: CrdtEngineBasis;
	readonly state: Uint8Array;
	/** Type-only carrier. Runtime projection is derived from `state`. */
	readonly __value?: TValue;
}

export interface CrdtStagedFieldCandidate<
	TFormat extends CrdtEngineFormat = CrdtEngineFormat,
	TValue = unknown,
> {
	readonly engineId: string;
	readonly format: TFormat;
	readonly formatVersion: number;
	readonly basis: CrdtEngineBasis;
	readonly basisStateHash: Uint8Array;
	readonly normalizedUpdate: Uint8Array;
	readonly nextSnapshot: Uint8Array;
	/**
	 * A preview only. Authority and persistence must derive projection from the
	 * verified committed replica, never trust this value independently.
	 */
	readonly projection: TValue;
	readonly inspection: CrdtEngineInspection;
	readonly token: Uint8Array;
}

export interface CrdtFieldEngine<
	TFormat extends CrdtEngineFormat = CrdtEngineFormat,
	TValue = unknown,
> {
	readonly engineId: string;
	readonly engineVersion: number;
	readonly stateVersion: number;
	readonly codecFingerprint: string;
	readonly format: TFormat;
	readonly formatVersion: number;
	/**
	 * Every method is pure with respect to its inputs: engines must not mutate
	 * replicas, candidates, updates, proofs, or snapshots supplied by the kernel.
	 * Returned replicas and candidates are immutable values.
	 */
	create(input: {
		value: TValue;
		basis: CrdtEngineBasis;
	}): Promise<CrdtEngineReplica<TFormat, TValue>>;
	stage(input: {
		replica: CrdtEngineReplica<TFormat, TValue>;
		update: Uint8Array;
		limits?: Partial<CrdtEngineLimits>;
	}): Promise<CrdtStagedFieldCandidate<TFormat, TValue>>;
	commit(input: {
		candidate: CrdtStagedFieldCandidate<TFormat, TValue>;
		current: CrdtEngineReplica<TFormat, TValue>;
		assignedFieldCursor: bigint;
	}): Promise<CrdtEngineReplica<TFormat, TValue>>;
	proof(replica: CrdtEngineReplica<TFormat, TValue>): Promise<Uint8Array>;
	diff(input: {
		replica: CrdtEngineReplica<TFormat, TValue>;
		proof: Uint8Array;
	}): Promise<
		| Readonly<{ kind: "current" }>
		| Readonly<{ kind: "snapshot"; snapshot: Uint8Array }>
	>;
	snapshot(replica: CrdtEngineReplica<TFormat, TValue>): Promise<Uint8Array>;
	restore(input: {
		snapshot: Uint8Array;
		basis: CrdtEngineBasis;
	}): Promise<CrdtEngineReplica<TFormat, TValue>>;
	project(replica: CrdtEngineReplica<TFormat, TValue>): TValue;
	/**
	 * Release engine-owned resources after the application has stopped accepting
	 * work. Implementations must make repeated calls share the same shutdown.
	 */
	dispose?(): Promise<void>;
}

export class CrdtEngineError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CrdtEngineError";
	}
}

export function resolveCrdtEngineLimits(
	overrides?: Partial<CrdtEngineLimits>,
): CrdtEngineLimits {
	const limits = { ...DEFAULT_CRDT_ENGINE_LIMITS, ...overrides };
	for (const [name, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new CrdtEngineError(`invalid ${name} engine limit`);
		}
		if (value > DEFAULT_CRDT_ENGINE_LIMITS[name as keyof CrdtEngineLimits]) {
			throw new CrdtEngineError(`${name} cannot exceed the hard engine limit`);
		}
	}
	return Object.freeze(limits);
}

export function assertCrdtEngineBasis(
	actual: CrdtEngineBasis,
	expected: CrdtEngineBasis,
	label = "staged candidate basis",
): void {
	if (
		actual.fieldEpoch !== expected.fieldEpoch ||
		actual.fieldCursor !== expected.fieldCursor
	) {
		throw new CrdtEngineError(`${label} does not match current replica`);
	}
}

export async function createCrdtCandidateToken(input: {
	engineId: string;
	format: CrdtEngineFormat;
	formatVersion: number;
	basis: CrdtEngineBasis;
	basisStateHash: Uint8Array;
	normalizedUpdate: Uint8Array;
	nextSnapshot: Uint8Array;
	inspection: CrdtEngineInspection;
}): Promise<Uint8Array> {
	if (
		!(input.basisStateHash instanceof Uint8Array) ||
		input.basisStateHash.byteLength !== 32 ||
		!(input.normalizedUpdate instanceof Uint8Array) ||
		!(input.nextSnapshot instanceof Uint8Array)
	) {
		throw new CrdtEngineError("invalid staged candidate token input");
	}
	assertU32(input.inspection.operationCount, "operation count");
	assertU32(input.inspection.resultBytes, "result bytes");
	assertU32(input.inspection.elementCount, "element count");
	const writer = new CrdtDigestWriter();
	writer.string(input.engineId);
	writer.string(input.format);
	writer.u16(input.formatVersion);
	writer.u64(input.basis.fieldEpoch);
	writer.u64(input.basis.fieldCursor);
	writer.lengthPrefixed(input.basisStateHash);
	writer.lengthPrefixed(input.normalizedUpdate);
	writer.lengthPrefixed(input.nextSnapshot);
	writer.u32(input.inspection.operationCount);
	writer.u32(input.inspection.resultBytes);
	writer.u32(input.inspection.elementCount);
	return sha256(writer.finish());
}

export async function verifyCrdtCandidateToken(
	candidate: CrdtStagedFieldCandidate,
): Promise<void> {
	const expected = await createCrdtCandidateToken(candidate);
	if (!equalBytes(expected, candidate.token)) {
		throw new CrdtEngineError("staged candidate integrity check failed");
	}
}

export async function hashCrdtEngineState(
	state: Uint8Array,
): Promise<Uint8Array> {
	return sha256(state);
}

export async function hashCrdtCanonicalValue(
	format: CrdtEngineFormat,
	value: unknown,
): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const chunks: Uint8Array[] = [
		encoder.encode("questpie-crdt-canonical-value-v1\0"),
		encoder.encode(format),
		new Uint8Array([0]),
	];
	if (format === "text") {
		if (typeof value !== "string") {
			throw new CrdtEngineError("invalid canonical text projection");
		}
		chunks.push(encoder.encode(value));
	} else {
		if (
			!Array.isArray(value) ||
			value.some((entry) => typeof entry !== "string")
		) {
			throw new CrdtEngineError("invalid canonical set projection");
		}
		const encoded = value.map((entry) => encoder.encode(entry));
		for (let index = 0; index < encoded.length; index++) {
			if (
				(index > 0 &&
					compareBytes(encoded[index - 1]!, encoded[index]!) >= 0) ||
				encoded[index]!.byteLength > 4096
			) {
				throw new CrdtEngineError("set projection is not canonical");
			}
		}
		chunks.push(u32Bytes(encoded.length));
		for (const entry of encoded) {
			chunks.push(u32Bytes(entry.byteLength), entry);
		}
	}
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return sha256(bytes);
}

export async function assertCrdtCandidateSourceState(
	candidate: CrdtStagedFieldCandidate,
	state: Uint8Array,
): Promise<void> {
	const actual = await hashCrdtEngineState(state);
	if (!equalBytes(actual, candidate.basisStateHash)) {
		throw new CrdtEngineError(
			"staged candidate source state does not match current replica",
		);
	}
}

export function createCrdtReplica<
	TFormat extends CrdtEngineFormat,
	TValue,
>(input: {
	engineId: string;
	format: TFormat;
	formatVersion: number;
	basis: CrdtEngineBasis;
	state: Uint8Array;
}): CrdtEngineReplica<TFormat, TValue> {
	assertBasisValues(input.basis);
	if (
		!(input.state instanceof Uint8Array) ||
		input.state.byteLength > DEFAULT_CRDT_ENGINE_LIMITS.maxSnapshotBytes
	) {
		throw new CrdtEngineError("replica state exceeds the hard snapshot limit");
	}
	return Object.freeze({
		engineId: input.engineId,
		format: input.format,
		formatVersion: input.formatVersion,
		basis: Object.freeze({ ...input.basis }),
		state: new Uint8Array(input.state),
	});
}

export function assertReplicaBelongsToEngine(
	engine: CrdtFieldEngine,
	replica: CrdtEngineReplica,
): void {
	const engineIdBytes = new TextEncoder().encode(engine.engineId).byteLength;
	if (
		engineIdBytes === 0 ||
		engineIdBytes > 128 ||
		(engine.format !== "text" && engine.format !== "set") ||
		!Number.isSafeInteger(engine.formatVersion) ||
		engine.formatVersion < 0 ||
		engine.formatVersion > 0xffff ||
		!Number.isSafeInteger(engine.engineVersion) ||
		engine.engineVersion < 0 ||
		engine.engineVersion > 0xffff ||
		!Number.isSafeInteger(engine.stateVersion) ||
		engine.stateVersion < 0 ||
		engine.stateVersion > 0xffff ||
		!/^[0-9a-f]{64}$/.test(engine.codecFingerprint)
	) {
		throw new CrdtEngineError("invalid engine identity");
	}
	if (
		replica.engineId !== engine.engineId ||
		replica.format !== engine.format ||
		replica.formatVersion !== engine.formatVersion
	) {
		throw new CrdtEngineError("replica belongs to a different engine");
	}
	if (
		!(replica.state instanceof Uint8Array) ||
		replica.state.byteLength > DEFAULT_CRDT_ENGINE_LIMITS.maxSnapshotBytes
	) {
		throw new CrdtEngineError("replica state exceeds the hard snapshot limit");
	}
	assertBasisValues(replica.basis);
}

type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;
type AnyReplica = CrdtEngineReplica<CrdtEngineFormat, any>;
type AnyCandidate = CrdtStagedFieldCandidate<CrdtEngineFormat, any>;
const stagedAggregateIntegrity = new WeakMap<object, Uint8Array>();

export type CrdtAggregatePartInput = Readonly<{
	/** Current-schema slot used for staging and canonical persistence. */
	fieldSlot: number;
	engine: AnyEngine;
	replica: AnyReplica;
	update: Uint8Array;
	/** Original wire metadata retained for exact old-schema receipt hashing. */
	submitted?: Readonly<{
		fieldSlot: number;
		fieldEpoch: bigint;
		formatVersion: number;
		baseFieldCursor: bigint;
	}>;
	limits?: Partial<CrdtEngineLimits>;
}>;

export type CrdtStagedAggregatePart = Readonly<{
	fieldSlot: number;
	engine: AnyEngine;
	candidate: AnyCandidate;
	submittedUpdate: Uint8Array;
	submitted: Readonly<{
		fieldSlot: number;
		fieldEpoch: bigint;
		formatVersion: number;
		baseFieldCursor: bigint;
	}>;
}>;

export type CrdtStagedAggregateBundle = Readonly<{
	aggregateEpoch: bigint;
	submittedSchemaVersion: number;
	canonicalSchemaVersion: number;
	parts: readonly CrdtStagedAggregatePart[];
	submittedDigest: Uint8Array;
	canonicalDigest: Uint8Array;
	totalUpdateBytes: number;
}>;

export async function hashCrdtSubmittedAggregateBundle(input: {
	aggregateEpoch: bigint;
	schemaVersion: number;
	parts: readonly Readonly<{
		fieldSlot: number;
		fieldEpoch: bigint;
		formatVersion: number;
		baseFieldCursor: bigint;
		bytes: Uint8Array;
	}>[];
}): Promise<Uint8Array> {
	assertU64(input.aggregateEpoch, "aggregate epoch");
	assertU32(input.schemaVersion, "submitted schema version");
	if (input.parts.length === 0 || input.parts.length > 32) {
		throw new CrdtEngineError(
			"aggregate parts must contain between 1 and 32 fields",
		);
	}
	assertStrictlyIncreasingSlots(input.parts);
	const writer = new CrdtDigestWriter();
	writer.u64(input.aggregateEpoch);
	writer.u32(input.schemaVersion);
	writer.u16(input.parts.length);
	let wireBytes = 16 + 8 + 4 + 2;
	for (const part of input.parts) {
		assertU64(part.fieldEpoch, "field epoch");
		assertU16(part.formatVersion, "format version");
		assertU64(part.baseFieldCursor, "base field cursor");
		if (
			!(part.bytes instanceof Uint8Array) ||
			part.bytes.byteLength === 0 ||
			part.bytes.byteLength > 256 * 1024
		) {
			throw new CrdtEngineError("invalid aggregate field update");
		}
		wireBytes += 2 + 8 + 2 + 8 + 4 + part.bytes.byteLength;
		if (wireBytes > 1024 * 1024) {
			throw new CrdtEngineError("aggregate update bundle exceeds limit");
		}
		writer.u16(part.fieldSlot);
		writer.u64(part.fieldEpoch);
		writer.u16(part.formatVersion);
		writer.u64(part.baseFieldCursor);
		writer.lengthPrefixed(part.bytes);
	}
	return sha256(writer.finish());
}

export async function stageCrdtAggregateBundle(input: {
	aggregateEpoch: bigint;
	submittedSchemaVersion: number;
	canonicalSchemaVersion: number;
	parts: readonly CrdtAggregatePartInput[];
	maxBundleBytes?: number;
}): Promise<CrdtStagedAggregateBundle> {
	const aggregateEpoch = input.aggregateEpoch;
	const submittedSchemaVersion = input.submittedSchemaVersion;
	const canonicalSchemaVersion = input.canonicalSchemaVersion;
	const maxBundleBytes = input.maxBundleBytes ?? 1024 * 1024;
	const callerParts = [...input.parts];
	assertU64(aggregateEpoch, "aggregate epoch");
	assertU32(submittedSchemaVersion, "submitted schema version");
	assertU32(canonicalSchemaVersion, "canonical schema version");
	if (callerParts.length === 0 || callerParts.length > 32) {
		throw new CrdtEngineError(
			"aggregate parts must contain between 1 and 32 fields",
		);
	}
	if (
		!Number.isSafeInteger(maxBundleBytes) ||
		maxBundleBytes < 0 ||
		maxBundleBytes > 1024 * 1024
	) {
		throw new CrdtEngineError("invalid aggregate bundle limit");
	}

	// Capture the complete logical request before the first await. Callers own
	// `input` and its part objects, so no asynchronous work may read them again.
	const parts = callerParts.map((part) => {
		const fieldSlot = part.fieldSlot;
		const sourceEngine = part.engine;
		assertReplicaBelongsToEngine(sourceEngine, part.replica);
		if (!(part.update instanceof Uint8Array)) {
			throw new CrdtEngineError("aggregate update must be bytes");
		}
		const engine = captureCrdtEngine(sourceEngine);
		const replica = cloneCrdtReplica(part.replica);
		const update = new Uint8Array(part.update);
		const limits = resolveCrdtEngineLimits(part.limits);
		const submitted = resolveSubmittedMetadata({
			fieldSlot,
			engine,
			replica,
			update,
			limits,
			submitted: part.submitted,
		});
		return Object.freeze({
			fieldSlot,
			engine,
			replica,
			update,
			limits,
			submitted,
		});
	});
	assertStrictlyIncreasingSlots(parts);
	if (
		new Set(parts.map((part) => part.submitted.fieldSlot)).size !== parts.length
	) {
		throw new CrdtEngineError("submitted field slots must be unique");
	}
	let totalUpdateBytes = 0;
	let wireBytes = 16 + 8 + 4 + 2;
	for (const part of parts) {
		if (part.update.byteLength === 0) {
			throw new CrdtEngineError("aggregate field update must be nonempty");
		}
		totalUpdateBytes += part.update.byteLength;
		wireBytes += 2 + 8 + 2 + 8 + 4 + part.update.byteLength;
		if (wireBytes > maxBundleBytes) {
			throw new CrdtEngineError("aggregate update bundle exceeds limit");
		}
	}

	const candidates = await Promise.all(
		parts.map(async (part) => {
			const submittedUpdate = new Uint8Array(part.update);
			const engineUpdate = new Uint8Array(submittedUpdate);
			const stageReplica = cloneCrdtReplica(part.replica);
			const sourceState = new Uint8Array(stageReplica.state);
			const sourceStateHash = await hashCrdtEngineState(sourceState);
			const adapterCandidate = await part.engine.stage({
				replica: stageReplica,
				update: engineUpdate,
				limits: part.limits,
			});
			assertCandidateBelongsToEngine(part.engine, adapterCandidate);
			assertCandidateWithinLimits(adapterCandidate, part.limits);
			const candidate = cloneCrdtCandidate(adapterCandidate);
			assertCandidateBelongsToEngine(part.engine, candidate);
			assertCrdtEngineBasis(candidate.basis, stageReplica.basis);
			if (!equalBytes(sourceState, stageReplica.state)) {
				throw new CrdtEngineError(
					"field engine mutated its source replica while staging",
				);
			}
			if (!equalBytes(submittedUpdate, engineUpdate)) {
				throw new CrdtEngineError(
					"field engine mutated its submitted update while staging",
				);
			}
			if (!equalBytes(sourceStateHash, candidate.basisStateHash)) {
				throw new CrdtEngineError(
					"field engine candidate used the wrong source state",
				);
			}
			await verifyCrdtCandidateToken(candidate);
			return {
				fieldSlot: part.fieldSlot,
				engine: part.engine,
				candidate,
				submittedUpdate,
				submitted: part.submitted,
			};
		}),
	);
	let canonicalWireBytes = 16 + 8 + 4 + 2;
	for (const part of candidates) {
		canonicalWireBytes +=
			2 + 8 + 2 + 8 + 4 + part.candidate.normalizedUpdate.byteLength;
		if (canonicalWireBytes > maxBundleBytes) {
			throw new CrdtEngineError(
				"canonical aggregate update bundle exceeds limit",
			);
		}
	}
	const digestInput = {
		aggregateEpoch,
		submittedSchemaVersion,
		canonicalSchemaVersion,
		parts: candidates,
	};
	const submittedDigest = await computeAggregateDigest(
		digestInput,
		"submitted",
	);
	const canonicalDigest = await computeAggregateDigest(
		digestInput,
		"canonical",
	);
	const staged = Object.freeze({
		aggregateEpoch,
		submittedSchemaVersion,
		canonicalSchemaVersion,
		parts: Object.freeze(
			candidates.map((part) =>
				Object.freeze({
					fieldSlot: part.fieldSlot,
					engine: part.engine,
					candidate: part.candidate,
					submittedUpdate: part.submittedUpdate,
					submitted: part.submitted,
				}),
			),
		),
		submittedDigest,
		canonicalDigest,
		totalUpdateBytes,
	});
	stagedAggregateIntegrity.set(
		staged,
		await computeStagedAggregateIntegrity(staged),
	);
	return staged;
}

export async function commitCrdtAggregateBundle(input: {
	staged: CrdtStagedAggregateBundle;
	current: ReadonlyMap<number, AnyReplica>;
	assignedFieldCursors: ReadonlyMap<number, bigint>;
}): Promise<Map<number, AnyReplica>> {
	const staged = await verifyCrdtStagedAggregateBundle(input.staged);
	const current = new Map(
		[...input.current].map(
			([slot, replica]) => [slot, cloneCrdtReplica(replica)] as const,
		),
	);
	const assignedFieldCursors = new Map(input.assignedFieldCursors);
	for (const part of staged.parts) {
		const currentReplica = current.get(part.fieldSlot);
		const assigned = assignedFieldCursors.get(part.fieldSlot);
		if (!currentReplica || assigned === undefined) {
			throw new CrdtEngineError(
				"aggregate commit is missing a touched field basis or cursor",
			);
		}
		assertCrdtEngineBasis(currentReplica.basis, part.candidate.basis);
		if (assigned !== currentReplica.basis.fieldCursor + 1n) {
			throw new CrdtEngineError("assigned field cursor must be exact-next");
		}
		assertReplicaBelongsToEngine(part.engine, currentReplica);
		assertCandidateBelongsToEngine(part.engine, part.candidate);
		await assertCrdtCandidateSourceState(part.candidate, currentReplica.state);
		await verifyCrdtCandidateToken(part.candidate);
	}

	const committed = await Promise.all(
		staged.parts.map(async (part) => {
			const adapterReplica = await part.engine.commit({
				candidate: cloneCrdtCandidate(part.candidate),
				current: cloneCrdtReplica(current.get(part.fieldSlot)!),
				assignedFieldCursor: assignedFieldCursors.get(part.fieldSlot)!,
			});
			assertReplicaBelongsToEngine(part.engine, adapterReplica);
			// Transfer ownership synchronously in this continuation. Later
			// validation awaits must never retain an adapter-owned reference.
			const replica = cloneCrdtReplica(adapterReplica);
			return [part.fieldSlot, replica] as const;
		}),
	);
	const safeCommitted: Array<readonly [number, AnyReplica]> = [];
	for (let index = 0; index < committed.length; index++) {
		const [fieldSlot, replica] = committed[index]!;
		const part = staged.parts[index]!;
		assertReplicaBelongsToEngine(part.engine, replica);
		if (
			replica.basis.fieldEpoch !== part.candidate.basis.fieldEpoch ||
			replica.basis.fieldCursor !== assignedFieldCursors.get(fieldSlot)! ||
			!equalBytes(
				await hashCrdtEngineState(replica.state),
				await hashCrdtEngineState(part.candidate.nextSnapshot),
			)
		) {
			throw new CrdtEngineError(
				"field engine returned an invalid committed replica",
			);
		}
		safeCommitted.push([fieldSlot, cloneCrdtReplica(replica)]);
	}
	return new Map(safeCommitted);
}

export async function verifyCrdtStagedAggregateBundle(
	input: CrdtStagedAggregateBundle,
): Promise<CrdtStagedAggregateBundle> {
	const expectedIntegrity = stagedAggregateIntegrity.get(input);
	if (!expectedIntegrity) {
		throw new CrdtEngineError("unknown staged aggregate bundle");
	}
	const staged = cloneStagedAggregateBundle(input);
	const actualIntegrity = await computeStagedAggregateIntegrity(staged);
	if (!equalBytes(expectedIntegrity, actualIntegrity)) {
		throw new CrdtEngineError("staged aggregate result integrity check failed");
	}
	const expectedSubmittedDigest = await computeAggregateDigest(
		staged,
		"submitted",
	);
	const expectedCanonicalDigest = await computeAggregateDigest(
		staged,
		"canonical",
	);
	if (
		!equalBytes(expectedSubmittedDigest, staged.submittedDigest) ||
		!equalBytes(expectedCanonicalDigest, staged.canonicalDigest)
	) {
		throw new CrdtEngineError("staged aggregate bundle integrity check failed");
	}
	for (const part of staged.parts) {
		assertCandidateBelongsToEngine(part.engine, part.candidate);
		await verifyCrdtCandidateToken(part.candidate);
	}
	return staged;
}

async function computeAggregateDigest(
	input: {
		aggregateEpoch: bigint;
		submittedSchemaVersion: number;
		canonicalSchemaVersion: number;
		parts: readonly CrdtStagedAggregatePart[];
	},
	source: "submitted" | "canonical",
): Promise<Uint8Array> {
	if (source === "submitted") {
		return hashCrdtSubmittedAggregateBundle({
			aggregateEpoch: input.aggregateEpoch,
			schemaVersion: input.submittedSchemaVersion,
			parts: input.parts.map((part) => ({
				fieldSlot: part.submitted.fieldSlot,
				fieldEpoch: part.submitted.fieldEpoch,
				formatVersion: part.submitted.formatVersion,
				baseFieldCursor: part.submitted.baseFieldCursor,
				bytes: part.submittedUpdate,
			})),
		});
	}
	const writer = new CrdtDigestWriter();
	writer.u64(input.aggregateEpoch);
	writer.u32(input.canonicalSchemaVersion);
	writer.u16(input.parts.length);
	const parts = [...input.parts].sort(
		(left, right) => left.fieldSlot - right.fieldSlot,
	);
	for (const part of parts) {
		const metadata = {
			fieldSlot: part.fieldSlot,
			fieldEpoch: part.candidate.basis.fieldEpoch,
			formatVersion: part.candidate.formatVersion,
			baseFieldCursor: part.candidate.basis.fieldCursor,
		};
		writer.u16(metadata.fieldSlot);
		writer.u64(metadata.fieldEpoch);
		writer.u16(metadata.formatVersion);
		writer.u64(metadata.baseFieldCursor);
		writer.lengthPrefixed(part.candidate.normalizedUpdate);
	}
	return sha256(writer.finish());
}

async function computeStagedAggregateIntegrity(
	staged: CrdtStagedAggregateBundle,
): Promise<Uint8Array> {
	const writer = new CrdtDigestWriter();
	writer.u64(staged.aggregateEpoch);
	writer.u32(staged.submittedSchemaVersion);
	writer.u32(staged.canonicalSchemaVersion);
	writer.u16(staged.parts.length);
	writer.u32(staged.totalUpdateBytes);
	writer.lengthPrefixed(staged.submittedDigest);
	writer.lengthPrefixed(staged.canonicalDigest);
	for (const part of staged.parts) {
		writer.u16(part.fieldSlot);
		writer.lengthPrefixed(part.candidate.token);
	}
	return sha256(writer.finish());
}

function cloneStagedAggregateBundle(
	staged: CrdtStagedAggregateBundle,
): CrdtStagedAggregateBundle {
	return Object.freeze({
		aggregateEpoch: staged.aggregateEpoch,
		submittedSchemaVersion: staged.submittedSchemaVersion,
		canonicalSchemaVersion: staged.canonicalSchemaVersion,
		parts: Object.freeze(
			staged.parts.map((part) =>
				Object.freeze({
					fieldSlot: part.fieldSlot,
					engine: part.engine,
					candidate: cloneCrdtCandidate(part.candidate),
					submittedUpdate: new Uint8Array(part.submittedUpdate),
					submitted: Object.freeze({ ...part.submitted }),
				}),
			),
		),
		submittedDigest: new Uint8Array(staged.submittedDigest),
		canonicalDigest: new Uint8Array(staged.canonicalDigest),
		totalUpdateBytes: staged.totalUpdateBytes,
	});
}

function resolveSubmittedMetadata(
	part: CrdtAggregatePartInput,
): CrdtStagedAggregatePart["submitted"] {
	const metadata =
		part.submitted ??
		({
			fieldSlot: part.fieldSlot,
			fieldEpoch: part.replica.basis.fieldEpoch,
			formatVersion: part.engine.formatVersion,
			baseFieldCursor: part.replica.basis.fieldCursor,
		} as const);
	if (
		!Number.isSafeInteger(metadata.fieldSlot) ||
		metadata.fieldSlot < 0 ||
		metadata.fieldSlot > 0xffff ||
		!Number.isSafeInteger(metadata.formatVersion) ||
		metadata.formatVersion < 0 ||
		metadata.formatVersion > 0xffff
	) {
		throw new CrdtEngineError("invalid submitted field metadata");
	}
	assertU64(metadata.fieldEpoch, "submitted field epoch");
	assertU64(metadata.baseFieldCursor, "submitted base field cursor");
	return Object.freeze({ ...metadata });
}

function captureCrdtEngine(engine: AnyEngine): AnyEngine {
	return Object.freeze({
		engineId: engine.engineId,
		engineVersion: engine.engineVersion,
		stateVersion: engine.stateVersion,
		codecFingerprint: engine.codecFingerprint,
		format: engine.format,
		formatVersion: engine.formatVersion,
		create: engine.create.bind(engine),
		stage: engine.stage.bind(engine),
		commit: engine.commit.bind(engine),
		proof: engine.proof.bind(engine),
		diff: engine.diff.bind(engine),
		snapshot: engine.snapshot.bind(engine),
		restore: engine.restore.bind(engine),
		project: engine.project.bind(engine),
	});
}

function cloneCrdtReplica(replica: AnyReplica): AnyReplica {
	return Object.freeze({
		engineId: replica.engineId,
		format: replica.format,
		formatVersion: replica.formatVersion,
		basis: Object.freeze({ ...replica.basis }),
		state: new Uint8Array(replica.state),
	});
}

function cloneCrdtCandidate(candidate: AnyCandidate): AnyCandidate {
	const projection = Array.isArray(candidate.projection)
		? Object.freeze([...candidate.projection])
		: candidate.projection;
	return Object.freeze({
		engineId: candidate.engineId,
		format: candidate.format,
		formatVersion: candidate.formatVersion,
		basis: Object.freeze({ ...candidate.basis }),
		basisStateHash: new Uint8Array(candidate.basisStateHash),
		normalizedUpdate: new Uint8Array(candidate.normalizedUpdate),
		nextSnapshot: new Uint8Array(candidate.nextSnapshot),
		projection,
		inspection: Object.freeze({ ...candidate.inspection }),
		token: new Uint8Array(candidate.token),
	}) as AnyCandidate;
}

function assertCandidateWithinLimits(
	candidate: AnyCandidate,
	limits: CrdtEngineLimits,
): void {
	const projectionTooLarge =
		(typeof candidate.projection === "string" &&
			candidate.projection.length > limits.maxProjectionBytes) ||
		(Array.isArray(candidate.projection) &&
			candidate.projection.length > limits.maxElements);
	if (
		candidate.normalizedUpdate.byteLength === 0 ||
		candidate.normalizedUpdate.byteLength > limits.maxUpdateBytes ||
		candidate.nextSnapshot.byteLength > limits.maxSnapshotBytes ||
		candidate.inspection.operationCount > limits.maxOperations ||
		candidate.inspection.resultBytes > limits.maxProjectionBytes ||
		candidate.inspection.elementCount > limits.maxElements ||
		projectionTooLarge
	) {
		throw new CrdtEngineError("engine candidate exceeds declared limits");
	}
}

function assertStrictlyIncreasingSlots(
	parts: ReadonlyArray<{ fieldSlot: number }>,
): void {
	let previous = -1;
	for (const part of parts) {
		if (
			!Number.isSafeInteger(part.fieldSlot) ||
			part.fieldSlot < 0 ||
			part.fieldSlot > 0xffff ||
			part.fieldSlot <= previous
		) {
			throw new CrdtEngineError(
				"aggregate field slots must be strictly increasing",
			);
		}
		previous = part.fieldSlot;
	}
}

function assertCandidateBelongsToEngine(
	engine: AnyEngine,
	candidate: AnyCandidate,
): void {
	if (
		candidate.engineId !== engine.engineId ||
		candidate.format !== engine.format ||
		candidate.formatVersion !== engine.formatVersion
	) {
		throw new CrdtEngineError("staged candidate belongs to a different engine");
	}
	if (
		!(candidate.normalizedUpdate instanceof Uint8Array) ||
		!(candidate.nextSnapshot instanceof Uint8Array) ||
		!(candidate.basisStateHash instanceof Uint8Array) ||
		candidate.basisStateHash.byteLength !== 32 ||
		!(candidate.token instanceof Uint8Array) ||
		candidate.token.byteLength !== 32 ||
		typeof candidate.inspection !== "object" ||
		candidate.inspection === null ||
		!Number.isSafeInteger(candidate.inspection.operationCount) ||
		candidate.inspection.operationCount < 0 ||
		!Number.isSafeInteger(candidate.inspection.resultBytes) ||
		candidate.inspection.resultBytes < 0 ||
		!Number.isSafeInteger(candidate.inspection.elementCount) ||
		candidate.inspection.elementCount < 0
	) {
		throw new CrdtEngineError("invalid staged candidate bytes");
	}
}

function assertBasisValues(basis: CrdtEngineBasis): void {
	assertU64(basis.fieldEpoch, "field epoch");
	assertU64(basis.fieldCursor, "field cursor");
}

function assertU64(value: bigint, label: string): void {
	if (typeof value !== "bigint" || value < 0n || value > (1n << 64n) - 1n) {
		throw new CrdtEngineError(`invalid ${label}`);
	}
}

function assertU32(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
		throw new CrdtEngineError(`invalid ${label}`);
	}
}

function assertU16(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
		throw new CrdtEngineError(`invalid ${label}`);
	}
}

class CrdtDigestWriter {
	private readonly chunks: Uint8Array[] = [];
	private size = 0;

	u16(value: number): void {
		if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
			throw new CrdtEngineError("invalid digest u16");
		}
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.push(bytes);
	}

	u32(value: number): void {
		assertU32(value, "digest u32");
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.push(bytes);
	}

	u64(value: bigint): void {
		assertU64(value, "digest u64");
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value);
		this.push(bytes);
	}

	string(value: string): void {
		this.lengthPrefixed(new TextEncoder().encode(value));
	}

	lengthPrefixed(value: Uint8Array): void {
		this.u32(value.byteLength);
		this.push(value);
	}

	finish(): Uint8Array {
		const bytes = new Uint8Array(this.size);
		let offset = 0;
		for (const chunk of this.chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	}

	private push(value: Uint8Array): void {
		this.chunks.push(value);
		this.size += value.byteLength;
	}
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
	const bytes = new Uint8Array(value.byteLength);
	bytes.set(value);
	return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index++) {
		difference |= left[index]! ^ right[index]!;
	}
	return difference === 0;
}

function u32Bytes(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setUint32(0, value);
	return bytes;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
	const length = Math.min(left.byteLength, right.byteLength);
	for (let index = 0; index < length; index++) {
		if (left[index] !== right[index]) return left[index]! - right[index]!;
	}
	return left.byteLength - right.byteLength;
}
