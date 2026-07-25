import { Buffer } from "node:buffer";
import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

import {
	and,
	asc,
	count,
	eq,
	gt,
	inArray,
	isNull,
	sql,
	sum,
} from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type {
	CrdtEngineFormat,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";
import {
	CRDT_EXCHANGE_V1_HEADER_BYTES,
	CRDT_EXCHANGE_V1_MAX_BODY_BYTES,
	CrdtExchangeProtocolError,
	type CrdtExchangePullChunkV1,
	type CrdtExchangePullFieldV1,
	type CrdtExchangePullProofV1,
	encodeCrdtExchangeFrameV1,
} from "#questpie/shared/crdt-exchange.js";

import {
	CRDT_SUBJECT_PULL_BYTE_BURST,
	lockCrdtAdmissionHeads,
	lockCrdtAuthorizationCut,
	lockCrdtAuthorizationFences,
} from "./authorization-store.js";
import { type CrdtAuthorizationSnapshot } from "./authorization.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtNamespaceTable,
	questpieCrdtPullFieldTable,
	questpieCrdtPullPageTable,
	questpieCrdtPullTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtSchemaTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectAdmissionTable,
} from "./schema.js";
import {
	crdtGrantFingerprint,
	type CrdtExchangeSessionClaim,
} from "./session-authority.js";
import { materializeCrdtAggregateAtCut } from "./sync-store.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;
type BindingRow = typeof questpieCrdtBindingTable.$inferSelect;

const MAX_BOOTSTRAP_BYTES = 64 * 1024 * 1024;
const MAX_RETAINED_ARTIFACT_BYTES = 65 * 1024 * 1024;
const MAX_FIELD_CHUNK_BYTES = 256 * 1024;
const MAX_ACTIVE_PULLS = 8;
const MAX_ACTIVE_PULLS_PER_SUBJECT = 1;
const MAX_RETAINED_PULLS = 32;
const MAX_RETAINED_PULLS_PER_SUBJECT = 4;
const MAX_RETAINED_PULLS_PER_BINDING = 2;
const MAX_RETAINED_PULL_BYTES = 10 * MAX_RETAINED_ARTIFACT_BYTES;
const MAX_RETAINED_PULL_BYTES_PER_SUBJECT = 4 * MAX_RETAINED_ARTIFACT_BYTES;
const MAX_RETAINED_PULL_BYTES_PER_BINDING = 2 * MAX_RETAINED_ARTIFACT_BYTES;
const PULL_ACTIVE_LIFETIME_MS = 30_000;
const PULL_RETRY_GRACE_MS = 30_000;
const PULL_MINIMUM_AUTHORITY_WINDOW_MS =
	PULL_ACTIVE_LIFETIME_MS + PULL_RETRY_GRACE_MS + 1_000;
const PULL_BYTE_REFILL_PER_SECOND = 1024n * 1024n;
const TOKEN_BYTES = 58;
const TOKEN_MAC_OFFSET = 26;
const PLACEHOLDER_REQUEST_ID = Uint8Array.of(
	1,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	1,
);

export type CrdtPullRequestV1 = Readonly<{
	claim: CrdtExchangeSessionClaim;
	authorization: CrdtAuthorizationSnapshot;
	pullId: string;
	schemaVersion: number;
	continuation: string | null;
	proofs: readonly CrdtExchangePullProofV1[];
	signal?: AbortSignal;
}>;

export type CrdtStoredPullPageV1 = Readonly<{
	opcode: 0x81;
	payload: Uint8Array;
	final: boolean;
}>;

export class CrdtPullBusyError extends Error {
	readonly retryAfterMs = 250;

	constructor() {
		super("CRDT pull busy");
		this.name = "CrdtPullBusyError";
	}
}

export class CrdtPullRecoveryRequiredError extends Error {
	constructor(cause?: unknown) {
		super(
			"CRDT recovery required",
			cause === undefined ? undefined : { cause },
		);
		this.name = "CrdtPullRecoveryRequiredError";
	}
}

export function createCrdtPullStore(
	db: CrdtDatabase,
	config: Readonly<{
		namespace: string;
		deploymentFingerprint: string;
		secret: string | Uint8Array;
		resolveEngine(binding: {
			format: number;
			formatVersion: number;
		}): AnyEngine;
	}>,
) {
	const tokenKey = deriveTokenKey(config.secret);
	if (
		!/^[!-~]{1,64}$/.test(config.namespace) ||
		!/^[!-~]{1,128}$/.test(config.deploymentFingerprint)
	) {
		throw new TypeError("CRDT pull deployment identity is invalid");
	}

	return Object.freeze({
		async pull(input: CrdtPullRequestV1): Promise<CrdtStoredPullPageV1> {
			try {
				throwIfAborted(input.signal);
				if (input.continuation !== null) {
					if (input.proofs.length !== 0) throw recovery();
					const token = decodeContinuation(input.continuation);
					if (token.pullId !== input.pullId) throw recovery();
					return await awaitWithAbort(
						readStoredPage(db, {
							input,
							pageIndex: token.pageIndex,
							token,
							tokenKey,
							namespace: config.namespace,
							deploymentFingerprint: config.deploymentFingerprint,
						}),
						input.signal,
					);
				}

				const requestFingerprint = pullRequestFingerprint(input);
				const existing = await awaitWithAbort(
					readExistingPull(db, input, requestFingerprint),
					input.signal,
				);
				if (existing === "building") throw new CrdtPullBusyError();
				if (existing) {
					return awaitWithAbort(
						readStoredPage(db, {
							input,
							pageIndex: 0,
							token: null,
							tokenKey,
							namespace: config.namespace,
							deploymentFingerprint: config.deploymentFingerprint,
						}),
						input.signal,
					);
				}

				const reserved = await awaitWithAbort(
					reservePull(db, input, requestFingerprint),
					input.signal,
				);
				try {
					const artifact = await materializeArtifact(
						db,
						reserved,
						config,
						input.signal,
					);
					const pages = encodeArtifactPages({
						reserved,
						artifact,
						tokenKey,
						namespace: config.namespace,
						deploymentFingerprint: config.deploymentFingerprint,
						signal: input.signal,
					});
					await awaitWithAbort(
						stagePullPages(db, reserved, pages),
						input.signal,
					);
					await awaitWithAbort(
						finalizePull(db, input, reserved, artifact, pages),
						input.signal,
					);
				} catch {
					if (input.signal?.aborted) {
						void expireBuildingPull(db, input.pullId).catch(() => {});
					} else {
						await expireBuildingPull(db, input.pullId);
					}
					throw recovery();
				}
				return awaitWithAbort(
					readStoredPage(db, {
						input,
						pageIndex: 0,
						token: null,
						tokenKey,
						namespace: config.namespace,
						deploymentFingerprint: config.deploymentFingerprint,
					}),
					input.signal,
				);
			} catch (error) {
				if (
					error instanceof CrdtPullBusyError ||
					error instanceof CrdtPullRecoveryRequiredError
				) {
					throw error;
				}
				throw recovery(error);
			}
		},

		async collectExpired(limit = 16): Promise<number> {
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64) {
				throw new TypeError("CRDT pull cleanup limit must be between 1 and 64");
			}
			return db.transaction(async (transaction) => {
				const tx = transaction as CrdtDatabase;
				const expired = await tx
					.select({
						id: questpieCrdtPullTable.id,
						state: questpieCrdtPullTable.state,
						subjectId: questpieCrdtPullTable.subjectId,
						retainedBytes: questpieCrdtPullTable.retainedBytes,
					})
					.from(questpieCrdtPullTable)
					.where(sql`${questpieCrdtPullTable.expiresAt} <= clock_timestamp()`)
					.orderBy(asc(questpieCrdtPullTable.expiresAt))
					.limit(limit)
					.for("update", { skipLocked: true });
				const ids = expired.map((pull) => pull.id);
				if (ids.length === 0) return 0;
				const buildingRefunds = new Map<string, bigint>();
				for (const pull of expired) {
					if (pull.state !== 1 || pull.retainedBytes <= 0) continue;
					buildingRefunds.set(
						pull.subjectId,
						(buildingRefunds.get(pull.subjectId) ?? 0n) +
							BigInt(pull.retainedBytes),
					);
				}
				for (const [subjectId, bytes] of buildingRefunds) {
					await refundPullByteBudget(tx, subjectId, bytes);
				}
				await tx
					.delete(questpieCrdtPullPageTable)
					.where(inArray(questpieCrdtPullPageTable.pullId, ids));
				await tx
					.delete(questpieCrdtPullFieldTable)
					.where(inArray(questpieCrdtPullFieldTable.pullId, ids));
				const removed = await tx
					.delete(questpieCrdtPullTable)
					.where(inArray(questpieCrdtPullTable.id, ids))
					.returning({ id: questpieCrdtPullTable.id });
				return removed.length;
			});
		},
	});
}

type ReservedPull = Readonly<{
	pullId: string;
	sessionId: string;
	bindingId: string;
	sessionGeneration: bigint;
	deliveryGeneration: bigint;
	resourceId: string;
	resourceEpochId: string;
	schemaId: string;
	aggregateEpoch: bigint;
	schemaVersion: number;
	targetCommitSeq: bigint;
	currentManifestId: string | null;
	previousManifestId: string | null;
	expiresAt: Date;
	grantFingerprint: Buffer;
	requestFingerprint: Buffer;
	continuationClaimFingerprint: Buffer;
	authorization: CrdtAuthorizationSnapshot;
	claim: CrdtExchangeSessionClaim;
	fields: readonly Readonly<{
		binding: BindingRow;
		grant: 0 | 1;
		proof: Uint8Array;
	}>[];
}>;

type MaterializedArtifact = Readonly<{
	digest: Buffer;
	fields: readonly CrdtExchangePullFieldV1[];
	chunks: readonly CrdtExchangePullChunkV1[];
	totalBytes: number;
}>;

type EncodedPage = Readonly<{
	pageIndex: number;
	payload: Buffer;
	checksum: Buffer;
	final: boolean;
}>;

async function reservePull(
	db: CrdtDatabase,
	input: CrdtPullRequestV1,
	requestFingerprint: Buffer,
): Promise<ReservedPull> {
	return db.transaction(
		async (transaction) => {
			const tx = transaction as CrdtDatabase;
			await lockCrdtAuthorizationCut(tx, input.authorization);
			await lockCrdtAdmissionHeads(tx, input.authorization);
			const [namespace] = await tx
				.select({ singleton: questpieCrdtNamespaceTable.singleton })
				.from(questpieCrdtNamespaceTable)
				.where(eq(questpieCrdtNamespaceTable.singleton, 1))
				.for("update");
			if (!namespace) throw recovery();

			const existing = await selectPullForUpdate(tx, input.pullId);
			if (existing) {
				assertSamePull(existing, input, requestFingerprint);
				if (existing.state === 1) throw new CrdtPullBusyError();
				throw recovery();
			}
			const session = await lockMatchingSession(
				tx,
				input,
				PULL_MINIMUM_AUTHORITY_WINDOW_MS,
			);
			await expireStalePullLeases(tx, session.bindingId);
			const [
				active,
				subjectActive,
				retained,
				subjectRetained,
				bindingRetained,
				retainedBytes,
				subjectRetainedBytes,
				bindingRetainedBytes,
			] = await Promise.all([
				activePullCount(tx),
				activePullCount(
					tx,
					eq(questpieCrdtPullTable.subjectId, input.authorization.subjectId),
				),
				retainedPullCount(tx),
				retainedPullCount(
					tx,
					eq(questpieCrdtPullTable.subjectId, input.authorization.subjectId),
				),
				retainedPullCount(
					tx,
					eq(questpieCrdtPullTable.bindingId, session.bindingId),
				),
				retainedPullBytes(tx),
				retainedPullBytes(
					tx,
					eq(questpieCrdtPullTable.subjectId, input.authorization.subjectId),
				),
				retainedPullBytes(
					tx,
					eq(questpieCrdtPullTable.bindingId, session.bindingId),
				),
			]);
			if (
				active >= MAX_ACTIVE_PULLS ||
				subjectActive >= MAX_ACTIVE_PULLS_PER_SUBJECT ||
				retained >= MAX_RETAINED_PULLS ||
				subjectRetained >= MAX_RETAINED_PULLS_PER_SUBJECT ||
				bindingRetained >= MAX_RETAINED_PULLS_PER_BINDING ||
				retainedBytes + MAX_RETAINED_ARTIFACT_BYTES > MAX_RETAINED_PULL_BYTES ||
				subjectRetainedBytes + MAX_RETAINED_ARTIFACT_BYTES >
					MAX_RETAINED_PULL_BYTES_PER_SUBJECT ||
				bindingRetainedBytes + MAX_RETAINED_ARTIFACT_BYTES >
					MAX_RETAINED_PULL_BYTES_PER_BINDING
			) {
				throw new CrdtPullBusyError();
			}
			await consumePullByteBudget(
				tx,
				input.authorization.subjectId,
				BigInt(MAX_RETAINED_ARTIFACT_BYTES),
			);

			const [epoch] = await tx
				.select()
				.from(questpieCrdtResourceEpochTable)
				.where(
					and(
						eq(
							questpieCrdtResourceEpochTable.resourceId,
							input.authorization.resourceId,
						),
						eq(
							questpieCrdtResourceEpochTable.id,
							input.authorization.resourceEpochId,
						),
						eq(
							questpieCrdtResourceEpochTable.schemaId,
							input.authorization.schemaId,
						),
						eq(questpieCrdtResourceEpochTable.status, 1),
					),
				)
				.for("share");
			const [schema] = await tx
				.select({ version: questpieCrdtSchemaTable.schemaVersion })
				.from(questpieCrdtSchemaTable)
				.where(eq(questpieCrdtSchemaTable.id, input.authorization.schemaId));
			if (
				!epoch ||
				!schema ||
				schema.version !== BigInt(input.schemaVersion) ||
				input.schemaVersion !== input.authorization.clientManifest.schemaVersion
			) {
				throw recovery();
			}
			const grants = await readMatchingGrants(
				tx,
				input.authorization,
				session.id,
			);
			const bindings = await tx
				.select()
				.from(questpieCrdtBindingTable)
				.where(
					and(
						eq(
							questpieCrdtBindingTable.resourceId,
							input.authorization.resourceId,
						),
						eq(questpieCrdtBindingTable.schemaId, input.authorization.schemaId),
						inArray(
							questpieCrdtBindingTable.id,
							grants.map((grant) => grant.bindingId),
						),
						eq(questpieCrdtBindingTable.status, 1),
						isNull(questpieCrdtBindingTable.retiredAt),
					),
				)
				.orderBy(asc(questpieCrdtBindingTable.fieldSlot));
			if (bindings.length !== grants.length) throw recovery();
			const proofs = validateProofs(input.proofs, grants);
			const bindingById = new Map(
				bindings.map((binding) => [binding.id, binding]),
			);
			const fields = grants.map((grant) => {
				const binding = bindingById.get(grant.bindingId);
				if (
					!binding ||
					binding.fieldSlot !== grant.fieldSlot ||
					binding.fieldEpoch !== grant.fieldEpoch ||
					binding.formatVersion !== grant.formatVersion ||
					binding.readFence !== grant.fieldReadFence ||
					binding.editFence !== grant.fieldEditFence
				) {
					throw recovery();
				}
				return Object.freeze({
					binding,
					grant: grant.grant as 0 | 1,
					proof: proofs.get(binding.fieldSlot) ?? new Uint8Array(),
				});
			});
			const grantFingerprint = crdtGrantFingerprint(input.authorization);
			const continuationClaimFingerprint = pullContinuationClaimFingerprint({
				input,
				session,
				epoch,
				schemaVersion: schema.version,
				grantFingerprint,
				fields,
			});
			const [reserved] = await tx
				.insert(questpieCrdtPullTable)
				.values({
					id: input.pullId,
					sessionId: session.id,
					bindingId: session.bindingId,
					resourceId: session.resourceId,
					resourceIncarnationKey: session.resourceIncarnationKey,
					resourceEpochId: session.resourceEpochId,
					aggregateEpoch: epoch.aggregateEpoch,
					targetCommitSeq: epoch.headCommitSeq,
					schemaId: session.schemaId,
					schemaVersion: schema.version,
					subjectId: session.subjectId,
					credentialFingerprint: Buffer.from(session.credentialFingerprint),
					sessionGeneration: session.generation,
					deliveryGeneration: session.deliveryGeneration,
					resourceReadFence: session.resourceReadFence,
					resourceEditFence: session.resourceEditFence,
					ownerPolicyRevision: session.ownerPolicyRevision,
					subjectReadFence: session.subjectReadFence,
					subjectEditFence: session.subjectEditFence,
					grantFingerprint,
					requestFingerprint,
					continuationClaimFingerprint,
					currentSnapshotManifestId: epoch.currentSnapshotManifestId,
					previousSnapshotManifestId: epoch.previousSnapshotManifestId,
					retainedBytes: MAX_RETAINED_ARTIFACT_BYTES,
					activeExpiresAt: sql`LEAST(clock_timestamp() + (${PULL_ACTIVE_LIFETIME_MS} * interval '1 millisecond'), ${session.authorityExpiresAt})`,
					expiresAt: sql`LEAST(clock_timestamp() + (${PULL_ACTIVE_LIFETIME_MS + PULL_RETRY_GRACE_MS} * interval '1 millisecond'), ${session.authorityExpiresAt})`,
				})
				.returning({ expiresAt: questpieCrdtPullTable.expiresAt });
			if (!reserved) throw recovery();
			await tx.insert(questpieCrdtPullFieldTable).values(
				fields.map((field) => ({
					pullId: input.pullId,
					bindingId: field.binding.id,
					fieldSlot: field.binding.fieldSlot,
					grant: field.grant,
					fieldEpoch: field.binding.fieldEpoch,
					formatVersion: field.binding.formatVersion,
					fieldCursor: field.binding.headFieldCursor,
					readFence: field.binding.readFence,
					editFence: field.binding.editFence,
					proof: Buffer.from(field.proof),
					proofSizeBytes: field.proof.byteLength,
				})),
			);
			return Object.freeze({
				pullId: input.pullId,
				sessionId: session.id,
				bindingId: session.bindingId,
				sessionGeneration: session.generation,
				deliveryGeneration: session.deliveryGeneration,
				resourceId: session.resourceId,
				resourceEpochId: session.resourceEpochId,
				schemaId: session.schemaId,
				aggregateEpoch: epoch.aggregateEpoch,
				schemaVersion: Number(schema.version),
				targetCommitSeq: epoch.headCommitSeq,
				currentManifestId: epoch.currentSnapshotManifestId,
				previousManifestId: epoch.previousSnapshotManifestId,
				expiresAt: new Date(reserved.expiresAt),
				grantFingerprint,
				requestFingerprint,
				continuationClaimFingerprint,
				authorization: input.authorization,
				claim: input.claim,
				fields: Object.freeze(fields),
			});
		},
		{ isolationLevel: "repeatable read" },
	);
}

async function materializeArtifact(
	db: CrdtDatabase,
	reserved: ReservedPull,
	config: Readonly<{
		resolveEngine(binding: {
			format: number;
			formatVersion: number;
		}): AnyEngine;
	}>,
	signal?: AbortSignal,
): Promise<MaterializedArtifact> {
	const engines = new Map<number, AnyEngine>();
	for (const field of reserved.fields) {
		throwIfAborted(signal);
		const engine = config.resolveEngine(field.binding);
		if (
			engine.formatVersion !== field.binding.formatVersion ||
			(engine.format === "text" ? 1 : 2) !== field.binding.format
		) {
			throw recovery();
		}
		engines.set(field.binding.fieldSlot, engine);
	}
	const replicas = await awaitWithAbort(
		materializeCrdtAggregateAtCut(db, {
			resourceId: reserved.resourceId,
			resourceEpochId: reserved.resourceEpochId,
			schemaId: reserved.schemaId,
			targetCommitSeq: reserved.targetCommitSeq,
			currentManifestId: reserved.currentManifestId,
			previousManifestId: reserved.previousManifestId,
			bindings: reserved.fields.map((field) => field.binding),
			engines,
			targetFieldCursors: new Map(
				reserved.fields.map((field) => [
					field.binding.id,
					field.binding.headFieldCursor,
				]),
			),
		}),
		signal,
	);
	if (!replicas) throw recovery();

	let totalBytes = 0;
	let chunkIndex = 0;
	const fieldViews: CrdtExchangePullFieldV1[] = [];
	const chunks: CrdtExchangePullChunkV1[] = [];
	const artifactHash = createHash("sha256").update(
		"questpie-crdt-pull-artifact-v1\0",
	);
	for (const field of reserved.fields) {
		throwIfAborted(signal);
		const engine = engines.get(field.binding.fieldSlot);
		const replica = replicas.get(field.binding.fieldSlot);
		if (!engine || !replica) throw recovery();
		let bytes: Uint8Array;
		if (field.proof.byteLength === 0) {
			bytes = await awaitWithAbort(
				Promise.resolve(engine.snapshot(replica)),
				signal,
			);
		} else {
			try {
				const diff = await awaitWithAbort(
					Promise.resolve(engine.diff({ replica, proof: field.proof })),
					signal,
				);
				bytes = diff.kind === "current" ? new Uint8Array() : diff.snapshot;
			} catch {
				throwIfAborted(signal);
				bytes = await awaitWithAbort(
					Promise.resolve(engine.snapshot(replica)),
					signal,
				);
			}
		}
		totalBytes += bytes.byteLength;
		if (totalBytes > MAX_BOOTSTRAP_BYTES) throw recovery();
		const digest = createHash("sha256").update(bytes).digest();
		const view = Object.freeze({
			fieldSlot: field.binding.fieldSlot,
			grant: field.grant,
			fieldEpoch: field.binding.fieldEpoch,
			formatVersion: field.binding.formatVersion,
			fieldCursor: field.binding.headFieldCursor,
			byteLength: bytes.byteLength,
			digest: new Uint8Array(digest),
		});
		fieldViews.push(view);
		artifactHash
			.update(u16(view.fieldSlot))
			.update(Uint8Array.of(view.grant))
			.update(u64(view.fieldEpoch))
			.update(u16(view.formatVersion))
			.update(u64(view.fieldCursor))
			.update(u32(view.byteLength))
			.update(digest);
		for (let offset = 0; offset < bytes.byteLength; ) {
			throwIfAborted(signal);
			const end = Math.min(bytes.byteLength, offset + MAX_FIELD_CHUNK_BYTES);
			chunks.push(
				Object.freeze({
					fieldSlot: view.fieldSlot,
					fieldEpoch: view.fieldEpoch,
					formatVersion: view.formatVersion,
					throughFieldCursor: view.fieldCursor,
					chunkIndex: chunkIndex++,
					offset,
					final: end === bytes.byteLength,
					bytes: bytes.slice(offset, end),
				}),
			);
			offset = end;
		}
		artifactHash.update(bytes);
	}
	return Object.freeze({
		digest: artifactHash.digest(),
		fields: Object.freeze(fieldViews),
		chunks: Object.freeze(chunks),
		totalBytes,
	});
}

function encodeArtifactPages(input: {
	reserved: ReservedPull;
	artifact: MaterializedArtifact;
	tokenKey: Buffer;
	namespace: string;
	deploymentFingerprint: string;
	signal?: AbortSignal;
}): readonly EncodedPage[] {
	const pullId = uuidToBytes(input.reserved.pullId);
	const pages: EncodedPage[] = [];
	let chunkOffset = 0;
	while (chunkOffset < input.artifact.chunks.length || pages.length === 0) {
		throwIfAborted(input.signal);
		const pageIndex = pages.length;
		const pageChunks: CrdtExchangePullChunkV1[] = [];
		let encoded: Uint8Array | undefined;
		while (chunkOffset + pageChunks.length < input.artifact.chunks.length) {
			throwIfAborted(input.signal);
			const candidate = [
				...pageChunks,
				input.artifact.chunks[chunkOffset + pageChunks.length]!,
			];
			const complete =
				chunkOffset + candidate.length === input.artifact.chunks.length;
			const continuation = complete
				? null
				: encodeContinuation({
						reserved: input.reserved,
						artifactFingerprint: input.artifact.digest,
						pageIndex: pageIndex + 1,
						tokenKey: input.tokenKey,
						namespace: input.namespace,
						deploymentFingerprint: input.deploymentFingerprint,
					});
			let frame: Uint8Array;
			try {
				frame = encodeCrdtExchangeFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x81,
					requestId: PLACEHOLDER_REQUEST_ID,
					payload: {
						pullId,
						aggregateEpoch: input.reserved.aggregateEpoch,
						schemaVersion: input.reserved.schemaVersion,
						artifactDigest: new Uint8Array(input.artifact.digest),
						complete,
						continuation,
						fields: input.artifact.fields,
						chunks: candidate,
					},
				});
			} catch (error) {
				if (
					error instanceof CrdtExchangeProtocolError &&
					pageChunks.length > 0
				) {
					break;
				}
				throw error;
			}
			if (frame.byteLength > CRDT_EXCHANGE_V1_MAX_BODY_BYTES) break;
			pageChunks.push(candidate.at(-1)!);
			encoded = frame;
		}
		if (!encoded) {
			const complete = chunkOffset === input.artifact.chunks.length;
			const continuation = complete
				? null
				: encodeContinuation({
						reserved: input.reserved,
						artifactFingerprint: input.artifact.digest,
						pageIndex: pageIndex + 1,
						tokenKey: input.tokenKey,
						namespace: input.namespace,
						deploymentFingerprint: input.deploymentFingerprint,
					});
			encoded = encodeCrdtExchangeFrameV1({
				major: 1,
				minor: 0,
				opcode: 0x81,
				requestId: PLACEHOLDER_REQUEST_ID,
				payload: {
					pullId,
					aggregateEpoch: input.reserved.aggregateEpoch,
					schemaVersion: input.reserved.schemaVersion,
					artifactDigest: new Uint8Array(input.artifact.digest),
					complete,
					continuation,
					fields: input.artifact.fields,
					chunks: [],
				},
			});
			if (!complete) throw recovery();
		}
		const final =
			chunkOffset + pageChunks.length === input.artifact.chunks.length;
		const payload = Buffer.from(
			encoded.subarray(CRDT_EXCHANGE_V1_HEADER_BYTES),
		);
		pages.push(
			Object.freeze({
				pageIndex,
				payload,
				checksum: createHash("sha256").update(payload).digest(),
				final,
			}),
		);
		chunkOffset += pageChunks.length;
		if (!final && pageChunks.length === 0) throw recovery();
	}
	return Object.freeze(pages);
}

async function stagePullPages(
	db: CrdtDatabase,
	reserved: ReservedPull,
	pages: readonly EncodedPage[],
): Promise<void> {
	await db.transaction(async (transaction) => {
		const tx = transaction as CrdtDatabase;
		const [pull] = await tx
			.select({
				requestFingerprint: questpieCrdtPullTable.requestFingerprint,
				grantFingerprint: questpieCrdtPullTable.grantFingerprint,
			})
			.from(questpieCrdtPullTable)
			.where(
				and(
					eq(questpieCrdtPullTable.id, reserved.pullId),
					eq(questpieCrdtPullTable.state, 1),
					gt(questpieCrdtPullTable.activeExpiresAt, sql`clock_timestamp()`),
				),
			)
			.for("update");
		if (
			!pull ||
			!Buffer.from(pull.requestFingerprint).equals(
				reserved.requestFingerprint,
			) ||
			!Buffer.from(pull.grantFingerprint).equals(reserved.grantFingerprint)
		) {
			throw recovery();
		}
		await tx.insert(questpieCrdtPullPageTable).values(
			pages.map((page) => ({
				pullId: reserved.pullId,
				pageIndex: page.pageIndex,
				payload: page.payload,
				sizeBytes: page.payload.byteLength,
				checksum: page.checksum,
				final: page.final ? 1 : 0,
			})),
		);
	});
}

async function finalizePull(
	db: CrdtDatabase,
	input: CrdtPullRequestV1,
	reserved: ReservedPull,
	artifact: MaterializedArtifact,
	pages: readonly EncodedPage[],
): Promise<void> {
	await db.transaction(async (transaction) => {
		const tx = transaction as CrdtDatabase;
		await lockCrdtAuthorizationFences(tx, input.authorization);
		await lockMatchingSession(tx, input);
		await readMatchingGrants(tx, input.authorization, input.claim.sessionId);
		const [pull] = await tx
			.select()
			.from(questpieCrdtPullTable)
			.where(
				and(
					eq(questpieCrdtPullTable.id, reserved.pullId),
					eq(questpieCrdtPullTable.state, 1),
					gt(questpieCrdtPullTable.activeExpiresAt, sql`clock_timestamp()`),
				),
			)
			.for("update");
		if (
			!pull ||
			!Buffer.from(pull.requestFingerprint).equals(
				reserved.requestFingerprint,
			) ||
			!Buffer.from(pull.grantFingerprint).equals(reserved.grantFingerprint)
		) {
			throw recovery();
		}
		const retainedBytes = pages.reduce(
			(total, page) => total + page.payload.byteLength,
			0,
		);
		if (retainedBytes > MAX_RETAINED_ARTIFACT_BYTES) throw recovery();
		const storedPages = await tx
			.select({
				pageIndex: questpieCrdtPullPageTable.pageIndex,
				sizeBytes: questpieCrdtPullPageTable.sizeBytes,
				checksum: questpieCrdtPullPageTable.checksum,
				final: questpieCrdtPullPageTable.final,
			})
			.from(questpieCrdtPullPageTable)
			.where(eq(questpieCrdtPullPageTable.pullId, reserved.pullId))
			.orderBy(asc(questpieCrdtPullPageTable.pageIndex));
		if (
			storedPages.length !== pages.length ||
			storedPages.some((stored, index) => {
				const expected = pages[index];
				return (
					!expected ||
					stored.pageIndex !== expected.pageIndex ||
					stored.sizeBytes !== expected.payload.byteLength ||
					stored.final !== (expected.final ? 1 : 0) ||
					!Buffer.from(stored.checksum).equals(expected.checksum)
				);
			})
		) {
			throw recovery();
		}
		const [ready] = await tx
			.update(questpieCrdtPullTable)
			.set({
				state: 2,
				artifactFingerprint: artifact.digest,
				pageCount: pages.length,
				totalBytes: artifact.totalBytes,
				retainedBytes,
				updatedAt: sql`clock_timestamp()`,
			})
			.where(
				and(
					eq(questpieCrdtPullTable.id, reserved.pullId),
					eq(questpieCrdtPullTable.state, 1),
					gt(questpieCrdtPullTable.activeExpiresAt, sql`clock_timestamp()`),
				),
			)
			.returning({ id: questpieCrdtPullTable.id });
		if (!ready) throw recovery();
		await refundPullByteBudget(
			tx,
			input.authorization.subjectId,
			BigInt(MAX_RETAINED_ARTIFACT_BYTES - retainedBytes),
		);
	});
}

async function readStoredPage(
	db: CrdtDatabase,
	input: {
		input: CrdtPullRequestV1;
		pageIndex: number;
		token: DecodedContinuation | null;
		tokenKey: Buffer;
		namespace: string;
		deploymentFingerprint: string;
	},
): Promise<CrdtStoredPullPageV1> {
	return db.transaction(async (transaction) => {
		const tx = transaction as CrdtDatabase;
		await lockCrdtAuthorizationFences(tx, input.input.authorization);
		await lockMatchingSession(tx, input.input);
		await readMatchingGrants(
			tx,
			input.input.authorization,
			input.input.claim.sessionId,
		);
		const [pull] = await tx
			.select()
			.from(questpieCrdtPullTable)
			.where(
				and(
					eq(questpieCrdtPullTable.id, input.input.pullId),
					sql`((${questpieCrdtPullTable.state} = 2 AND ${questpieCrdtPullTable.activeExpiresAt} > clock_timestamp()) OR (${questpieCrdtPullTable.state} = 3 AND ${questpieCrdtPullTable.expiresAt} > clock_timestamp()))`,
				),
			)
			.for("update");
		if (!pull || !pullMatchesAuthority(pull, input.input)) throw recovery();
		if (input.token) {
			assertContinuation(input.token, pull, {
				tokenKey: input.tokenKey,
				namespace: input.namespace,
				deploymentFingerprint: input.deploymentFingerprint,
			});
		}
		const [page] = await tx
			.select()
			.from(questpieCrdtPullPageTable)
			.where(
				and(
					eq(questpieCrdtPullPageTable.pullId, pull.id),
					eq(questpieCrdtPullPageTable.pageIndex, input.pageIndex),
				),
			);
		if (
			!page ||
			page.pageIndex >= pull.pageCount ||
			page.sizeBytes !== page.payload.byteLength ||
			!createHash("sha256")
				.update(page.payload)
				.digest()
				.equals(Buffer.from(page.checksum))
		) {
			throw recovery();
		}
		if (page.final === 1 && pull.state === 2) {
			await tx
				.update(questpieCrdtPullTable)
				.set({
					state: 3,
					completedAt: sql`clock_timestamp()`,
					updatedAt: sql`clock_timestamp()`,
				})
				.where(
					and(
						eq(questpieCrdtPullTable.id, pull.id),
						eq(questpieCrdtPullTable.state, 2),
					),
				);
		}
		return Object.freeze({
			opcode: 0x81 as const,
			payload: new Uint8Array(page.payload),
			final: page.final === 1,
		});
	});
}

async function readExistingPull(
	db: CrdtDatabase,
	input: CrdtPullRequestV1,
	requestFingerprint: Buffer,
): Promise<"building" | "ready" | null> {
	const [pull] = await db
		.select()
		.from(questpieCrdtPullTable)
		.where(eq(questpieCrdtPullTable.id, input.pullId));
	if (!pull) {
		const [expired] = await db
			.select({ id: questpieCrdtPullTable.id })
			.from(questpieCrdtPullTable)
			.where(eq(questpieCrdtPullTable.id, input.pullId))
			.limit(1);
		if (expired) throw recovery();
		return null;
	}
	assertSamePull(pull, input, requestFingerprint);
	const [clock] = await db
		.select({
			active: sql<boolean>`${pull.activeExpiresAt} > clock_timestamp()`.mapWith(
				Boolean,
			),
			retained: sql<boolean>`${pull.expiresAt} > clock_timestamp()`.mapWith(
				Boolean,
			),
		})
		.from(questpieCrdtPullTable)
		.where(eq(questpieCrdtPullTable.id, pull.id));
	if (pull.state === 1 && clock?.active) return "building";
	if (pull.state === 2 && clock?.active) return "ready";
	if (pull.state === 3 && clock?.retained) return "ready";
	throw recovery();
}

function assertSamePull(
	pull: typeof questpieCrdtPullTable.$inferSelect,
	input: CrdtPullRequestV1,
	requestFingerprint: Buffer,
): void {
	if (
		!pullMatchesAuthority(pull, input) ||
		!Buffer.from(pull.requestFingerprint).equals(requestFingerprint)
	) {
		throw recovery();
	}
}

function pullMatchesAuthority(
	pull: typeof questpieCrdtPullTable.$inferSelect,
	input: CrdtPullRequestV1,
): boolean {
	const authorization = input.authorization;
	return (
		pull.sessionId === input.claim.sessionId &&
		pull.bindingId === input.claim.bindingId &&
		pull.resourceId === authorization.resourceId &&
		pull.resourceIncarnationKey === authorization.incarnationKey &&
		pull.resourceEpochId === authorization.resourceEpochId &&
		pull.schemaId === authorization.schemaId &&
		pull.schemaVersion === BigInt(authorization.clientManifest.schemaVersion) &&
		pull.subjectId === authorization.subjectId &&
		Buffer.from(pull.credentialFingerprint).equals(
			Buffer.from(authorization.credentialFingerprint),
		) &&
		pull.sessionGeneration === input.claim.sessionGeneration &&
		pull.deliveryGeneration === input.claim.deliveryGeneration &&
		pull.resourceReadFence === authorization.resourceReadFence &&
		pull.resourceEditFence === authorization.resourceEditFence &&
		pull.ownerPolicyRevision === authorization.ownerPolicyRevision &&
		pull.subjectReadFence === authorization.subjectReadFence &&
		pull.subjectEditFence === authorization.subjectEditFence &&
		Buffer.from(pull.grantFingerprint).equals(
			crdtGrantFingerprint(authorization),
		)
	);
}

async function lockMatchingSession(
	db: CrdtDatabase,
	input: CrdtPullRequestV1,
	minimumAuthorityWindowMs = 0,
) {
	const authorization = input.authorization;
	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, input.claim.sessionId),
				eq(questpieCrdtSessionTable.bindingId, input.claim.bindingId),
				eq(questpieCrdtSessionTable.resourceId, authorization.resourceId),
				eq(
					questpieCrdtSessionTable.resourceIncarnationKey,
					authorization.incarnationKey,
				),
				eq(
					questpieCrdtSessionTable.resourceEpochId,
					authorization.resourceEpochId,
				),
				eq(questpieCrdtSessionTable.schemaId, authorization.schemaId),
				eq(questpieCrdtSessionTable.subjectId, authorization.subjectId),
				eq(
					questpieCrdtSessionTable.credentialFingerprint,
					Buffer.from(authorization.credentialFingerprint),
				),
				eq(questpieCrdtSessionTable.generation, input.claim.sessionGeneration),
				eq(
					questpieCrdtSessionTable.deliveryGeneration,
					input.claim.deliveryGeneration,
				),
				eq(
					questpieCrdtSessionTable.resourceReadFence,
					authorization.resourceReadFence,
				),
				eq(
					questpieCrdtSessionTable.resourceEditFence,
					authorization.resourceEditFence,
				),
				eq(
					questpieCrdtSessionTable.ownerPolicyRevision,
					authorization.ownerPolicyRevision,
				),
				eq(
					questpieCrdtSessionTable.subjectReadFence,
					authorization.subjectReadFence,
				),
				eq(
					questpieCrdtSessionTable.subjectEditFence,
					authorization.subjectEditFence,
				),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
				gt(
					questpieCrdtSessionTable.authorityExpiresAt,
					sql`clock_timestamp() + (${minimumAuthorityWindowMs} * interval '1 millisecond')`,
				),
			),
		)
		.for("update");
	if (!session) throw recovery();
	return session;
}

async function readMatchingGrants(
	db: CrdtDatabase,
	authorization: CrdtAuthorizationSnapshot,
	sessionId: string,
) {
	const grants = await db
		.select()
		.from(questpieCrdtSessionGrantTable)
		.where(eq(questpieCrdtSessionGrantTable.sessionId, sessionId))
		.orderBy(asc(questpieCrdtSessionGrantTable.fieldSlot));
	const expected = [...authorization.grants].sort(
		(left, right) => left.fieldSlot - right.fieldSlot,
	);
	if (
		grants.length !== expected.length ||
		grants.some((grant, index) => {
			const candidate = expected[index];
			return (
				!candidate ||
				grant.bindingId !== candidate.bindingId ||
				grant.stableFieldId !== candidate.stableFieldId ||
				grant.fieldSlot !== candidate.fieldSlot ||
				grant.fieldEpoch !== candidate.fieldEpoch ||
				grant.formatVersion !== candidate.formatVersion ||
				grant.grant !== (candidate.grant === "edit" ? 1 : 0) ||
				grant.fieldReadFence !== candidate.fieldReadFence ||
				grant.fieldEditFence !== candidate.fieldEditFence ||
				grant.subjectFieldReadFence !== candidate.subjectFieldReadFence ||
				grant.subjectFieldEditFence !== candidate.subjectFieldEditFence
			);
		})
	) {
		throw recovery();
	}
	return grants;
}

function validateProofs(
	proofs: readonly CrdtExchangePullProofV1[],
	grants: readonly (typeof questpieCrdtSessionGrantTable.$inferSelect)[],
): ReadonlyMap<number, Uint8Array> {
	const known = new Map(grants.map((grant) => [grant.fieldSlot, grant]));
	const result = new Map<number, Uint8Array>();
	let previous = 0;
	for (const proof of proofs) {
		const grant = known.get(proof.fieldSlot);
		if (
			!grant ||
			proof.fieldSlot <= previous ||
			proof.fieldEpoch !== grant.fieldEpoch ||
			proof.proof.byteLength > 64 * 1024
		) {
			throw recovery();
		}
		previous = proof.fieldSlot;
		result.set(proof.fieldSlot, new Uint8Array(proof.proof));
	}
	return result;
}

async function selectPullForUpdate(db: CrdtDatabase, id: string) {
	const [pull] = await db
		.select()
		.from(questpieCrdtPullTable)
		.where(eq(questpieCrdtPullTable.id, id))
		.for("update");
	return pull;
}

async function activePullCount(
	db: CrdtDatabase,
	predicate?: ReturnType<typeof eq>,
): Promise<number> {
	const conditions = [
		inArray(questpieCrdtPullTable.state, [1, 2]),
		gt(questpieCrdtPullTable.activeExpiresAt, sql`clock_timestamp()`),
	];
	if (predicate) conditions.push(predicate);
	const [value] = await db
		.select({ count: count() })
		.from(questpieCrdtPullTable)
		.where(and(...conditions));
	return value?.count ?? 0;
}

async function retainedPullCount(
	db: CrdtDatabase,
	predicate?: ReturnType<typeof eq>,
): Promise<number> {
	const conditions = [
		gt(questpieCrdtPullTable.expiresAt, sql`clock_timestamp()`),
	];
	if (predicate) conditions.push(predicate);
	const [value] = await db
		.select({ count: count() })
		.from(questpieCrdtPullTable)
		.where(and(...conditions));
	return value?.count ?? 0;
}

async function retainedPullBytes(
	db: CrdtDatabase,
	predicate?: ReturnType<typeof eq>,
): Promise<number> {
	const conditions = [
		gt(questpieCrdtPullTable.expiresAt, sql`clock_timestamp()`),
	];
	if (predicate) conditions.push(predicate);
	const [value] = await db
		.select({ bytes: sum(questpieCrdtPullTable.retainedBytes) })
		.from(questpieCrdtPullTable)
		.where(and(...conditions));
	return Number(value?.bytes ?? 0);
}

async function consumePullByteBudget(
	db: CrdtDatabase,
	subjectId: string,
	bytes: bigint,
): Promise<void> {
	const available = sql<bigint>`LEAST(${CRDT_SUBJECT_PULL_BYTE_BURST}, ${questpieCrdtSubjectAdmissionTable.pullByteTokens} + FLOOR(EXTRACT(EPOCH FROM (clock_timestamp() - ${questpieCrdtSubjectAdmissionTable.pullBytesRefilledAt})) * ${PULL_BYTE_REFILL_PER_SECOND})::bigint)`;
	const [consumed] = await db
		.update(questpieCrdtSubjectAdmissionTable)
		.set({
			pullByteTokens: sql`${available} - ${bytes}`,
			pullBytesRefilledAt: sql`clock_timestamp()`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(
			and(
				eq(questpieCrdtSubjectAdmissionTable.subjectId, subjectId),
				sql`${available} >= ${bytes}`,
			),
		)
		.returning({ subjectId: questpieCrdtSubjectAdmissionTable.subjectId });
	if (!consumed) throw new CrdtPullBusyError();
}

async function refundPullByteBudget(
	db: CrdtDatabase,
	subjectId: string,
	bytes: bigint,
): Promise<void> {
	if (bytes <= 0n) return;
	const [refunded] = await db
		.update(questpieCrdtSubjectAdmissionTable)
		.set({
			pullByteTokens: sql`LEAST(${CRDT_SUBJECT_PULL_BYTE_BURST}, ${questpieCrdtSubjectAdmissionTable.pullByteTokens} + ${bytes})`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, subjectId))
		.returning({ subjectId: questpieCrdtSubjectAdmissionTable.subjectId });
	if (!refunded) throw recovery();
}

async function expireStalePullLeases(
	db: CrdtDatabase,
	bindingId: string,
): Promise<void> {
	const [stale] = await db
		.select()
		.from(questpieCrdtPullTable)
		.where(
			and(
				eq(questpieCrdtPullTable.bindingId, bindingId),
				inArray(questpieCrdtPullTable.state, [1, 2]),
				sql`${questpieCrdtPullTable.activeExpiresAt} <= clock_timestamp()`,
			),
		)
		.for("update");
	if (!stale) return;
	if (stale.state === 1) {
		await expireBuildingPullRow(db, stale);
		return;
	}
	await db
		.update(questpieCrdtPullTable)
		.set({
			state: 4,
			completedAt: sql`clock_timestamp()`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(
			and(
				eq(questpieCrdtPullTable.id, stale.id),
				eq(questpieCrdtPullTable.state, 2),
			),
		);
}

function pullContinuationClaimFingerprint(input: {
	input: CrdtPullRequestV1;
	session: typeof questpieCrdtSessionTable.$inferSelect;
	epoch: typeof questpieCrdtResourceEpochTable.$inferSelect;
	schemaVersion: bigint;
	grantFingerprint: Buffer;
	fields: readonly Readonly<{
		binding: BindingRow;
		grant: 0 | 1;
	}>[];
}): Buffer {
	const authorization = input.input.authorization;
	const hash = createHash("sha256")
		.update("questpie-crdt-pull-claim-v1\0")
		.update(input.session.id)
		.update(input.session.bindingId)
		.update(input.session.resourceId)
		.update(input.session.resourceIncarnationKey)
		.update(input.session.resourceEpochId)
		.update(u64(input.epoch.aggregateEpoch))
		.update(u64(input.epoch.headCommitSeq))
		.update(input.session.schemaId)
		.update(u64(input.schemaVersion))
		.update(input.session.subjectId)
		.update(Buffer.from(input.session.credentialFingerprint))
		.update(u64(input.session.generation))
		.update(u64(input.session.deliveryGeneration))
		.update(u64(input.session.resourceReadFence))
		.update(u64(input.session.resourceEditFence))
		.update(u64(input.session.ownerPolicyRevision))
		.update(u64(input.session.subjectReadFence))
		.update(u64(input.session.subjectEditFence))
		.update(u64(BigInt(input.session.authorityExpiresAt.getTime())))
		.update(input.grantFingerprint);
	for (const field of [...input.fields].sort(
		(left, right) => left.binding.fieldSlot - right.binding.fieldSlot,
	)) {
		hash
			.update(field.binding.id)
			.update(field.binding.stableFieldId)
			.update(u16(field.binding.fieldSlot))
			.update(u64(field.binding.fieldEpoch))
			.update(u16(field.binding.formatVersion))
			.update(u64(field.binding.headFieldCursor))
			.update(u64(field.binding.readFence))
			.update(u64(field.binding.editFence))
			.update(Uint8Array.of(field.grant));
		const grant = authorization.grants.find(
			(candidate) => candidate.bindingId === field.binding.id,
		);
		if (!grant) throw recovery();
		hash
			.update(u64(grant.subjectFieldReadFence))
			.update(u64(grant.subjectFieldEditFence));
	}
	return hash.digest();
}

function pullRequestFingerprint(input: CrdtPullRequestV1): Buffer {
	const hash = createHash("sha256")
		.update("questpie-crdt-pull-request-v1\0")
		.update(input.pullId)
		.update("\0")
		.update(input.claim.bindingId)
		.update(u64(input.claim.sessionGeneration))
		.update(u64(input.claim.deliveryGeneration))
		.update(u32(input.schemaVersion));
	for (const proof of input.proofs) {
		hash
			.update(u16(proof.fieldSlot))
			.update(u64(proof.fieldEpoch))
			.update(u32(proof.proof.byteLength))
			.update(proof.proof);
	}
	return hash.digest();
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw (
			signal.reason ?? new DOMException("CRDT request aborted", "AbortError")
		);
	}
}

async function awaitWithAbort<T>(
	operation: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return operation;
	throwIfAborted(signal);
	let rejectAbort!: (reason?: unknown) => void;
	const aborted = new Promise<never>((_resolve, reject) => {
		rejectAbort = reject;
	});
	const abort = () =>
		rejectAbort(
			signal.reason ?? new DOMException("CRDT request aborted", "AbortError"),
		);
	signal.addEventListener("abort", abort, { once: true });
	try {
		return await Promise.race([operation, aborted]);
	} finally {
		signal.removeEventListener("abort", abort);
	}
}

type DecodedContinuation = Readonly<{
	pullId: string;
	pageIndex: number;
	expiresAtMs: bigint;
	mac: Buffer;
}>;

function encodeContinuation(input: {
	reserved: ReservedPull;
	artifactFingerprint: Buffer;
	pageIndex: number;
	tokenKey: Buffer;
	namespace: string;
	deploymentFingerprint: string;
}): string {
	const body = Buffer.concat([
		uuidToBytes(input.reserved.pullId),
		u16(input.pageIndex),
		u64(BigInt(input.reserved.expiresAt.getTime())),
	]);
	const mac = continuationMac({
		...input,
		body,
	});
	return Buffer.concat([body, mac]).toString("base64url");
}

function decodeContinuation(value: string): DecodedContinuation {
	if (!/^[A-Za-z0-9_-]{78}$/.test(value)) throw recovery();
	const bytes = Buffer.from(value, "base64url");
	if (bytes.byteLength !== TOKEN_BYTES) throw recovery();
	return Object.freeze({
		pullId: bytesToUuid(bytes.subarray(0, 16)),
		pageIndex: bytes.readUInt16BE(16),
		expiresAtMs: bytes.readBigUInt64BE(18),
		mac: bytes.subarray(TOKEN_MAC_OFFSET),
	});
}

function assertContinuation(
	token: DecodedContinuation,
	pull: typeof questpieCrdtPullTable.$inferSelect,
	config: {
		tokenKey: Buffer;
		namespace: string;
		deploymentFingerprint: string;
	},
): void {
	if (
		token.pullId !== pull.id ||
		token.expiresAtMs !== BigInt(pull.expiresAt.getTime()) ||
		token.pageIndex < 1 ||
		token.pageIndex >= pull.pageCount ||
		pull.artifactFingerprint === null
	) {
		throw recovery();
	}
	const body = Buffer.concat([
		uuidToBytes(pull.id),
		u16(token.pageIndex),
		u64(token.expiresAtMs),
	]);
	const expected = continuationMac({
		reserved: pull,
		artifactFingerprint: Buffer.from(pull.artifactFingerprint),
		pageIndex: token.pageIndex,
		tokenKey: config.tokenKey,
		namespace: config.namespace,
		deploymentFingerprint: config.deploymentFingerprint,
		body,
	});
	if (
		token.mac.byteLength !== expected.byteLength ||
		!timingSafeEqual(token.mac, expected)
	) {
		throw recovery();
	}
}

function continuationMac(input: {
	reserved: Pick<
		typeof questpieCrdtPullTable.$inferSelect,
		| "bindingId"
		| "sessionGeneration"
		| "deliveryGeneration"
		| "grantFingerprint"
		| "continuationClaimFingerprint"
	> &
		Partial<Pick<ReservedPull, "bindingId">>;
	artifactFingerprint: Buffer;
	pageIndex: number;
	tokenKey: Buffer;
	namespace: string;
	deploymentFingerprint: string;
	body: Buffer;
}): Buffer {
	return createHmac("sha256", input.tokenKey)
		.update("questpie-crdt-pull-continuation-v1\0")
		.update(input.namespace)
		.update("\0")
		.update(input.deploymentFingerprint)
		.update("\0")
		.update(input.body)
		.update(input.reserved.bindingId)
		.update(u64(input.reserved.sessionGeneration))
		.update(u64(input.reserved.deliveryGeneration))
		.update(Buffer.from(input.reserved.grantFingerprint))
		.update(Buffer.from(input.reserved.continuationClaimFingerprint))
		.update(input.artifactFingerprint)
		.digest();
}

function deriveTokenKey(secret: string | Uint8Array): Buffer {
	const bytes =
		typeof secret === "string"
			? Buffer.from(secret, "utf8")
			: Buffer.from(secret);
	if (bytes.byteLength < 16) {
		throw new TypeError("CRDT pull secret must be at least 128 bits");
	}
	return createHmac("sha256", bytes)
		.update("questpie-crdt-pull-token-key-v1\0")
		.digest();
}

async function expireBuildingPull(db: CrdtDatabase, pullId: string) {
	await db.transaction(async (transaction) => {
		const tx = transaction as CrdtDatabase;
		const [pull] = await tx
			.select()
			.from(questpieCrdtPullTable)
			.where(
				and(
					eq(questpieCrdtPullTable.id, pullId),
					eq(questpieCrdtPullTable.state, 1),
				),
			)
			.for("update");
		if (pull) await expireBuildingPullRow(tx, pull);
	});
}

async function expireBuildingPullRow(
	db: CrdtDatabase,
	pull: typeof questpieCrdtPullTable.$inferSelect,
) {
	await db
		.delete(questpieCrdtPullPageTable)
		.where(eq(questpieCrdtPullPageTable.pullId, pull.id));
	const [expired] = await db
		.update(questpieCrdtPullTable)
		.set({
			state: 4,
			artifactFingerprint: randomBytes(32),
			pageCount: 1,
			retainedBytes: 0,
			completedAt: sql`clock_timestamp()`,
			updatedAt: sql`clock_timestamp()`,
		})
		.where(
			and(
				eq(questpieCrdtPullTable.id, pull.id),
				eq(questpieCrdtPullTable.state, 1),
			),
		)
		.returning({ subjectId: questpieCrdtPullTable.subjectId });
	if (expired) {
		await refundPullByteBudget(
			db,
			expired.subjectId,
			BigInt(pull.retainedBytes),
		);
	}
}

function uuidToBytes(value: string): Buffer {
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value,
		)
	) {
		throw recovery();
	}
	return Buffer.from(value.replaceAll("-", ""), "hex");
}

function bytesToUuid(bytes: Uint8Array): string {
	if (bytes.byteLength !== 16) throw recovery();
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function u16(value: number): Buffer {
	const output = Buffer.allocUnsafe(2);
	output.writeUInt16BE(value);
	return output;
}

function u32(value: number): Buffer {
	const output = Buffer.allocUnsafe(4);
	output.writeUInt32BE(value);
	return output;
}

function u64(value: bigint): Buffer {
	const output = Buffer.allocUnsafe(8);
	output.writeBigUInt64BE(value);
	return output;
}

function recovery(cause?: unknown): CrdtPullRecoveryRequiredError {
	return new CrdtPullRecoveryRequiredError(cause);
}
