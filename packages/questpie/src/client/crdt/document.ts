import {
	createCrdtTextAnchorToken,
	resolveCrdtTextAnchorToken,
	type CrdtTextAnchorBinding,
	type CrdtTextAnchorInput,
	type CrdtTextAnchorResolution,
	type CrdtTextAnchorToken,
} from "#questpie/shared/crdt-anchor.js";
import type {
	CrdtExchangeAppendReceiptV1,
	CrdtExchangePullFieldV1,
	CrdtExchangeResponseFrameV1,
} from "#questpie/shared/crdt-exchange.js";

import type {
	CrdtDocumentState,
	CrdtFieldGrant,
	CrdtSetOperation,
	CrdtTextOperation,
} from "../../server/modules/core/integrated/crdt/types.js";
import { CrdtClientCoordinator } from "./coordinator.js";
import {
	applyClientSetOperations,
	applyClientSetUpdate,
	mergeClientSetUpdates,
	projectClientSetReplica,
	restoreClientSetReplica,
	snapshotClientSetReplica,
	type CrdtClientSetReplica,
} from "./set-engine.js";
import { createIndexedDbCrdtStorage, isStoredDocument } from "./storage.js";
import {
	createCrdtHttpExchangeClient,
	CrdtHttpProtocolError,
	CrdtHttpRecoveryError,
} from "./transport.js";
import {
	CrdtAnchorError,
	CrdtConnectError,
	CrdtMutationError,
	CrdtReadError,
	type CrdtClientClock,
	type CrdtClientExchangePort,
	type CrdtClientHostConfig,
	type CrdtClientManifestField,
	type CrdtClientManifestOwner,
	type CrdtClientOpenedSession,
	type CrdtClientRealtimeEdgeLease,
	type CrdtClientStorage,
	type CrdtClientStoredDocument,
	type CrdtClientTextEngine,
	CRDT_OFFLINE_HORIZON_MS,
} from "./types.js";

type OwnerKind = "collection" | "global";
type RequestedMode = "view" | "edit";

type FieldRuntime = {
	readonly key: string;
	readonly contract: CrdtClientManifestField;
	replica?: unknown;
	grant?: CrdtFieldGrant;
	fieldEpoch?: bigint;
	fieldCursor?: bigint;
	hidden: boolean;
	syncing: boolean;
	chunks: Uint8Array[];
	chunkBytes: number;
};

type PullSessionGuard = Readonly<{
	opened: CrdtClientOpenedSession;
	sessionAbort: AbortController;
	synchronizeAbort: AbortController;
	lifecycleGeneration: number;
}>;

type PersistedFieldRuntime = {
	readonly field: FieldRuntime;
	replica: unknown;
	readonly grant: CrdtFieldGrant;
	readonly fieldEpoch: bigint;
	readonly fieldCursor: bigint;
};

type PendingBundle = {
	readonly updateId: Uint8Array;
	readonly createdAt: number;
	readonly aggregateEpoch: bigint;
	readonly schemaVersion: number;
	readonly parts: Array<{
		field?: FieldRuntime;
		fieldSlot: number;
		fieldEpoch: bigint;
		formatVersion: number;
		baseFieldCursor: bigint;
		bytes: Uint8Array;
	}>;
	readonly byteLength: number;
	submittedHash?: Uint8Array;
	needsReconcile: boolean;
	submitting: boolean;
};

type TransactionPart = {
	readonly field: FieldRuntime;
	replica: unknown;
	readonly updates: Uint8Array[];
};

type ActiveTransaction = {
	readonly updateId: Uint8Array;
	readonly dotPrefix: string;
	dotCounter: number;
	poisoned: boolean;
	readonly parts: Map<FieldRuntime, TransactionPart>;
};

type PublicRoster = readonly Readonly<{
	participantId: string;
	sessions: readonly Readonly<{
		sessionId: string;
		value: unknown;
		active?: Readonly<{
			field: string;
			cursor?: number;
			selectionEnd?: number;
		}>;
		expiresAtMs: number;
	}>[];
}>[];

type RosterPage = Readonly<{
	pageCount: number;
	canonical: string;
	participants: readonly unknown[];
}>;

type PersistedDocument = Readonly<{
	kind: "document";
	exactKey: string;
	namespace: string;
	subject: string;
	incarnationKey: string;
	ownerKind: OwnerKind;
	ownerKey: string;
	locator?: string;
	schemaFingerprint: string;
	schemaVersion: number;
	aggregateEpoch: string;
	fields: readonly Readonly<{
		fieldSlot: number;
		fieldEpoch: string;
		fieldCursor: string;
		grant: CrdtFieldGrant;
		snapshot: Uint8Array;
	}>[];
	pending: readonly Readonly<{
		updateId: Uint8Array;
		createdAt: number;
		aggregateEpoch: string;
		schemaVersion: number;
		submittedHash: Uint8Array;
		parts: readonly Readonly<{
			fieldSlot: number;
			fieldEpoch: string;
			formatVersion: number;
			baseFieldCursor: string;
			bytes: Uint8Array;
		}>[];
	}>[];
}>;

type PersistedBinding = Readonly<{
	kind: "binding";
	exactKey: string;
}>;

const DEFAULT_CLOCK: CrdtClientClock = Object.freeze({
	now: () => Date.now(),
	setTimeout: (callback: () => void, delayMs: number) =>
		globalThis.setTimeout(callback, delayMs),
	clearTimeout: (handle: unknown) =>
		globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
});

const INERT_STORAGE: CrdtClientStorage = Object.freeze({
	load: async () => undefined,
	save: async () => undefined,
	remove: async () => undefined,
});
const MAX_UPDATE_BYTES = 256 * 1024;
const MAX_BUNDLE_BYTES = 1024 * 1024;
const MAX_TEXT_PROJECTION_BYTES = 16 * 1024 * 1024;
const MAX_RECEIPTS = 64;
const MAX_FIELD_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_AGGREGATE_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
const MAX_PULL_PAGES = 4_096;

export class CrdtClientDocument {
	readonly fields: Record<string, unknown>;
	readonly awareness: unknown;
	private revision = 0;
	private state: CrdtDocumentState<string> = Object.freeze({ status: "idle" });
	private readonly listeners = new Set<
		(state: CrdtDocumentState<string>) => void
	>();
	private readonly fieldsByKey = new Map<string, FieldRuntime>();
	private readonly fieldsBySlot = new Map<number, FieldRuntime>();
	private readonly authorizedGrants = new Map<number, CrdtFieldGrant>();
	private readonly exchange: CrdtClientExchangePort;
	private readonly coordinator: CrdtClientCoordinator;
	private readonly storage: CrdtClientStorage;
	private readonly clock: CrdtClientClock;
	private readonly textEngine: CrdtClientTextEngine | undefined;
	private owner: CrdtClientManifestOwner | undefined;
	private readonly runtimeLimitsValid: boolean;
	private readonly maximumPendingUpdates: number;
	private readonly maximumPendingBytes: number;
	private activeOpenId?: string;
	private opened?: CrdtClientOpenedSession;
	private topologyBoundOpened?: CrdtClientOpenedSession;
	private edgeLease?: CrdtClientRealtimeEdgeLease;
	private unregisterDirty?: () => void;
	private sessionAbort?: AbortController;
	private connectionAuthorityConfirmed = false;
	private connectPromise?: Promise<void>;
	private synchronizePromise?: Promise<void>;
	private synchronizeAbort?: AbortController;
	private synchronizeAgain = false;
	private authorityRefreshPromise?: Promise<void>;
	private references = 0;
	private closed = false;
	private lifecycleGeneration = 0;
	private aggregateEpoch?: bigint;
	private schemaVersion?: number;
	private requestedMode?: RequestedMode;
	private requestedFallback?: "view";
	private readonly pending: PendingBundle[] = [];
	private pendingBytes = 0;
	private activeTransaction?: ActiveTransaction;
	private subject?: string;
	private incarnationKey?: string;
	private loadedAggregateEpoch?: bigint;
	private storageBindingKey?: string;
	private storageExactKey?: string;
	private storageBasisRevision = 0;
	private storageGeneration = 0;
	private persistChain: Promise<void> = Promise.resolve();
	private appendChain: Promise<void> = Promise.resolve();
	private serverNamespace?: string;
	private deploymentFingerprint?: string;
	private roster: PublicRoster = Object.freeze([]);
	private readonly rosterListeners = new Set<(roster: PublicRoster) => void>();
	private rosterGeneration?: string;
	private readonly rosterPages = new Map<number, RosterPage>();
	private rosterExpiryHandle?: unknown;
	private heartbeatHandle?: unknown;
	private serverClockOffsetMs = 0;
	private offlineHorizonHandle?: unknown;
	private healthPullHandle?: unknown;
	private pendingAwareness?: unknown;

	constructor(
		private readonly host: CrdtClientHostConfig,
		private readonly kind: OwnerKind,
		private readonly ownerKey: string,
		private readonly locator: { id: string | number } | undefined,
		owner: CrdtClientManifestOwner | undefined,
		coordinator?: CrdtClientCoordinator,
	) {
		this.owner = owner;
		this.coordinator = coordinator ?? new CrdtClientCoordinator();
		this.textEngine = host.runtime?.engines?.text;
		const configuredPendingUpdates =
			host.runtime?.maxPendingUpdates ?? MAX_RECEIPTS;
		const configuredPendingBytes =
			host.runtime?.maxPendingBytes ?? MAX_PENDING_BYTES;
		this.runtimeLimitsValid =
			Number.isSafeInteger(configuredPendingUpdates) &&
			configuredPendingUpdates >= 0 &&
			Number.isSafeInteger(configuredPendingBytes) &&
			configuredPendingBytes >= 0;
		this.maximumPendingUpdates = this.runtimeLimitsValid
			? Math.min(configuredPendingUpdates, MAX_RECEIPTS)
			: 0;
		this.maximumPendingBytes = this.runtimeLimitsValid
			? Math.min(configuredPendingBytes, MAX_PENDING_BYTES)
			: 0;
		if (owner) this.installManifest(owner);
		this.fields = this.createFields();
		this.awareness = this.createAwareness();
		this.storage =
			host.runtime?.storage ??
			(typeof indexedDB === "undefined"
				? INERT_STORAGE
				: createIndexedDbCrdtStorage());
		this.clock = host.runtime?.clock ?? DEFAULT_CLOCK;
		this.exchange = host.exchange ?? createCrdtHttpExchangeClient(host);
	}

	get replicaRevision(): number {
		return this.revision;
	}

	getSnapshot(): CrdtDocumentState<string> {
		return this.state;
	}

	subscribe(listener: (state: CrdtDocumentState<string>) => void): () => void {
		this.listeners.add(listener);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			this.listeners.delete(listener);
		};
	}

	connect(options: { mode: RequestedMode; fallback?: "view" }): Promise<void> {
		if (this.closed) {
			return Promise.reject(new CrdtConnectError("CLOSED"));
		}
		if (this.state.status === "recovery-required") {
			return Promise.reject(new CrdtConnectError("CRDT_RECOVERY_REQUIRED"));
		}
		if (
			(this.connectPromise || this.opened) &&
			(this.requestedMode !== options.mode ||
				this.requestedFallback !== options.fallback)
		) {
			return Promise.reject(new CrdtConnectError("CRDT_PROTOCOL_REJECTED"));
		}
		this.references++;
		if (this.connectPromise) {
			return this.connectPromise.catch((error) => {
				this.references = Math.max(0, this.references - 1);
				throw error;
			});
		}
		if (
			this.opened &&
			(this.state.status === "ready" || this.state.status === "suspended")
		) {
			return Promise.resolve();
		}
		const generation = ++this.lifecycleGeneration;
		this.connectPromise = this.startConnect(options, generation).finally(() => {
			this.connectPromise = undefined;
		});
		return this.connectPromise.catch((error) => {
			this.references = Math.max(0, this.references - 1);
			throw error;
		});
	}

	async disconnect(): Promise<void> {
		if (this.references > 0) this.references--;
		if (this.references > 0 || this.closed) return;
		const frozen = this.isLocallyFrozen();
		const canUseOfflineBasis =
			this.connectionAuthorityConfirmed && this.hasReadableBasis();
		this.lifecycleGeneration++;
		await this.disconnectTransport();
		if (frozen) return;
		if (canUseOfflineBasis) {
			this.publishState(this.offlineState());
		} else {
			this.publishState(Object.freeze({ status: "idle" }));
		}
	}

	async close(): Promise<void> {
		if (this.closed) return;
		await this.persistChain.catch(() => undefined);
		this.closed = true;
		this.references = 0;
		this.lifecycleGeneration++;
		await this.disconnectTransport();
		this.stopEphemeralTimers();
		this.clearOfflineHorizonTimer();
		this.purgeAllFields();
		this.publishState(Object.freeze({ status: "closed" }));
	}

	async export(): Promise<Uint8Array> {
		if (!this.closed && this.state.status !== "recovery-required") {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		await this.persistChain.catch(() => undefined);
		const [stored, volatile] = await Promise.all([
			this.loadStoredRecoveryRecord().catch(() => undefined),
			this.volatileRecoveryRecord(),
		]);
		if (!stored && !volatile) {
			throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
		}
		return encodeRecoveryArtifact(
			Object.freeze({
				...(stored ? { stored } : {}),
				...(volatile ? { volatile } : {}),
			}),
		);
	}

	async discard(): Promise<void> {
		if (!this.closed && this.state.status !== "recovery-required") {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		await this.purgeStorage(true);
		this.pending.length = 0;
		this.clearOfflineHorizonTimer();
		this.pendingBytes = 0;
		this.aggregateEpoch = undefined;
		this.loadedAggregateEpoch = undefined;
		this.purgeAllFields();
		this.resetRoster();
		this.connectionAuthorityConfirmed = false;
		if (!this.closed) {
			this.publishState(Object.freeze({ status: "idle" }));
		}
	}

	transaction(
		callback: (tx: { readonly fields: Record<string, unknown> }) => void,
	): void {
		if (this.activeTransaction) {
			this.activeTransaction.poisoned = true;
			throw new CrdtMutationError("NESTED_TRANSACTION");
		}
		const updateId = randomUpdateId();
		const transaction: ActiveTransaction = {
			updateId,
			dotPrefix: updateIdHex(updateId),
			dotCounter: 1,
			poisoned: false,
			parts: new Map(),
		};
		this.activeTransaction = transaction;
		try {
			const returned = callback({ fields: this.fields });
			if (
				returned !== null &&
				(typeof returned === "object" || typeof returned === "function") &&
				"then" in (returned as object)
			) {
				throw new CrdtMutationError("ASYNC_TRANSACTION");
			}
			if (transaction.poisoned) {
				throw new CrdtMutationError("NESTED_TRANSACTION");
			}
			if (transaction.parts.size === 0) return;
			const staged = [...transaction.parts.values()].map((part) => ({
				field: part.field,
				replica: part.replica,
				bytes:
					part.field.contract.format === "text"
						? this.textEngine!.mergeUpdates(part.updates)
						: mergeClientSetUpdates(part.updates),
			}));
			this.commitLocalBundle(staged, updateId);
		} finally {
			this.activeTransaction = undefined;
		}
	}

	private async startConnect(
		options: {
			mode: RequestedMode;
			fallback?: "view";
		},
		generation: number,
	): Promise<void> {
		const runtime = this.host.runtime;
		if (!runtime || !this.runtimeLimitsValid) {
			this.publishState(
				Object.freeze({ status: "denied", code: "CRDT_UNAVAILABLE" }),
			);
			throw new CrdtConnectError("CRDT_UNAVAILABLE");
		}
		if (options.mode === "view" && options.fallback !== undefined) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		this.requestedMode = options.mode;
		this.requestedFallback = options.fallback;
		if (this.freezeExpiredPending()) {
			throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
		}
		this.resetRoster();
		this.connectionAuthorityConfirmed = false;
		this.publishState(Object.freeze({ status: "authorizing" }));
		const abort = new AbortController();
		this.sessionAbort = abort;
		let candidateOpened: CrdtClientOpenedSession | undefined;
		try {
			const realtime = this.host.realtimeSession;
			if (!realtime) throw new CrdtConnectError("CRDT_UNAVAILABLE");
			const edge = await realtime.acquireEdgeCapability(abort.signal);
			this.edgeLease = edge;
			this.assertConnectGeneration(generation);
			const openId = this.activeOpenId ?? globalThis.crypto.randomUUID();
			this.activeOpenId = openId;
			const opened = await this.exchange.open({
				openId,
				owner:
					this.kind === "collection"
						? {
								kind: "collection",
								key: this.ownerKey,
								id: this.locator!.id,
							}
						: { kind: "global", key: this.ownerKey },
				mode: options.mode,
				...(options.fallback ? { fallback: options.fallback } : {}),
				edgeSessionId: edge.sessionId,
				edgeToken: edge.token,
				signal: abort.signal,
			});
			candidateOpened = opened;
			this.assertConnectGeneration(generation);
			if (!openedPolicyMatches(opened, options)) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			if (
				this.owner &&
				!sameManifestContract(this.owner, opened.manifest) &&
				this.pending.length > 0
			) {
				this.enterRecovery("field_contract_changed");
				throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
			}
			await this.adoptOpenedSession(opened, () => {
				this.assertConnectGeneration(generation);
			});
			await this.loadPersistedDocument();
			this.assertConnectGeneration(generation);
			if (this.state.status === "recovery-required") {
				throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
			}
			this.publishState(Object.freeze({ status: "connecting" }));
			const unregister = await edge.registerCrdt({
				id: `crdt:${opened.bindingId}:${opened.deliveryGeneration}`,
				bindingId: opened.bindingId,
				onDirty: (lane) => this.onDirty(lane),
				onError: (error) => this.onRealtimeError(error),
			});
			this.unregisterDirty =
				typeof unregister === "function" ? unregister : undefined;
			this.topologyBoundOpened = opened;
			edge.release();
			this.edgeLease = undefined;
			this.assertConnectGeneration(generation);
			this.publishState(
				Object.freeze({
					status: "synchronizing",
					requestedMode: this.requestedMode!,
				}),
			);
			await this.synchronize();
			this.assertConnectGeneration(generation);
			const pulledState = this.getSnapshot();
			if (pulledState.status !== "ready") {
				throw new CrdtConnectError(
					pulledState.status === "recovery-required"
						? "CRDT_RECOVERY_REQUIRED"
						: "CRDT_PROTOCOL_REJECTED",
				);
			}
			this.scheduleHeartbeat();
			this.scheduleHealthPull();
		} catch (error) {
			if (
				generation === this.lifecycleGeneration &&
				!this.closed &&
				this.state.status !== "denied" &&
				this.state.status !== "closed" &&
				this.state.status !== "recovery-required" &&
				this.state.status !== "failed"
			) {
				const code = connectCode(error);
				if (code === "CRDT_UNAVAILABLE" || code === "CRDT_EDIT_NOT_ALLOWED") {
					this.publishState(Object.freeze({ status: "denied", code }));
				} else if (code === "CRDT_RECOVERY_REQUIRED") {
					this.enterRecovery("field_contract_changed");
				} else if (code === "CLOSED") {
					this.publishState(Object.freeze({ status: "closed" }));
				} else {
					this.publishState(
						Object.freeze({
							status: "failed",
							code,
							retryable: code !== "CRDT_PROTOCOL_REJECTED",
						}),
					);
				}
			}
			if (candidateOpened && this.opened !== candidateOpened) {
				await this.closeOpenedSession(candidateOpened);
			}
			await this.disconnectTransport(
				1000,
				"CRDT connection failed",
				candidateOpened === undefined,
			);
			throw error instanceof CrdtConnectError
				? error
				: new CrdtConnectError(connectCode(error));
		}
	}

	private assertConnectGeneration(generation: number): void {
		if (this.closed) throw new CrdtConnectError("CLOSED");
		if (generation !== this.lifecycleGeneration || this.references === 0) {
			throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		}
	}

	private isPullSessionCurrent(guard: PullSessionGuard): boolean {
		return (
			!this.closed &&
			!guard.sessionAbort.signal.aborted &&
			!guard.synchronizeAbort.signal.aborted &&
			this.sessionAbort === guard.sessionAbort &&
			this.synchronizeAbort === guard.synchronizeAbort &&
			this.opened === guard.opened &&
			this.topologyBoundOpened === guard.opened &&
			this.lifecycleGeneration === guard.lifecycleGeneration
		);
	}

	private assertPullSessionCurrent(guard: PullSessionGuard): void {
		if (!this.isPullSessionCurrent(guard)) {
			throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		}
	}

	private assertPersistGuard(guard: (() => boolean) | undefined): void {
		if (guard && !guard()) {
			throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		}
	}

	private async adoptOpenedSession(
		opened: CrdtClientOpenedSession,
		assertCurrent: () => void,
	): Promise<void> {
		assertCurrent();
		const identityChanged = this.assertOpenedSessionAdoptable(opened);
		if (identityChanged) await this.switchSubject(assertCurrent);
		assertCurrent();
		this.installManifest(opened.manifest);
		this.subject = opened.offlineSubjectKey;
		this.incarnationKey = opened.incarnationKey;
		this.serverNamespace = opened.namespace;
		this.deploymentFingerprint = opened.deploymentFingerprint;
		this.opened = opened;
	}

	private assertOpenedSessionAdoptable(
		opened: CrdtClientOpenedSession,
	): boolean {
		const subjectChanged =
			this.subject !== undefined && this.subject !== opened.offlineSubjectKey;
		const namespaceChanged =
			this.serverNamespace !== undefined &&
			(this.serverNamespace !== opened.namespace ||
				this.deploymentFingerprint !== opened.deploymentFingerprint);
		const incarnationChanged =
			this.incarnationKey !== undefined &&
			this.incarnationKey !== opened.incarnationKey;
		if (subjectChanged || namespaceChanged || incarnationChanged) {
			if (this.pending.length > 0) {
				this.enterRecovery(
					incarnationChanged ? "owner_retired" : "pending_update_rejected",
				);
				throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
			}
		}
		return subjectChanged || namespaceChanged || incarnationChanged;
	}

	private synchronize(): Promise<void> {
		if (!this.opened || this.topologyBoundOpened !== this.opened) {
			return Promise.reject(new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE"));
		}
		if (this.synchronizePromise) {
			this.synchronizeAgain = true;
			return this.synchronizePromise;
		}
		this.publishState(
			Object.freeze({
				status: "synchronizing",
				requestedMode: this.requestedMode!,
			}),
		);
		const opened = this.opened;
		const generation = this.lifecycleGeneration;
		const sessionAbort = this.sessionAbort;
		if (!sessionAbort || sessionAbort.signal.aborted) {
			return Promise.reject(new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE"));
		}
		const synchronizeAbort = new AbortController();
		const abortSynchronize = () =>
			synchronizeAbort.abort(sessionAbort.signal.reason);
		if (sessionAbort.signal.aborted) abortSynchronize();
		else
			sessionAbort.signal.addEventListener("abort", abortSynchronize, {
				once: true,
			});
		this.synchronizeAbort = synchronizeAbort;
		const operation = (async () => {
			do {
				this.synchronizeAgain = false;
				await this.coordinator.requestPull(this, () =>
					this.performPull(synchronizeAbort),
				);
				if (
					this.closed ||
					this.opened !== opened ||
					this.topologyBoundOpened !== opened ||
					this.lifecycleGeneration !== generation
				) {
					throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
				}
				await this.reconcileBeforeReplay(synchronizeAbort.signal);
			} while (this.synchronizeAgain);
			this.connectionAuthorityConfirmed = true;
			this.publishState(
				Object.freeze({
					status: "ready",
					fieldGrants: this.currentGrants(),
					fieldSyncing: Object.freeze([]),
					pendingUpdates: this.pending.length,
				}),
			);
			this.scheduleHeartbeat();
		})();
		const tracked = operation.finally(() => {
			sessionAbort.signal.removeEventListener("abort", abortSynchronize);
			if (this.synchronizeAbort === synchronizeAbort) {
				this.synchronizeAbort = undefined;
			}
			if (this.synchronizePromise === tracked) {
				this.synchronizePromise = undefined;
			}
		});
		this.synchronizePromise = tracked;
		return tracked;
	}

	private async performPull(synchronizeAbort: AbortController): Promise<void> {
		const opened = this.opened;
		const sessionAbort = this.sessionAbort;
		const lifecycleGeneration = this.lifecycleGeneration;
		if (!opened || !sessionAbort || sessionAbort.signal.aborted) {
			throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		}
		const guard: PullSessionGuard = {
			opened,
			sessionAbort,
			synchronizeAbort,
			lifecycleGeneration,
		};
		const pullId = randomUpdateId();
		const proofs = [...this.fieldsBySlot.values()]
			.filter(
				(field) =>
					field.replica !== undefined && field.fieldEpoch !== undefined,
			)
			.sort((left, right) => left.contract.fieldSlot - right.contract.fieldSlot)
			.map((field) => ({
				fieldSlot: field.contract.fieldSlot,
				fieldEpoch: field.fieldEpoch!,
				proof:
					field.contract.format === "text"
						? this.textEngine!.proof(field.replica)
						: new Uint8Array(),
			}));
		let continuation: string | null = null;
		let expectedFields: readonly CrdtExchangePullFieldV1[] | undefined;
		let expectedDigest: Uint8Array | undefined;
		let aggregateEpoch: bigint | undefined;
		let schemaVersion: number | undefined;
		let nextChunkIndex = 0;
		let totalBytes = 0;
		let pageCount = 0;
		const seenContinuations = new Set<string>();
		const chunks = new Map<
			number,
			{ bytes: Uint8Array[]; length: number; final: boolean }
		>();
		do {
			if (++pageCount > MAX_PULL_PAGES) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			if (continuation !== null) {
				if (seenContinuations.has(continuation)) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				seenContinuations.add(continuation);
			}
			const bytesBeforePage = totalBytes;
			const response = await this.exchangeRequest(
				{
					major: 1,
					minor: 0,
					opcode: 0x01,
					requestId: randomUpdateId(),
					payload: {
						...this.sessionPayload(),
						pullId,
						schemaVersion: opened.manifest.schemaVersion,
						continuation,
						proofs: continuation === null ? proofs : [],
					},
				},
				synchronizeAbort.signal,
			);
			if (
				response.opcode !== 0x81 ||
				!equalBytes(response.payload.pullId, pullId) ||
				response.payload.schemaVersion !== opened.manifest.schemaVersion
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			if (!expectedFields) {
				expectedFields = response.payload.fields;
				expectedDigest = new Uint8Array(response.payload.artifactDigest);
				aggregateEpoch = response.payload.aggregateEpoch;
				schemaVersion = response.payload.schemaVersion;
				for (const field of expectedFields) {
					const runtime = this.fieldsBySlot.get(field.fieldSlot);
					const authorizedGrant = this.authorizedGrants.get(field.fieldSlot);
					if (
						!runtime ||
						authorizedGrant === undefined ||
						(authorizedGrant === "view" && field.grant === 1) ||
						(opened.effectiveMode === "view" && field.grant === 1) ||
						runtime.contract.formatVersion !== field.formatVersion ||
						field.byteLength > MAX_FIELD_SNAPSHOT_BYTES
					) {
						throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
					}
					chunks.set(field.fieldSlot, {
						bytes: [],
						length: 0,
						final: field.byteLength === 0,
					});
				}
			} else if (
				response.payload.aggregateEpoch !== aggregateEpoch ||
				response.payload.schemaVersion !== schemaVersion ||
				!equalBytes(response.payload.artifactDigest, expectedDigest!) ||
				!samePullFields(response.payload.fields, expectedFields)
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			for (const chunk of response.payload.chunks) {
				const field = expectedFields.find(
					(candidate) => candidate.fieldSlot === chunk.fieldSlot,
				);
				const staged = chunks.get(chunk.fieldSlot);
				if (
					!field ||
					!staged ||
					staged.final ||
					chunk.chunkIndex !== nextChunkIndex++ ||
					chunk.fieldEpoch !== field.fieldEpoch ||
					chunk.formatVersion !== field.formatVersion ||
					chunk.throughFieldCursor !== field.fieldCursor ||
					chunk.offset !== staged.length ||
					staged.length + chunk.bytes.byteLength > field.byteLength
				) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				staged.bytes.push(new Uint8Array(chunk.bytes));
				staged.length += chunk.bytes.byteLength;
				totalBytes += chunk.bytes.byteLength;
				if (
					totalBytes > MAX_AGGREGATE_SNAPSHOT_BYTES ||
					(chunk.final && staged.length !== field.byteLength) ||
					(!chunk.final && staged.length === field.byteLength)
				) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				staged.final = chunk.final;
			}
			if (
				response.payload.complete !==
					(response.payload.continuation === null) ||
				(!response.payload.complete &&
					(response.payload.continuation === continuation ||
						totalBytes === bytesBeforePage))
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			continuation = response.payload.continuation;
		} while (continuation !== null);

		if (
			!this.isPullSessionCurrent(guard) ||
			!expectedFields ||
			!expectedDigest ||
			aggregateEpoch === undefined ||
			schemaVersion === undefined ||
			[...chunks.values()].some((field) => !field.final)
		) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		const snapshots = new Map<number, Uint8Array>();
		for (const field of expectedFields) {
			const bytes = concatenate(chunks.get(field.fieldSlot)!.bytes);
			const digest = await sha256(bytes);
			this.assertPullSessionCurrent(guard);
			if (
				bytes.byteLength !== field.byteLength ||
				!equalBytes(digest, field.digest)
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			snapshots.set(field.fieldSlot, bytes);
		}
		const artifactDigest = await pullArtifactDigest(expectedFields, snapshots);
		this.assertPullSessionCurrent(guard);
		if (!equalBytes(artifactDigest, expectedDigest)) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		await this.installPull({
			aggregateEpoch,
			schemaVersion,
			fields: expectedFields,
			snapshots,
			guard,
		});
	}

	private async installPull(input: {
		aggregateEpoch: bigint;
		schemaVersion: number;
		fields: readonly CrdtExchangePullFieldV1[];
		snapshots: ReadonlyMap<number, Uint8Array>;
		guard: PullSessionGuard;
	}): Promise<void> {
		this.assertPullSessionCurrent(input.guard);
		if (
			input.schemaVersion !== this.owner?.schemaVersion ||
			(this.loadedAggregateEpoch !== undefined &&
				this.loadedAggregateEpoch !== input.aggregateEpoch &&
				this.pending.length > 0)
		) {
			this.enterRecovery(
				this.pending.length > 0 ? "epoch_changed" : "field_contract_changed",
			);
			throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
		}
		for (const bundle of this.pending) {
			const computedHash = await this.hashBundle(bundle);
			this.assertPullSessionCurrent(input.guard);
			if (
				bundle.schemaVersion !== input.schemaVersion ||
				bundle.aggregateEpoch !== input.aggregateEpoch ||
				(bundle.submittedHash !== undefined &&
					!equalBytes(bundle.submittedHash, computedHash))
			) {
				this.enterRecovery(
					bundle.aggregateEpoch !== input.aggregateEpoch
						? "epoch_changed"
						: "local_store_corrupt",
				);
				throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
			}
			bundle.submittedHash = computedHash;
			for (const part of bundle.parts) {
				const visible = input.fields.find(
					(field) => field.fieldSlot === part.fieldSlot,
				);
				if (
					!visible ||
					visible.grant !== 1 ||
					visible.fieldEpoch !== part.fieldEpoch
				) {
					this.enterRecovery("pending_update_rejected");
					throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
				}
			}
		}
		const staged = new Map<FieldRuntime, PersistedFieldRuntime>();
		try {
			for (const view of input.fields) {
				const field = this.fieldsBySlot.get(view.fieldSlot);
				const bytes = input.snapshots.get(view.fieldSlot);
				if (!field || !bytes) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				let replica =
					bytes.byteLength === 0
						? field.replica === undefined ||
							field.fieldEpoch !== view.fieldEpoch
							? undefined
							: this.restore(field, this.snapshot(field))
						: this.restore(field, bytes);
				if (replica === undefined) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				staged.set(field, {
					field,
					replica,
					grant: view.grant === 1 ? "edit" : "view",
					fieldEpoch: view.fieldEpoch,
					fieldCursor: view.fieldCursor,
				});
			}
			for (const bundle of this.pending) {
				for (const part of bundle.parts) {
					const field = this.fieldsBySlot.get(part.fieldSlot)!;
					const value = staged.get(field)!;
					value.replica =
						field.contract.format === "text"
							? this.textEngine!.applyUpdate(value.replica, part.bytes)
							: applyClientSetUpdate(
									value.replica as CrdtClientSetReplica,
									part.bytes,
								);
				}
			}
		} catch (error) {
			if (error instanceof CrdtConnectError) throw error;
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		if (
			this.requestedMode === "edit" &&
			![...staged.values()].some((field) => field.grant === "edit") &&
			this.requestedFallback !== "view"
		) {
			throw new CrdtConnectError("CRDT_EDIT_NOT_ALLOWED");
		}
		try {
			await this.persist({
				aggregateEpoch: input.aggregateEpoch,
				schemaVersion: input.schemaVersion,
				fields: [...staged.values()],
				guard: () => this.isPullSessionCurrent(input.guard),
			});
		} catch (error) {
			if (
				error instanceof CrdtConnectError &&
				error.code === "CRDT_TRANSPORT_UNAVAILABLE"
			) {
				throw error;
			}
			this.enterRecovery("local_store_corrupt");
			throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
		}
		this.assertPullSessionCurrent(input.guard);
		for (const field of this.fieldsBySlot.values()) {
			const value = staged.get(field);
			if (!value) {
				this.hideField(field, false);
				continue;
			}
			field.replica = value.replica;
			field.grant = value.grant;
			field.fieldEpoch = value.fieldEpoch;
			field.fieldCursor = value.fieldCursor;
			field.hidden = false;
			field.syncing = false;
			field.chunks = [];
			field.chunkBytes = 0;
		}
		this.aggregateEpoch = input.aggregateEpoch;
		this.loadedAggregateEpoch = input.aggregateEpoch;
		this.schemaVersion = input.schemaVersion;
		this.revision++;
		this.notifyStateListeners();
	}

	private sessionPayload(opened = this.opened) {
		if (!opened) throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		return {
			bindingId: opened.bindingIdBytes,
			sessionGeneration: opened.sessionGeneration,
			deliveryGeneration: opened.deliveryGeneration,
		};
	}

	private async exchangeRequest(
		frame: Parameters<CrdtClientExchangePort["exchange"]>[0],
		signal = this.sessionAbort?.signal,
	): Promise<CrdtExchangeResponseFrameV1> {
		for (let attempt = 0; attempt < 32; attempt++) {
			const response = await this.exchange.exchange(frame, signal);
			if (response.opcode === 0xff) {
				throw new CrdtHttpRecoveryError();
			}
			if (response.opcode !== 0xfe) return response;
			if (
				!Number.isSafeInteger(response.payload.retryAfterMs) ||
				response.payload.retryAfterMs < 1 ||
				response.payload.retryAfterMs > 5_000
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			await abortableDelay(response.payload.retryAfterMs, signal);
		}
		throw new CrdtConnectError("CRDT_RATE_LIMITED");
	}

	private onDirty(lane: "visible" | "awareness"): void {
		if (!this.opened || this.closed) return;
		if (lane === "awareness") {
			this.coordinator.queueAwareness(this, "roster", async () => {
				try {
					await this.pullRoster();
				} catch (error) {
					this.handleBackgroundError(error);
				}
			});
			return;
		}
		const opened = this.opened;
		void this.synchronize().catch((error) => {
			if (
				this.opened === opened &&
				this.topologyBoundOpened === opened &&
				!this.closed
			) {
				this.handleBackgroundError(error);
			}
		});
	}

	private onRealtimeError(error: Error): void {
		this.connectionAuthorityConfirmed = false;
		this.topologyBoundOpened = undefined;
		if (!this.closed && !this.isLocallyFrozen()) {
			this.publishState(
				Object.freeze({
					status: "synchronizing",
					requestedMode: this.requestedMode!,
				}),
			);
		}
		void this.refreshAuthority().catch((refreshError) =>
			this.failBackground(refreshError ?? error),
		);
	}

	private handleBackgroundError(error: unknown): void {
		if (
			this.closed ||
			this.isLocallyFrozen() ||
			(!this.opened && this.references === 0)
		) {
			return;
		}
		if (error instanceof CrdtHttpRecoveryError) {
			this.connectionAuthorityConfirmed = false;
			this.topologyBoundOpened = undefined;
			this.publishState(
				Object.freeze({
					status: "synchronizing",
					requestedMode: this.requestedMode!,
				}),
			);
			void this.refreshAuthority().catch((refreshError) =>
				this.failBackground(refreshError),
			);
			return;
		}
		this.failBackground(error);
	}

	private failBackground(error: unknown): void {
		if (
			this.closed ||
			this.isLocallyFrozen() ||
			(!this.opened && this.references === 0)
		) {
			return;
		}
		const code = connectCode(error);
		if (code === "CRDT_RECOVERY_REQUIRED") {
			this.enterRecovery("pending_update_rejected");
			return;
		}
		if (this.connectionAuthorityConfirmed && this.hasReadableBasis()) {
			this.publishState(this.offlineState());
			return;
		}
		if (code === "CRDT_UNAVAILABLE" || code === "CRDT_EDIT_NOT_ALLOWED") {
			this.publishState(Object.freeze({ status: "denied", code }));
			return;
		}
		if (code === "CLOSED") {
			this.publishState(Object.freeze({ status: "closed" }));
			return;
		}
		this.publishState(
			Object.freeze({
				status: "failed",
				code,
				retryable: code !== "CRDT_PROTOCOL_REJECTED",
			}),
		);
	}

	private refreshAuthority(): Promise<void> {
		if (this.authorityRefreshPromise) return this.authorityRefreshPromise;
		const operation = this.performAuthorityRefresh();
		const tracked = operation.finally(() => {
			if (this.authorityRefreshPromise === tracked) {
				this.authorityRefreshPromise = undefined;
			}
		});
		this.authorityRefreshPromise = tracked;
		return tracked;
	}

	private async performAuthorityRefresh(): Promise<void> {
		const realtime = this.host.realtimeSession;
		if (
			!realtime ||
			!this.requestedMode ||
			!this.sessionAbort ||
			!this.opened
		) {
			throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		}
		const abort = this.sessionAbort;
		const generation = this.lifecycleGeneration;
		const previousOpened = this.opened;
		const nextOpenId = globalThis.crypto.randomUUID();
		const edge = await realtime.acquireEdgeCapability(abort.signal);
		this.edgeLease = edge;
		let installed = false;
		let candidateOpened: CrdtClientOpenedSession | undefined;
		try {
			const opened = await this.exchange.open({
				openId: nextOpenId,
				replacesBindingId: previousOpened.bindingId,
				owner:
					this.kind === "collection"
						? {
								kind: "collection",
								key: this.ownerKey,
								id: this.locator!.id,
							}
						: { kind: "global", key: this.ownerKey },
				mode: this.requestedMode,
				...(this.requestedFallback ? { fallback: this.requestedFallback } : {}),
				edgeSessionId: edge.sessionId,
				edgeToken: edge.token,
				signal: abort.signal,
			});
			candidateOpened = opened;
			if (
				abort !== this.sessionAbort ||
				abort.signal.aborted ||
				generation !== this.lifecycleGeneration ||
				!openedPolicyMatches(opened, {
					mode: this.requestedMode,
					...(this.requestedFallback
						? { fallback: this.requestedFallback }
						: {}),
				})
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			if (
				!sameManifestContract(this.owner!, opened.manifest) &&
				this.pending.length > 0
			) {
				this.enterRecovery("field_contract_changed");
				throw new CrdtConnectError("CRDT_RECOVERY_REQUIRED");
			}
			this.assertOpenedSessionAdoptable(opened);
			let registrationActive = false;
			const unregister = await edge.registerCrdt({
				id: `crdt:${opened.bindingId}:${opened.deliveryGeneration}`,
				bindingId: opened.bindingId,
				onDirty: (lane) => {
					if (registrationActive) this.onDirty(lane);
				},
				onError: (error) => {
					if (registrationActive) this.onRealtimeError(error);
				},
			});
			if (
				abort !== this.sessionAbort ||
				abort.signal.aborted ||
				generation !== this.lifecycleGeneration
			) {
				if (typeof unregister === "function") unregister();
				throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
			}
			const staleSynchronize = this.synchronizePromise;
			this.synchronizeAbort?.abort();
			this.coordinator.release(this);
			await staleSynchronize?.catch(() => undefined);
			try {
				await this.adoptOpenedSession(opened, () => {
					if (
						abort !== this.sessionAbort ||
						abort.signal.aborted ||
						generation !== this.lifecycleGeneration
					) {
						throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
					}
				});
			} catch (error) {
				if (typeof unregister === "function") unregister();
				throw error;
			}
			if (
				abort !== this.sessionAbort ||
				abort.signal.aborted ||
				generation !== this.lifecycleGeneration ||
				this.opened !== opened
			) {
				if (typeof unregister === "function") unregister();
				throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
			}
			this.topologyBoundOpened = opened;
			registrationActive = true;
			const previousUnregister = this.unregisterDirty;
			this.unregisterDirty =
				typeof unregister === "function" ? unregister : undefined;
			previousUnregister?.();
			this.activeOpenId = nextOpenId;
			installed = true;
			await this.closeOpenedSession(previousOpened);
		} finally {
			edge.release();
			if (this.edgeLease === edge) this.edgeLease = undefined;
			if (
				!installed &&
				candidateOpened &&
				candidateOpened.bindingId !== previousOpened?.bindingId
			) {
				await this.closeOpenedSession(candidateOpened);
			}
		}
		if (!installed) {
			throw new CrdtConnectError("CRDT_TRANSPORT_UNAVAILABLE");
		}
		await this.synchronize();
		this.scheduleHeartbeat();
		this.scheduleHealthPull();
	}

	private scheduleHealthPull(): void {
		if (this.healthPullHandle !== undefined || !this.opened || this.closed) {
			return;
		}
		const delay = 15_000 + Math.round(Math.random() * 15_000);
		this.healthPullHandle = this.clock.setTimeout(() => {
			this.healthPullHandle = undefined;
			if (!this.opened || this.closed) return;
			void this.synchronize()
				.catch((error) => this.handleBackgroundError(error))
				.finally(() => this.scheduleHealthPull());
		}, delay);
	}

	private hasPendingForField(field: FieldRuntime): boolean {
		return this.pending.some((bundle) =>
			bundle.parts.some((part) => part.fieldSlot === field.contract.fieldSlot),
		);
	}

	private async acceptReceiptList(
		receipts: readonly CrdtExchangeAppendReceiptV1[],
		expected: ReadonlySet<string>,
	): Promise<void> {
		const seen = new Set<string>();
		for (const receipt of receipts) {
			const key = updateIdHex(receipt.updateId);
			const bundle = this.pending.find((candidate) =>
				equalBytes(candidate.updateId, receipt.updateId),
			);
			if (
				receipt.aggregateEpoch !== bundle?.aggregateEpoch ||
				!expected.has(key) ||
				seen.has(key) ||
				!bundle
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			seen.add(key);
			this.assertReceiptCursors(bundle, receipt.cursors);
		}
		await this.removePending(receipts);
	}

	private async reconcileBeforeReplay(signal: AbortSignal): Promise<void> {
		const replay = this.pending.filter((bundle) => bundle.needsReconcile);
		if (replay.length > 0) {
			for (const bundle of replay) {
				bundle.submittedHash ??= await this.hashBundle(bundle);
			}
			const response = await this.exchangeRequest(
				{
					major: 1,
					minor: 0,
					opcode: 0x03,
					requestId: randomUpdateId(),
					payload: {
						...this.sessionPayload(),
						receipts: replay.map((bundle) => ({
							updateId: bundle.updateId,
							submittedHash: bundle.submittedHash!,
							aggregateEpoch: bundle.aggregateEpoch,
							schemaVersion: bundle.schemaVersion,
						})),
					},
				},
				signal,
			);
			if (response.opcode !== 0x83) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			await this.acceptReceiptList(
				response.payload.receipts,
				new Set(replay.map((bundle) => updateIdHex(bundle.updateId))),
			);
		}
		for (const bundle of this.pending) {
			bundle.needsReconcile = false;
			await this.sendBundle(bundle, true, signal);
		}
	}

	private async loadPersistedDocument(): Promise<void> {
		const namespace = `${this.serverNamespace!}:${this.deploymentFingerprint!}`;
		const bindingKey = storageKey([
			"binding",
			namespace,
			this.subject!,
			this.kind,
			this.ownerKey,
			this.locatorStorageKey(),
		]);
		const sameLoadedPartition = this.storageBindingKey === bindingKey;
		const previousGeneration = this.storageGeneration;
		const hadLoadedState =
			sameLoadedPartition &&
			(this.storageExactKey !== undefined ||
				this.storageBasisRevision !== 0 ||
				this.storageGeneration !== 0 ||
				this.pending.length > 0 ||
				this.hasReadableBasis());
		this.storageBindingKey = bindingKey;
		let storedRecord;
		if (this.storage.loadPartition) {
			let partition;
			try {
				partition = await this.storage.loadPartition(
					this.storageBindingKey,
					this.clock.now(),
				);
			} catch {
				this.enterRecovery("local_store_corrupt");
				return;
			}
			if (
				hadLoadedState &&
				partition.generation !== previousGeneration &&
				this.pending.length > 0
			) {
				this.enterRecovery("pending_update_rejected");
				return;
			}
			this.storageBasisRevision = partition.revision;
			this.storageGeneration = partition.generation;
			storedRecord = partition.document;
			if (storedRecord === undefined) {
				if (this.pending.length > 0) {
					this.enterRecovery("local_store_corrupt");
					return;
				}
				this.resetLoadedDocumentState();
				return;
			}
		} else {
			let bindingRecord;
			try {
				bindingRecord = await this.storage.load(this.storageBindingKey);
			} catch {
				this.enterRecovery("local_store_corrupt");
				return;
			}
			if (bindingRecord === undefined) return;
			if (
				!isStoredDocument(bindingRecord) ||
				!isPersistedBinding(bindingRecord.value)
			) {
				this.enterRecovery("local_store_corrupt");
				return;
			}
			try {
				storedRecord = await this.storage.load(bindingRecord.value.exactKey);
			} catch {
				this.enterRecovery("local_store_corrupt");
				return;
			}
		}
		if (
			!isStoredDocument(storedRecord) ||
			!isPersistedDocument(storedRecord.value)
		) {
			this.enterRecovery("local_store_corrupt");
			return;
		}
		const stored = storedRecord.value;
		if (
			stored.exactKey !== expectedStoredExactKey(stored) ||
			stored.namespace !== namespace ||
			stored.subject !== this.subject ||
			stored.ownerKind !== this.kind ||
			stored.ownerKey !== this.ownerKey ||
			(stored.locator ?? "") !== this.locatorStorageKey()
		) {
			this.enterRecovery("local_store_corrupt");
			return;
		}
		if (stored.incarnationKey !== this.incarnationKey) {
			this.enterRecovery("owner_retired", stored.pending.length);
			return;
		}
		if (
			stored.pending.some(
				(bundle) =>
					bundle.createdAt > this.clock.now() ||
					this.clock.now() - bundle.createdAt > CRDT_OFFLINE_HORIZON_MS,
			)
		) {
			this.enterRecovery(
				stored.pending.some((bundle) => bundle.createdAt > this.clock.now())
					? "local_store_corrupt"
					: "offline_horizon_expired",
				stored.pending.length,
			);
			return;
		}
		this.resetLoadedDocumentState();
		if (
			stored.schemaFingerprint !== this.owner!.schemaFingerprint ||
			stored.schemaVersion !== this.owner!.schemaVersion
		) {
			try {
				this.restoreDetachedPending(stored);
			} catch {
				this.enterRecovery("local_store_corrupt", stored.pending.length);
			}
			return;
		}
		if (
			stored.pending.some((bundle) =>
				bundle.parts.some(
					(part) => this.authorizedGrants.get(part.fieldSlot) !== "edit",
				),
			)
		) {
			try {
				this.restoreDetachedPending(stored);
				this.enterRecovery("pending_update_rejected", stored.pending.length);
			} catch {
				this.enterRecovery("local_store_corrupt", stored.pending.length);
			}
			return;
		}
		try {
			this.restorePersistedDocument(stored);
		} catch {
			this.purgeAllFields();
			this.pending.length = 0;
			this.pendingBytes = 0;
			this.enterRecovery("local_store_corrupt");
		}
	}

	private resetLoadedDocumentState(): void {
		this.pending.length = 0;
		this.pendingBytes = 0;
		this.aggregateEpoch = undefined;
		this.loadedAggregateEpoch = undefined;
		this.schemaVersion = undefined;
		this.storageExactKey = undefined;
		this.clearOfflineHorizonTimer();
		this.purgeAllFields();
	}

	private async switchSubject(assertCurrent: () => void): Promise<void> {
		await this.purgeStorage(true);
		assertCurrent();
		this.pending.length = 0;
		this.pendingBytes = 0;
		this.aggregateEpoch = undefined;
		this.loadedAggregateEpoch = undefined;
		this.schemaVersion = undefined;
		this.subject = undefined;
		this.incarnationKey = undefined;
		this.serverNamespace = undefined;
		this.deploymentFingerprint = undefined;
		this.storageBindingKey = undefined;
		this.storageExactKey = undefined;
		this.storageBasisRevision = 0;
		this.storageGeneration = 0;
		this.purgeAllFields();
		this.resetRoster();
	}

	private restorePersistedDocument(stored: PersistedDocument): void {
		const seenFields = new Set<number>();
		let previousFieldSlot = 0;
		for (const persisted of stored.fields) {
			const field = this.fieldsBySlot.get(persisted.fieldSlot);
			if (
				seenFields.has(persisted.fieldSlot) ||
				persisted.fieldSlot <= previousFieldSlot ||
				(persisted.grant !== "view" && persisted.grant !== "edit")
			) {
				throw new Error("invalid persisted field");
			}
			seenFields.add(persisted.fieldSlot);
			previousFieldSlot = persisted.fieldSlot;
			if (!field) continue;
			field.replica = this.restore(field, persisted.snapshot);
			field.fieldEpoch = parseStoredU64(persisted.fieldEpoch);
			field.fieldCursor = parseStoredU64(persisted.fieldCursor);
			field.grant =
				this.authorizedGrants.get(persisted.fieldSlot) ?? persisted.grant;
			field.hidden = false;
			field.syncing = false;
		}
		for (const persisted of stored.pending) {
			let previousPartSlot = 0;
			const parts = persisted.parts.map((part) => {
				const field = this.fieldsBySlot.get(part.fieldSlot);
				const fieldEpoch = parseStoredU64(part.fieldEpoch);
				if (
					!field ||
					part.fieldSlot <= previousPartSlot ||
					field.fieldEpoch === undefined ||
					field.fieldEpoch !== fieldEpoch ||
					!(part.bytes instanceof Uint8Array) ||
					part.bytes.byteLength === 0
				) {
					throw new Error("invalid persisted pending part");
				}
				previousPartSlot = part.fieldSlot;
				return {
					field,
					fieldSlot: part.fieldSlot,
					fieldEpoch,
					formatVersion: part.formatVersion,
					baseFieldCursor: parseStoredU64(part.baseFieldCursor),
					bytes: new Uint8Array(part.bytes),
				};
			});
			const byteLength = parts.reduce(
				(total, part) => total + part.bytes.byteLength,
				0,
			);
			if (
				!(persisted.updateId instanceof Uint8Array) ||
				persisted.updateId.byteLength !== 16 ||
				!(persisted.submittedHash instanceof Uint8Array) ||
				persisted.submittedHash.byteLength !== 32
			) {
				throw new Error("invalid persisted bundle");
			}
			this.pending.push({
				updateId: new Uint8Array(persisted.updateId),
				createdAt: persisted.createdAt,
				aggregateEpoch: parseStoredU64(persisted.aggregateEpoch),
				schemaVersion: persisted.schemaVersion,
				parts,
				byteLength,
				submittedHash: new Uint8Array(persisted.submittedHash),
				needsReconcile: true,
				submitting: false,
			});
			this.pendingBytes += byteLength;
		}
		if (
			this.pending.length > this.maximumPendingUpdates ||
			this.pendingBytes > this.maximumPendingBytes
		) {
			throw new Error("persisted queue exceeds cap");
		}
		this.loadedAggregateEpoch = parseStoredU64(stored.aggregateEpoch);
		this.storageExactKey = stored.exactKey;
		this.scheduleOfflineHorizon();
	}

	private restoreDetachedPending(stored: PersistedDocument): void {
		for (const persisted of stored.pending) {
			let previousPartSlot = 0;
			const parts = persisted.parts.map((part) => {
				if (
					part.fieldSlot <= previousPartSlot ||
					!(part.bytes instanceof Uint8Array) ||
					part.bytes.byteLength === 0
				) {
					throw new Error("invalid persisted compatibility part");
				}
				previousPartSlot = part.fieldSlot;
				return {
					fieldSlot: part.fieldSlot,
					fieldEpoch: parseStoredU64(part.fieldEpoch),
					formatVersion: part.formatVersion,
					baseFieldCursor: parseStoredU64(part.baseFieldCursor),
					bytes: new Uint8Array(part.bytes),
				};
			});
			const byteLength = parts.reduce(
				(total, part) => total + part.bytes.byteLength,
				0,
			);
			this.pending.push({
				updateId: new Uint8Array(persisted.updateId),
				createdAt: persisted.createdAt,
				aggregateEpoch: parseStoredU64(persisted.aggregateEpoch),
				schemaVersion: persisted.schemaVersion,
				parts,
				byteLength,
				submittedHash: new Uint8Array(persisted.submittedHash),
				needsReconcile: true,
				submitting: false,
			});
			this.pendingBytes += byteLength;
		}
		if (
			this.pending.length > this.maximumPendingUpdates ||
			this.pendingBytes > this.maximumPendingBytes
		) {
			throw new Error("persisted queue exceeds cap");
		}
		this.loadedAggregateEpoch = parseStoredU64(stored.aggregateEpoch);
		this.storageExactKey = stored.exactKey;
		this.scheduleOfflineHorizon();
	}

	private async persist(
		install?: Readonly<{
			aggregateEpoch: bigint;
			schemaVersion: number;
			fields: readonly PersistedFieldRuntime[];
			guard: () => boolean;
		}>,
	): Promise<void> {
		const write = async () => {
			this.assertPersistGuard(install?.guard);
			const aggregateEpoch = install?.aggregateEpoch ?? this.aggregateEpoch;
			const schemaVersion = install?.schemaVersion ?? this.schemaVersion;
			if (
				this.closed ||
				!this.storageBindingKey ||
				!this.subject ||
				!this.incarnationKey ||
				aggregateEpoch === undefined ||
				schemaVersion === undefined
			) {
				return;
			}
			if (this.freezeExpiredPending()) {
				throw new Error("CRDT offline horizon expired");
			}
			for (const bundle of this.pending) {
				bundle.submittedHash ??= await this.hashBundle(bundle);
				this.assertPersistGuard(install?.guard);
			}
			const fields = (
				install?.fields ??
				[...this.fieldsBySlot.values()]
					.filter(
						(field) =>
							field.replica !== undefined &&
							field.grant !== undefined &&
							field.fieldEpoch !== undefined &&
							field.fieldCursor !== undefined,
					)
					.map(
						(field): PersistedFieldRuntime => ({
							field,
							replica: field.replica,
							grant: field.grant!,
							fieldEpoch: field.fieldEpoch!,
							fieldCursor: field.fieldCursor!,
						}),
					)
			)
				.slice()
				.sort(
					(left, right) =>
						left.field.contract.fieldSlot - right.field.contract.fieldSlot,
				);
			const exactKey = storageKey([
				"document",
				`${this.serverNamespace!}:${this.deploymentFingerprint!}`,
				this.subject,
				this.incarnationKey,
				this.kind,
				this.ownerKey,
				this.locatorStorageKey(),
				this.owner!.schemaFingerprint,
				String(schemaVersion),
				aggregateEpoch.toString(),
				...fields.map(
					(field) =>
						`${field.field.contract.fieldSlot}:${field.fieldEpoch.toString()}`,
				),
			]);
			const value: PersistedDocument = Object.freeze({
				kind: "document",
				exactKey,
				namespace: `${this.serverNamespace!}:${this.deploymentFingerprint!}`,
				subject: this.subject,
				incarnationKey: this.incarnationKey,
				ownerKind: this.kind,
				ownerKey: this.ownerKey,
				...(this.locator ? { locator: this.locatorStorageKey() } : {}),
				schemaFingerprint: this.owner!.schemaFingerprint,
				schemaVersion,
				aggregateEpoch: aggregateEpoch.toString(),
				fields: fields.map((field) =>
					Object.freeze({
						fieldSlot: field.field.contract.fieldSlot,
						fieldEpoch: field.fieldEpoch.toString(),
						fieldCursor: field.fieldCursor.toString(),
						grant: field.grant,
						snapshot: this.snapshotReplica(field.field, field.replica),
					}),
				),
				pending: this.pending.map((bundle) =>
					Object.freeze({
						updateId: new Uint8Array(bundle.updateId),
						createdAt: bundle.createdAt,
						aggregateEpoch: bundle.aggregateEpoch.toString(),
						schemaVersion: bundle.schemaVersion,
						submittedHash: new Uint8Array(bundle.submittedHash!),
						parts: bundle.parts.map((part) =>
							Object.freeze({
								fieldSlot: part.fieldSlot,
								fieldEpoch: part.fieldEpoch.toString(),
								formatVersion: part.formatVersion,
								baseFieldCursor: part.baseFieldCursor.toString(),
								bytes: new Uint8Array(part.bytes),
							}),
						),
					}),
				),
			});
			const now = this.clock.now();
			const previous = this.storageExactKey;
			const document = Object.freeze({
				version: 1 as const,
				updatedAt: now,
				value,
			});
			this.assertPersistGuard(install?.guard);
			if (this.storage.commitPartition) {
				const result = await this.storage.commitPartition({
					bindingKey: this.storageBindingKey,
					exactKey,
					document,
					now,
					expectedRevision: this.storageBasisRevision,
					expectedGeneration: this.storageGeneration,
				});
				this.assertPersistGuard(install?.guard);
				if (!result.bundlesAccepted) {
					throw new Error("CRDT partition generation changed");
				}
				if (result.basisAccepted) {
					this.storageBasisRevision = result.revision;
					this.storageGeneration = result.generation;
					this.storageExactKey = exactKey;
				}
			} else {
				await this.storage.save(exactKey, document);
				this.assertPersistGuard(install?.guard);
				await this.storage.save(this.storageBindingKey, {
					version: 1,
					updatedAt: now,
					value: Object.freeze({
						kind: "binding",
						exactKey,
					} satisfies PersistedBinding),
				});
				this.assertPersistGuard(install?.guard);
				if (previous && previous !== exactKey) {
					await this.storage.remove(previous);
					this.assertPersistGuard(install?.guard);
				}
				this.storageExactKey = exactKey;
			}
		};
		this.persistChain = this.persistChain.then(write, write);
		return this.persistChain;
	}

	private schedulePersist(): void {
		void this.persist().catch(() => {
			if (!this.closed && this.state.status !== "recovery-required") {
				this.enterRecovery("local_store_corrupt");
			}
		});
	}

	private async purgeStorage(strict = false): Promise<void> {
		await this.persistChain.catch(() => undefined);
		if (this.storageBindingKey && this.storage.purgePartition) {
			const purge = this.storage.purgePartition(this.storageBindingKey);
			if (strict) await purge;
			else await purge.catch(() => undefined);
			this.storageExactKey = undefined;
			this.storageBasisRevision = 0;
			this.storageGeneration = 0;
			return;
		}
		let exactKey = this.storageExactKey;
		if (!exactKey && this.storageBindingKey) {
			const load = this.storage.load(this.storageBindingKey);
			const binding = strict ? await load : await load.catch(() => undefined);
			if (isStoredDocument(binding) && isPersistedBinding(binding.value)) {
				exactKey = binding.value.exactKey;
			}
		}
		if (exactKey) {
			const remove = this.storage.remove(exactKey);
			if (strict) await remove;
			else await remove.catch(() => undefined);
		}
		if (this.storageBindingKey) {
			const remove = this.storage.remove(this.storageBindingKey);
			if (strict) await remove;
			else await remove.catch(() => undefined);
		}
		this.storageExactKey = undefined;
		this.storageBasisRevision = 0;
		this.storageGeneration = 0;
	}

	private async loadStoredRecoveryRecord(): Promise<
		| Readonly<{
				bindingKey: string;
				binding: CrdtClientStoredDocument;
				document: CrdtClientStoredDocument;
		  }>
		| undefined
	> {
		if (!this.storageBindingKey) return undefined;
		if (this.storage.loadPartition) {
			const partition = await this.storage.loadPartition(
				this.storageBindingKey,
				this.clock.now(),
			);
			const document = partition.document;
			if (!isStoredDocument(document)) return undefined;
			return Object.freeze({
				bindingKey: this.storageBindingKey,
				binding: Object.freeze({
					version: 1,
					updatedAt: document.updatedAt,
					value: Object.freeze({
						kind: "binding",
						exactKey: isPersistedDocument(document.value)
							? document.value.exactKey
							: "",
					}),
				}),
				document,
			});
		}
		const binding = await this.storage.load(this.storageBindingKey);
		if (!isStoredDocument(binding) || !isPersistedBinding(binding.value)) {
			return undefined;
		}
		const document = await this.storage.load(binding.value.exactKey);
		if (!isStoredDocument(document)) return undefined;
		return Object.freeze({
			bindingKey: this.storageBindingKey,
			binding,
			document,
		});
	}

	private async volatileRecoveryRecord(): Promise<unknown | undefined> {
		if (
			this.pending.length === 0 ||
			!this.storageBindingKey ||
			!this.subject ||
			!this.incarnationKey
		) {
			return undefined;
		}
		for (const bundle of this.pending) {
			bundle.submittedHash ??= await this.hashBundle(bundle);
		}
		return Object.freeze({
			bindingKey: this.storageBindingKey,
			namespace: `${this.serverNamespace!}:${this.deploymentFingerprint!}`,
			subject: this.subject,
			incarnationKey: this.incarnationKey,
			ownerKind: this.kind,
			ownerKey: this.ownerKey,
			...(this.locator ? { locator: this.locatorStorageKey() } : {}),
			pending: this.pending.map((bundle) =>
				Object.freeze({
					updateId: new Uint8Array(bundle.updateId),
					createdAt: bundle.createdAt,
					aggregateEpoch: bundle.aggregateEpoch.toString(),
					schemaVersion: bundle.schemaVersion,
					submittedHash: new Uint8Array(bundle.submittedHash!),
					parts: bundle.parts.map((part) =>
						Object.freeze({
							fieldSlot: part.fieldSlot,
							fieldEpoch: part.fieldEpoch.toString(),
							formatVersion: part.formatVersion,
							baseFieldCursor: part.baseFieldCursor.toString(),
							bytes: new Uint8Array(part.bytes),
						}),
					),
				}),
			),
		});
	}

	private snapshot(field: FieldRuntime): Uint8Array {
		return this.snapshotReplica(field, field.replica);
	}

	private snapshotReplica(field: FieldRuntime, replica: unknown): Uint8Array {
		return field.contract.format === "text"
			? this.textEngine!.snapshot(replica)
			: snapshotClientSetReplica(replica as CrdtClientSetReplica);
	}

	private locatorStorageKey(): string {
		if (!this.locator) return "";
		return typeof this.locator.id === "number"
			? `number:${this.locator.id}`
			: `string:${this.locator.id}`;
	}

	private async hashBundle(bundle: PendingBundle): Promise<Uint8Array> {
		const writer = new DigestWriter();
		writer.u64(bundle.aggregateEpoch);
		writer.u32(bundle.schemaVersion);
		writer.u16(bundle.parts.length);
		for (const part of bundle.parts) {
			writer.u16(part.fieldSlot);
			writer.u64(part.fieldEpoch);
			writer.u16(part.formatVersion);
			writer.u64(part.baseFieldCursor);
			writer.lengthPrefixed(part.bytes);
		}
		const input = new Uint8Array(writer.finish());
		return new Uint8Array(await crypto.subtle.digest("SHA-256", input.buffer));
	}

	private enterRecovery(
		reason:
			| "epoch_changed"
			| "offline_horizon_expired"
			| "pending_update_rejected"
			| "owner_retired"
			| "field_contract_changed"
			| "queue_limit"
			| "local_store_corrupt",
		pendingUpdates = this.pending.length,
	): void {
		this.publishState(
			Object.freeze({
				status: "recovery-required",
				reason,
				pendingUpdates,
			}),
		);
	}

	private createAwareness(): unknown {
		const awareness = {
			set: (
				value: unknown,
				active?: {
					activeField: string;
					cursor?: number;
					selectionEnd?: number;
				},
			) => this.setAwareness(value, active),
			clear: () =>
				this.queueAwareness(Object.freeze({ v: 1, kind: "awareness-clear" })),
			getRoster: () => this.roster,
			subscribe: (listener: (roster: PublicRoster) => void) => {
				this.rosterListeners.add(listener);
				let subscribed = true;
				return () => {
					if (!subscribed) return;
					subscribed = false;
					this.rosterListeners.delete(listener);
				};
			},
		};
		Object.defineProperty(awareness, "enabled", {
			enumerable: true,
			get: () => this.owner?.awarenessEnabled ?? false,
		});
		return Object.freeze(awareness);
	}

	private setAwareness(
		value: unknown,
		active?: {
			activeField: string;
			cursor?: number;
			selectionEnd?: number;
		},
	): void {
		if (this.state.status !== "ready") {
			throw new CrdtMutationError("NOT_READY");
		}
		if (!this.owner?.awarenessEnabled) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		let parsed: unknown;
		try {
			parsed = snapshotAwarenessProfile(value);
			assertNoReservedAwarenessKeys(parsed);
		} catch {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		let encodedActive:
			| {
					fieldSlot: number;
					cursor?: string;
					selectionEnd?: string;
			  }
			| undefined;
		if (active) {
			const field = this.fieldsByKey.get(active.activeField);
			if (
				!field ||
				field.contract.format !== "text" ||
				field.replica === undefined ||
				field.grant === undefined ||
				field.syncing
			) {
				throw new CrdtMutationError("INVALID_OPERATION");
			}
			encodedActive = { fieldSlot: field.contract.fieldSlot };
			if (active.cursor !== undefined) {
				encodedActive.cursor = this.encodeAwarenessPosition(
					field,
					active.cursor,
				);
			}
			if (active.selectionEnd !== undefined) {
				encodedActive.selectionEnd = this.encodeAwarenessPosition(
					field,
					active.selectionEnd,
				);
			}
		}
		this.queueAwareness(
			Object.freeze({
				v: 1,
				kind: "awareness",
				value: parsed,
				...(encodedActive ? { active: Object.freeze(encodedActive) } : {}),
			}),
		);
	}

	private encodeAwarenessPosition(field: FieldRuntime, offset: number): string {
		const engine = this.textEngine!;
		const text = engine.value(field.replica);
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			offset > text.length ||
			!isUtf16Boundary(text, offset)
		) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		const position = engine.relativePositions.create(field.replica, {
			offset,
			affinity: "following",
		});
		if (!isCanonicalBase64Url(position, 64)) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		return position;
	}

	private queueAwareness(value: unknown): void {
		if (this.state.status !== "ready") {
			throw new CrdtMutationError("NOT_READY");
		}
		this.pendingAwareness = value;
		this.coordinator.queueAwareness(this, "outbound", async () => {
			try {
				await this.flushAwareness();
			} catch (error) {
				this.handleBackgroundError(error);
			}
		});
	}

	private async flushAwareness(): Promise<void> {
		if (this.pendingAwareness === undefined || this.state.status !== "ready") {
			return;
		}
		const value = this.pendingAwareness;
		this.pendingAwareness = undefined;
		const response = await this.exchangeRequest({
			major: 1,
			minor: 0,
			opcode: 0x04,
			requestId: randomUpdateId(),
			payload: {
				...this.sessionPayload(),
				...(isAwarenessClear(value)
					? { action: "clear" as const }
					: { action: "write" as const, value }),
			},
		});
		if (response.opcode !== 0x84) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		this.receiveRosterPages(response.payload.value);
	}

	private async pullRoster(): Promise<void> {
		if (!this.opened || !this.owner?.awarenessEnabled) return;
		const response = await this.exchangeRequest({
			major: 1,
			minor: 0,
			opcode: 0x04,
			requestId: randomUpdateId(),
			payload: { ...this.sessionPayload(), action: "roster" },
		});
		if (response.opcode !== 0x84) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		this.receiveRosterPages(response.payload.value);
	}

	private receiveRosterPages(value: unknown): void {
		if (!Array.isArray(value) || value.length > 16) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		for (const page of value) this.receiveRosterPage(page);
	}

	private receiveRosterPage(value: unknown): void {
		const page = parseRosterPage(value);
		if (
			this.rosterGeneration !== undefined &&
			page.generation !== this.rosterGeneration
		) {
			this.rosterPages.clear();
		}
		this.rosterGeneration = page.generation;
		const canonical = canonicalPresenceJson(value);
		if (new TextEncoder().encode(canonical).byteLength > 1024) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		const duplicate = this.rosterPages.get(page.pageIndex);
		if (duplicate) {
			if (
				duplicate.pageCount !== page.pageCount ||
				duplicate.canonical !== canonical
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			return;
		}
		if (
			[...this.rosterPages.values()].some(
				(existing) => existing.pageCount !== page.pageCount,
			)
		) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		this.rosterPages.set(page.pageIndex, {
			pageCount: page.pageCount,
			canonical,
			participants: page.participants,
		});
		if (this.rosterPages.size !== page.pageCount) return;
		const rawParticipants = Array.from(
			{ length: page.pageCount },
			(_, index) => this.rosterPages.get(index)?.participants,
		);
		if (rawParticipants.some((participants) => participants === undefined)) {
			return;
		}
		const roster = this.projectPublicRoster(
			rawParticipants.flat() as unknown[],
		);
		this.roster = Object.freeze(roster);
		this.notifyRosterListeners();
		this.scheduleRosterExpiry();
	}

	private projectPublicRoster(participants: readonly unknown[]): PublicRoster {
		if (participants.length > 100) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		let sessionCount = 0;
		let previousParticipant = "";
		const projected = participants.map((candidate) => {
			if (!isExactRecord(candidate, ["participantId", "sessions"])) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			const participantId = candidate.participantId;
			if (
				typeof participantId !== "string" ||
				!/^[A-Za-z0-9_-]{22}$/.test(participantId) ||
				participantId <= previousParticipant ||
				!Array.isArray(candidate.sessions) ||
				candidate.sessions.length === 0 ||
				candidate.sessions.length > 5
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			previousParticipant = participantId;
			let previousSession = "";
			const sessions = candidate.sessions.map((session) => {
				sessionCount++;
				if (sessionCount > 100) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				if (
					!isExactRecord(session, [
						"sessionId",
						"value",
						"expiresAtMs",
						"active?",
					]) ||
					typeof session.sessionId !== "string" ||
					!isUuid(session.sessionId) ||
					session.sessionId <= previousSession ||
					typeof session.expiresAtMs !== "number" ||
					!Number.isSafeInteger(session.expiresAtMs) ||
					session.expiresAtMs < 0
				) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				previousSession = session.sessionId;
				let parsed: unknown;
				try {
					parsed = snapshotAwarenessProfile(session.value);
					assertNoReservedAwarenessKeys(parsed);
				} catch {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				const active = this.projectRosterActive(session.active);
				return Object.freeze({
					sessionId: session.sessionId,
					value: parsed,
					...(active ? { active } : {}),
					expiresAtMs: session.expiresAtMs,
				});
			});
			return Object.freeze({
				participantId,
				sessions: Object.freeze(sessions),
			});
		});
		return Object.freeze(projected);
	}

	private projectRosterActive(value: unknown):
		| Readonly<{
				field: string;
				cursor?: number;
				selectionEnd?: number;
		  }>
		| undefined {
		if (value === undefined) return undefined;
		if (
			!isExactRecord(value, ["fieldSlot", "cursor?", "selectionEnd?"]) ||
			!Number.isSafeInteger(value.fieldSlot)
		) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		const field = this.fieldsBySlot.get(value.fieldSlot as number);
		if (
			!field ||
			field.contract.format !== "text" ||
			field.replica === undefined ||
			field.grant === undefined
		) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		const result: {
			field: string;
			cursor?: number;
			selectionEnd?: number;
		} = { field: field.key };
		for (const key of ["cursor", "selectionEnd"] as const) {
			const token = value[key];
			if (token === undefined) continue;
			if (typeof token !== "string" || !isCanonicalBase64Url(token)) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			const resolved = this.textEngine!.relativePositions.resolve(
				field.replica,
				token,
			);
			if (resolved === undefined) continue;
			const offset = resolved.offset;
			const text = this.textEngine!.value(field.replica);
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				offset > text.length ||
				!isUtf16Boundary(text, offset)
			) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			result[key] = offset;
		}
		return Object.freeze(result);
	}

	private scheduleHeartbeat(): void {
		if (
			this.heartbeatHandle !== undefined ||
			this.state.status !== "ready" ||
			!this.opened
		) {
			return;
		}
		this.heartbeatHandle = this.clock.setTimeout(() => {
			this.heartbeatHandle = undefined;
			if (this.state.status !== "ready" || !this.opened) return;
			void this.exchangeRequest({
				major: 1,
				minor: 0,
				opcode: 0x05,
				requestId: randomUpdateId(),
				payload: this.sessionPayload(),
			})
				.then((response) => {
					if (response.opcode !== 0x85) {
						throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
					}
					const serverTimeMs = Number(response.payload.serverTimeMs);
					if (!Number.isSafeInteger(serverTimeMs)) {
						throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
					}
					this.serverClockOffsetMs = serverTimeMs - this.clock.now();
					this.scheduleRosterExpiry();
					if (this.opened) this.scheduleHeartbeat();
				})
				.catch((error) => this.handleBackgroundError(error));
		}, 10_000);
	}

	private scheduleRosterExpiry(): void {
		if (this.rosterExpiryHandle !== undefined) {
			this.clock.clearTimeout(this.rosterExpiryHandle);
		}
		const now = this.clock.now() + this.serverClockOffsetMs;
		const expiresAt = this.roster
			.flatMap((participant) =>
				participant.sessions.map((session) => session.expiresAtMs),
			)
			.reduce<number | undefined>(
				(earliest, value) =>
					earliest === undefined ? value : Math.min(earliest, value),
				undefined,
			);
		if (expiresAt === undefined) return;
		this.rosterExpiryHandle = this.clock.setTimeout(
			() => {
				this.rosterExpiryHandle = undefined;
				const serverNow = this.clock.now() + this.serverClockOffsetMs;
				const next = this.roster
					.map((participant) =>
						Object.freeze({
							...participant,
							sessions: Object.freeze(
								participant.sessions.filter(
									(session) => session.expiresAtMs > serverNow,
								),
							),
						}),
					)
					.filter((participant) => participant.sessions.length > 0);
				this.roster = Object.freeze(next);
				this.notifyRosterListeners();
				this.scheduleRosterExpiry();
			},
			Math.max(0, expiresAt - now),
		);
	}

	private resetRoster(): void {
		if (this.rosterExpiryHandle !== undefined) {
			this.clock.clearTimeout(this.rosterExpiryHandle);
			this.rosterExpiryHandle = undefined;
		}
		this.rosterGeneration = undefined;
		this.rosterPages.clear();
		if (this.roster.length === 0) return;
		this.roster = Object.freeze([]);
		this.notifyRosterListeners();
	}

	private notifyRosterListeners(): void {
		for (const listener of this.rosterListeners) {
			try {
				listener(this.roster);
			} catch {
				// Observers cannot interrupt protocol processing or roster expiry.
			}
		}
	}

	private stopEphemeralTimers(): void {
		for (const handle of [
			this.heartbeatHandle,
			this.rosterExpiryHandle,
			this.healthPullHandle,
		]) {
			if (handle !== undefined) this.clock.clearTimeout(handle);
		}
		this.heartbeatHandle = undefined;
		this.rosterExpiryHandle = undefined;
		this.healthPullHandle = undefined;
		this.pendingAwareness = undefined;
	}

	private createFields(): Record<string, unknown> {
		const ports = new Map<string, unknown>();
		return new Proxy(
			{},
			{
				get: (_target, key) => {
					if (typeof key !== "string") return undefined;
					let port = ports.get(key);
					if (port) return port;
					const candidate = {
						text: Object.freeze({
							value: () => this.readText(this.requireField(key, "text")),
							apply: (operations: readonly CrdtTextOperation[]) =>
								this.mutateText(
									this.requireMutableField(key, "text"),
									operations,
								),
						}),
						anchors: Object.freeze({
							create: (input: CrdtTextAnchorInput) =>
								this.createTextAnchor(this.requireField(key, "text"), input),
							resolve: (token: string) =>
								this.resolveTextAnchor(this.requireField(key, "text"), token),
						}),
						set: Object.freeze({
							values: () => this.readSet(this.requireField(key, "set")),
							has: (value: string) =>
								this.readSet(this.requireField(key, "set")).includes(value),
							add: (value: string) =>
								this.mutateSet(this.requireMutableField(key, "set"), [
									{ type: "add", value },
								]),
							delete: (value: string) =>
								this.mutateSet(this.requireMutableField(key, "set"), [
									{ type: "delete", value },
								]),
							apply: (operations: readonly CrdtSetOperation<string>[]) =>
								this.mutateSet(
									this.requireMutableField(key, "set"),
									operations,
								),
						}),
					};
					Object.defineProperty(candidate, "format", {
						enumerable: true,
						get: () => this.fieldsByKey.get(key)?.contract.format,
					});
					port = Object.freeze(candidate);
					ports.set(key, port);
					return port;
				},
			},
		);
	}

	private requireField(
		key: string,
		format: CrdtClientManifestField["format"],
	): FieldRuntime {
		const field = this.fieldsByKey.get(key);
		if (!field) {
			throw new CrdtReadError(this.owner ? "FIELD_HIDDEN" : "NOT_READY");
		}
		if (field.contract.format !== format) {
			throw new CrdtReadError("FIELD_HIDDEN");
		}
		return field;
	}

	private requireMutableField(
		key: string,
		format: CrdtClientManifestField["format"],
	): FieldRuntime {
		const field = this.fieldsByKey.get(key);
		if (!field || field.contract.format !== format) {
			throw new CrdtMutationError(this.owner ? "FIELD_HIDDEN" : "NOT_READY");
		}
		return field;
	}

	private installManifest(owner: CrdtClientManifestOwner): void {
		this.authorizedGrants.clear();
		for (const field of Object.values(owner.fields)) {
			if (
				"grant" in field &&
				(field.grant === "view" || field.grant === "edit")
			) {
				this.authorizedGrants.set(field.fieldSlot, field.grant);
			}
		}
		const normalized = Object.freeze({
			schemaVersion: owner.schemaVersion,
			schemaFingerprint: owner.schemaFingerprint,
			awarenessEnabled: owner.awarenessEnabled,
			fields: Object.freeze(
				Object.fromEntries(
					Object.entries(owner.fields).map(([key, field]) => [
						key,
						Object.freeze({
							fieldSlot: field.fieldSlot,
							format: field.format,
							formatVersion: field.formatVersion,
							engineId: field.engineId,
						}),
					]),
				),
			),
		});
		if (!isValidManifestOwner(normalized)) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		if (
			Object.values(normalized.fields).some(
				(field) => field.format === "text",
			) &&
			(!this.textEngine ||
				!this.textEngine.relativePositions ||
				typeof this.textEngine.relativePositions.create !== "function" ||
				typeof this.textEngine.relativePositions.resolve !== "function" ||
				Object.values(normalized.fields).some(
					(field) =>
						field.format === "text" &&
						(field.engineId !== this.textEngine!.engineId ||
							field.formatVersion !== this.textEngine!.formatVersion),
				))
		) {
			throw new CrdtConnectError("CRDT_UNAVAILABLE");
		}
		const same =
			this.owner !== undefined &&
			canonicalPresenceJson(this.owner) === canonicalPresenceJson(normalized);
		if (same && this.fieldsByKey.size > 0) return;
		if (this.fieldsByKey.size > 0) this.purgeAllFields();
		this.fieldsByKey.clear();
		this.fieldsBySlot.clear();
		this.owner = normalized;
		for (const [key, contract] of Object.entries(normalized.fields)) {
			const field: FieldRuntime = {
				key,
				contract,
				hidden: false,
				syncing: false,
				chunks: [],
				chunkBytes: 0,
			};
			this.fieldsByKey.set(key, field);
			this.fieldsBySlot.set(contract.fieldSlot, field);
		}
	}

	private readText(field: FieldRuntime): string {
		this.assertReadable(field);
		return this.textEngine!.value(this.transactionReplica(field));
	}

	private readSet(field: FieldRuntime): readonly string[] {
		this.assertReadable(field);
		const replica = this.transactionReplica(field);
		if (!isClientSetReplica(replica)) {
			throw new CrdtReadError("NOT_READY");
		}
		return projectClientSetReplica(replica);
	}

	private createTextAnchor(
		field: FieldRuntime,
		anchor: CrdtTextAnchorInput,
	): CrdtTextAnchorToken {
		if (field.syncing || this.state.status === "synchronizing") {
			throw new CrdtAnchorError("UNACKNOWLEDGED_STATE");
		}
		this.assertReadable(field);
		if (
			this.activeTransaction !== undefined ||
			this.pending.some((bundle) =>
				bundle.parts.some(
					(part) => part.fieldSlot === field.contract.fieldSlot,
				),
			)
		) {
			throw new CrdtAnchorError("UNACKNOWLEDGED_STATE");
		}
		const binding = this.textAnchorBinding(field);
		const replica = field.replica!;
		try {
			return createCrdtTextAnchorToken({
				binding,
				replica,
				value: this.textEngine!.value(replica),
				anchor,
				relativePositions: this.textEngine!.relativePositions,
			});
		} catch {
			throw new CrdtAnchorError("INVALID_INPUT");
		}
	}

	private resolveTextAnchor(
		field: FieldRuntime,
		token: string,
	): CrdtTextAnchorResolution {
		this.assertReadable(field);
		const binding = this.textAnchorBinding(field);
		const replica = this.transactionReplica(field);
		return resolveCrdtTextAnchorToken({
			binding,
			replica,
			value: this.textEngine!.value(replica),
			token,
			relativePositions: this.textEngine!.relativePositions,
		});
	}

	private textAnchorBinding(field: FieldRuntime): CrdtTextAnchorBinding {
		if (
			!this.serverNamespace ||
			!this.incarnationKey ||
			field.fieldEpoch === undefined
		) {
			throw new CrdtReadError("NOT_READY");
		}
		return Object.freeze({
			namespace: this.serverNamespace,
			incarnationKey: this.incarnationKey,
			fieldSlot: field.contract.fieldSlot,
			fieldEpoch: field.fieldEpoch,
			engineId: field.contract.engineId,
			formatVersion: field.contract.formatVersion,
		});
	}

	private mutateText(
		field: FieldRuntime,
		operations: readonly CrdtTextOperation[],
	): void {
		this.assertMutable(field);
		validateTextOperations(operations);
		const transactionPart = this.transactionPart(field);
		let result: Readonly<{ replica: unknown; update: Uint8Array }>;
		try {
			result = this.textEngine!.apply(
				transactionPart?.replica ?? field.replica,
				operations,
			);
		} catch {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		if (
			!(result.update instanceof Uint8Array) ||
			result.update.byteLength === 0 ||
			result.update.byteLength > MAX_UPDATE_BYTES
		) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		this.assertTextReplicaWithinLimits(result.replica);
		if (transactionPart) {
			transactionPart.replica = result.replica;
			transactionPart.updates.push(new Uint8Array(result.update));
			return;
		}
		this.commitLocalBundle([
			{
				field,
				replica: result.replica,
				bytes: new Uint8Array(result.update),
			},
		]);
	}

	private mutateSet(
		field: FieldRuntime,
		operations: readonly CrdtSetOperation<string>[],
	): void {
		this.assertMutable(field);
		const transactionPart = this.transactionPart(field);
		const updateId = this.activeTransaction?.updateId ?? randomUpdateId();
		try {
			const result = applyClientSetOperations(
				(transactionPart?.replica ?? field.replica) as CrdtClientSetReplica,
				operations,
				this.activeTransaction?.dotPrefix ?? updateIdHex(updateId),
				this.activeTransaction?.dotCounter ?? 1,
			);
			if (this.activeTransaction) {
				this.activeTransaction.dotCounter = result.nextDot;
				transactionPart!.replica = result.replica;
				transactionPart!.updates.push(result.update);
				return;
			}
			this.commitLocalBundle(
				[{ field, replica: result.replica, bytes: result.update }],
				updateId,
			);
		} catch (error) {
			if (error instanceof CrdtMutationError) throw error;
			throw new CrdtMutationError("INVALID_OPERATION");
		}
	}

	private assertReadable(field: FieldRuntime): void {
		if (field.hidden) throw new CrdtReadError("FIELD_HIDDEN");
		if (
			field.replica === undefined ||
			field.grant === undefined ||
			(this.state.status !== "ready" &&
				this.state.status !== "offline" &&
				this.state.status !== "suspended")
		) {
			throw new CrdtReadError("NOT_READY");
		}
	}

	private assertMutable(field: FieldRuntime): void {
		if (this.freezeExpiredPending()) {
			throw new CrdtMutationError("NOT_READY");
		}
		if (field.hidden) throw new CrdtMutationError("FIELD_HIDDEN");
		if (
			field.replica === undefined ||
			field.grant === undefined ||
			field.syncing ||
			(this.state.status !== "ready" && this.state.status !== "offline")
		) {
			throw new CrdtMutationError("NOT_READY");
		}
		if (field.grant !== "edit") {
			throw new CrdtMutationError("FIELD_VIEW_ONLY");
		}
	}

	private freezeExpiredPending(): boolean {
		if (this.pending.length === 0) return false;
		const now = this.clock.now();
		const expired = this.pending.some(
			(bundle) =>
				bundle.createdAt > now ||
				now - bundle.createdAt > CRDT_OFFLINE_HORIZON_MS,
		);
		if (!expired) return false;
		this.enterRecovery(
			this.pending.some((bundle) => bundle.createdAt > now)
				? "local_store_corrupt"
				: "offline_horizon_expired",
		);
		return true;
	}

	private scheduleOfflineHorizon(): void {
		this.clearOfflineHorizonTimer();
		if (this.pending.length === 0 || this.closed) return;
		const oldest = Math.min(...this.pending.map((bundle) => bundle.createdAt));
		const delay = Math.min(
			0x7fff_ffff,
			Math.max(0, oldest + CRDT_OFFLINE_HORIZON_MS + 1 - this.clock.now()),
		);
		this.offlineHorizonHandle = this.clock.setTimeout(() => {
			this.offlineHorizonHandle = undefined;
			if (!this.freezeExpiredPending()) this.scheduleOfflineHorizon();
		}, delay);
	}

	private clearOfflineHorizonTimer(): void {
		if (this.offlineHorizonHandle === undefined) return;
		this.clock.clearTimeout(this.offlineHorizonHandle);
		this.offlineHorizonHandle = undefined;
	}

	private commitLocalBundle(
		staged: readonly {
			field: FieldRuntime;
			replica: unknown;
			bytes: Uint8Array;
		}[],
		updateId = randomUpdateId(),
	): void {
		if (staged.length === 0 || staged.length > 32) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		let wireBytes = 16 + 8 + 4 + 2;
		for (const part of staged) {
			if (
				!(part.bytes instanceof Uint8Array) ||
				part.bytes.byteLength === 0 ||
				part.bytes.byteLength > MAX_UPDATE_BYTES
			) {
				throw new CrdtMutationError("INVALID_OPERATION");
			}
			wireBytes += 2 + 8 + 2 + 8 + 4 + part.bytes.byteLength;
			if (wireBytes > MAX_BUNDLE_BYTES) {
				throw new CrdtMutationError("INVALID_OPERATION");
			}
		}
		const byteLength = staged.reduce(
			(total, part) => total + part.bytes.byteLength,
			0,
		);
		if (
			this.pending.length >= this.maximumPendingUpdates ||
			this.pendingBytes + byteLength > this.maximumPendingBytes
		) {
			this.enterRecovery("queue_limit");
			throw new CrdtMutationError("QUEUE_LIMIT");
		}
		const bundle: PendingBundle = {
			updateId,
			createdAt: this.clock.now(),
			aggregateEpoch: this.aggregateEpoch!,
			schemaVersion: this.schemaVersion!,
			parts: staged
				.map((part) => ({
					field: part.field,
					fieldSlot: part.field.contract.fieldSlot,
					fieldEpoch: part.field.fieldEpoch!,
					formatVersion: part.field.contract.formatVersion,
					baseFieldCursor: part.field.fieldCursor!,
					bytes: part.bytes,
				}))
				.sort((left, right) => left.fieldSlot - right.fieldSlot),
			byteLength,
			needsReconcile: false,
			submitting: false,
		};
		for (const part of staged) part.field.replica = part.replica;
		this.pending.push(bundle);
		this.pendingBytes += byteLength;
		this.scheduleOfflineHorizon();
		this.publishReplicaRevisions(staged.length);
		this.refreshReadableState();
		this.schedulePersist();
		if (this.state.status === "ready") {
			void this.sendBundle(bundle).catch((error) =>
				this.handleBackgroundError(error),
			);
		}
	}

	private assertTextReplicaWithinLimits(replica: unknown): void {
		let value: unknown;
		try {
			value = this.textEngine!.value(replica);
		} catch {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		if (
			typeof value !== "string" ||
			hasUnpairedSurrogate(value) ||
			new TextEncoder().encode(value).byteLength > MAX_TEXT_PROJECTION_BYTES
		) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
	}

	private sendBundle(
		bundle: PendingBundle,
		allowSynchronizing = false,
		signal = this.sessionAbort?.signal,
	): Promise<void> {
		if (
			bundle.submitting ||
			(this.state.status !== "ready" &&
				!(allowSynchronizing && this.state.status === "synchronizing")) ||
			this.aggregateEpoch === undefined ||
			this.schemaVersion === undefined
		) {
			return Promise.resolve();
		}
		bundle.submitting = true;
		const operation = this.appendChain
			.catch(() => {})
			.then(async () => {
				if (
					!this.pending.includes(bundle) ||
					(this.state.status !== "ready" &&
						!(allowSynchronizing && this.state.status === "synchronizing")) ||
					!this.opened
				) {
					return;
				}
				const response = await this.exchangeRequest(
					{
						major: 1,
						minor: 0,
						opcode: 0x02,
						requestId: randomUpdateId(),
						payload: {
							...this.sessionPayload(),
							updateId: bundle.updateId,
							aggregateEpoch: bundle.aggregateEpoch,
							schemaVersion: bundle.schemaVersion,
							parts: bundle.parts.map((part) => ({
								fieldSlot: part.fieldSlot,
								fieldEpoch: part.fieldEpoch,
								formatVersion: part.formatVersion,
								baseFieldCursor: part.baseFieldCursor,
								bytes: part.bytes,
							})),
						},
					},
					signal,
				);
				if (
					response.opcode !== 0x82 ||
					response.payload.aggregateEpoch !== bundle.aggregateEpoch ||
					!equalBytes(response.payload.updateId, bundle.updateId)
				) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
				await this.removePending([response.payload]);
			})
			.catch((error) => {
				bundle.needsReconcile = true;
				throw error;
			})
			.finally(() => {
				bundle.submitting = false;
			});
		this.appendChain = operation;
		return operation;
	}

	private async removePending(
		receipts: readonly Readonly<{
			updateId: Uint8Array;
			cursors: readonly { fieldSlot: number; fieldCursor: bigint }[];
		}>[],
	): Promise<boolean> {
		const removals = receipts.map((receipt) => {
			const index = this.pending.findIndex((bundle) =>
				equalBytes(bundle.updateId, receipt.updateId),
			);
			if (index < 0) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			const bundle = this.pending[index]!;
			this.assertReceiptCursors(bundle, receipt.cursors);
			return { index, bundle };
		});
		if (new Set(removals.map(({ index }) => index)).size !== removals.length) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		try {
			if (this.storageBindingKey && this.storage.ackPartitionBundles) {
				await this.storage.ackPartitionBundles({
					bindingKey: this.storageBindingKey,
					updateIds: removals.map(
						({ bundle }) => new Uint8Array(bundle.updateId),
					),
					acknowledgedAt: this.clock.now(),
				});
			} else if (this.storageBindingKey && this.storage.ackPartitionBundle) {
				for (const { bundle } of removals) {
					await this.storage.ackPartitionBundle({
						bindingKey: this.storageBindingKey,
						updateId: new Uint8Array(bundle.updateId),
						acknowledgedAt: this.clock.now(),
					});
				}
			}
		} catch {
			this.enterRecovery("local_store_corrupt");
			await this.disconnectTransport(1011, "CRDT durable ACK failed");
			return false;
		}
		for (const { index, bundle } of removals.sort(
			(left, right) => right.index - left.index,
		)) {
			this.pending.splice(index, 1);
			this.pendingBytes -= bundle.byteLength;
		}
		for (const receipt of receipts) {
			for (const cursor of receipt.cursors) {
				const field = this.fieldsBySlot.get(cursor.fieldSlot);
				if (field && cursor.fieldCursor > (field.fieldCursor ?? 0n)) {
					field.fieldCursor = cursor.fieldCursor;
				}
			}
		}
		this.scheduleOfflineHorizon();
		this.refreshReadableState();
		this.schedulePersist();
		return true;
	}

	private assertReceiptCursors(
		bundle: PendingBundle,
		cursors: readonly { fieldSlot: number; fieldCursor: bigint }[],
	): void {
		if (
			cursors.length !== bundle.parts.length ||
			cursors.some((cursor, cursorIndex) => {
				const part = bundle.parts[cursorIndex];
				return (
					!part ||
					(bundle.schemaVersion === this.schemaVersion &&
						cursor.fieldSlot !== part.fieldSlot) ||
					(bundle.schemaVersion === this.schemaVersion &&
						cursor.fieldCursor <= part.baseFieldCursor) ||
					(bundle.schemaVersion !== this.schemaVersion &&
						(cursor.fieldSlot < 1 ||
							cursor.fieldSlot > 0xffff ||
							cursor.fieldCursor < 1n))
				);
			})
		) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
	}

	private refreshReadableState(): void {
		if (this.state.status === "ready") {
			this.publishState(
				Object.freeze({
					status: "ready",
					fieldGrants: this.currentGrants(),
					fieldSyncing: Object.freeze(
						[...this.fieldsByKey.values()]
							.filter((field) => field.syncing)
							.map((field) => field.key),
					),
					pendingUpdates: this.pending.length,
				}),
			);
		} else if (this.state.status === "offline") {
			this.publishState(this.offlineState());
		}
	}

	private restore(field: FieldRuntime, snapshot: Uint8Array): unknown {
		if (field.contract.format === "text") {
			const engine = this.textEngine!;
			if (
				engine.engineId !== field.contract.engineId ||
				engine.formatVersion !== field.contract.formatVersion
			) {
				throw new CrdtConnectError("CRDT_UNAVAILABLE");
			}
			return engine.restore(snapshot);
		}
		if (
			field.contract.engineId !== "questpie.deterministic-add-wins-set/v1" ||
			field.contract.formatVersion !== 1
		) {
			throw new CrdtConnectError("CRDT_UNAVAILABLE");
		}
		try {
			return restoreClientSetReplica(snapshot);
		} catch {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
	}

	private transactionPart(field: FieldRuntime): TransactionPart | undefined {
		const transaction = this.activeTransaction;
		if (!transaction) return undefined;
		let part = transaction.parts.get(field);
		if (!part) {
			part = {
				field,
				replica: field.replica,
				updates: [],
			};
			transaction.parts.set(field, part);
		}
		return part;
	}

	private transactionReplica(field: FieldRuntime): unknown {
		return this.activeTransaction?.parts.get(field)?.replica ?? field.replica;
	}

	private hideField(field: FieldRuntime, publish = true): void {
		const hadReplica = field.replica !== undefined;
		field.replica = undefined;
		field.grant = undefined;
		field.fieldEpoch = undefined;
		field.fieldCursor = undefined;
		field.syncing = false;
		field.chunks = [];
		field.chunkBytes = 0;
		field.hidden = true;
		if (hadReplica && publish) this.publishReplicaRevision();
	}

	private purgeAllFields(): void {
		for (const field of this.fieldsBySlot.values()) this.hideField(field);
	}

	private hasReadableBasis(): boolean {
		return [...this.fieldsBySlot.values()].some(
			(field) => field.replica !== undefined && field.grant !== undefined,
		);
	}

	private currentGrants(): Readonly<Partial<Record<string, CrdtFieldGrant>>> {
		return Object.freeze(
			Object.fromEntries(
				[...this.fieldsByKey.values()]
					.filter((field) => field.grant !== undefined)
					.map((field) => [field.key, field.grant]),
			),
		);
	}

	private offlineState(): CrdtDocumentState<string> {
		return Object.freeze({
			status: "offline",
			fieldGrants: this.currentGrants(),
			pendingUpdates: this.pending.length,
		});
	}

	private isLocallyFrozen(): boolean {
		return (
			this.state.status === "suspended" ||
			this.state.status === "recovery-required"
		);
	}

	private publishState(state: CrdtDocumentState<string>): void {
		this.state = state;
		this.notifyStateListeners();
	}

	private publishReplicaRevision(): void {
		this.publishReplicaRevisions(1);
	}

	private publishReplicaRevisions(count: number): void {
		this.revision += count;
		this.notifyStateListeners();
	}

	private notifyStateListeners(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.state);
			} catch {
				// Observers cannot interrupt lifecycle or replica transitions.
			}
		}
	}

	private async disconnectTransport(
		_code = 1000,
		_reason = "CRDT client disconnected",
		preserveOpenId = false,
	): Promise<void> {
		this.stopEphemeralTimers();
		this.resetRoster();
		this.connectionAuthorityConfirmed = false;
		for (const bundle of this.pending) {
			bundle.submitting = false;
			bundle.needsReconcile = true;
		}
		const opened = this.opened;
		const sessionAbort = this.sessionAbort;
		const unregister = this.unregisterDirty;
		const edgeLease = this.edgeLease;
		const synchronizeAbort = this.synchronizeAbort;
		this.opened = undefined;
		this.topologyBoundOpened = undefined;
		this.sessionAbort = undefined;
		this.unregisterDirty = undefined;
		this.edgeLease = undefined;
		this.synchronizeAbort = undefined;
		if (!preserveOpenId) this.activeOpenId = undefined;
		sessionAbort?.abort();
		synchronizeAbort?.abort();
		unregister?.();
		edgeLease?.release();
		this.coordinator.release(this);
		if (opened) await this.closeOpenedSession(opened);
		if (this.state.status !== "recovery-required") {
			await this.persist().catch(() => {
				if (!this.closed) this.enterRecovery("local_store_corrupt");
			});
		}
	}

	private async closeOpenedSession(
		opened: CrdtClientOpenedSession,
	): Promise<void> {
		const closeAbort = new AbortController();
		const closeDeadline = globalThis.setTimeout(
			() => closeAbort.abort(),
			1_000,
		);
		try {
			const response = await this.exchange.exchange(
				{
					major: 1,
					minor: 0,
					opcode: 0x06,
					requestId: randomUpdateId(),
					payload: this.sessionPayload(opened),
				},
				closeAbort.signal,
			);
			if (response.opcode !== 0x86 && response.opcode !== 0xff) {
				throw new Error("CRDT close rejected");
			}
		} catch {
			// Durable lease expiry makes close best-effort.
		} finally {
			globalThis.clearTimeout(closeDeadline);
		}
	}
}

function connectCode(error: unknown): CrdtConnectError["code"] {
	if (error instanceof CrdtConnectError) return error.code;
	if (error instanceof CrdtHttpRecoveryError) return "CRDT_RECOVERY_REQUIRED";
	if (error instanceof CrdtHttpProtocolError) return "CRDT_PROTOCOL_REJECTED";
	if (
		error instanceof DOMException &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	) {
		return "CRDT_TRANSPORT_UNAVAILABLE";
	}
	return "CRDT_TRANSPORT_UNAVAILABLE";
}

function openedPolicyMatches(
	opened: CrdtClientOpenedSession,
	requested: { mode: RequestedMode; fallback?: "view" },
): boolean {
	const grants = Object.values(opened.manifest.fields).map(
		(field) => field.grant,
	);
	if (opened.effectiveMode === "view") {
		return (
			grants.every((grant) => grant === "view") &&
			(requested.mode === "view" || requested.fallback === "view")
		);
	}
	return requested.mode === "edit" && grants.some((grant) => grant === "edit");
}

function sameManifestContract(
	left: CrdtClientManifestOwner,
	right: CrdtClientManifestOwner,
): boolean {
	const project = (value: CrdtClientManifestOwner) => ({
		schemaVersion: value.schemaVersion,
		schemaFingerprint: value.schemaFingerprint,
		awarenessEnabled: value.awarenessEnabled,
		fields: Object.fromEntries(
			Object.entries(value.fields)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, field]) => [
					key,
					{
						fieldSlot: field.fieldSlot,
						format: field.format,
						formatVersion: field.formatVersion,
						engineId: field.engineId,
					},
				]),
		),
	});
	return JSON.stringify(project(left)) === JSON.stringify(project(right));
}

function samePullFields(
	left: readonly CrdtExchangePullFieldV1[],
	right: readonly CrdtExchangePullFieldV1[],
): boolean {
	return (
		left.length === right.length &&
		left.every((field, index) => {
			const candidate = right[index];
			return (
				candidate !== undefined &&
				field.fieldSlot === candidate.fieldSlot &&
				field.grant === candidate.grant &&
				field.fieldEpoch === candidate.fieldEpoch &&
				field.formatVersion === candidate.formatVersion &&
				field.fieldCursor === candidate.fieldCursor &&
				field.byteLength === candidate.byteLength &&
				equalBytes(field.digest, candidate.digest)
			);
		})
	);
}

async function pullArtifactDigest(
	fields: readonly CrdtExchangePullFieldV1[],
	snapshots: ReadonlyMap<number, Uint8Array>,
): Promise<Uint8Array> {
	const writer = new DigestWriter();
	writer.raw(new TextEncoder().encode("questpie-crdt-pull-artifact-v1\0"));
	for (const field of fields) {
		const bytes = snapshots.get(field.fieldSlot);
		if (!bytes) throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		writer.u16(field.fieldSlot);
		writer.u8(field.grant);
		writer.u64(field.fieldEpoch);
		writer.u16(field.formatVersion);
		writer.u64(field.fieldCursor);
		writer.u32(field.byteLength);
		writer.raw(field.digest);
		writer.raw(bytes);
	}
	return sha256(writer.finish());
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(
		await globalThis.crypto.subtle.digest(
			"SHA-256",
			value as Uint8Array<ArrayBuffer>,
		),
	);
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(signal.reason);
	return new Promise((resolve, reject) => {
		const timeout = globalThis.setTimeout(done, delayMs);
		const abort = () => {
			cleanup();
			reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
		};
		function cleanup() {
			globalThis.clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		}
		function done() {
			cleanup();
			resolve();
		}
		signal?.addEventListener("abort", abort, { once: true });
	});
}

function isAwarenessClear(value: unknown): boolean {
	return (
		isExactRecord(value, ["v", "kind"]) &&
		value.v === 1 &&
		value.kind === "awareness-clear"
	);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function validateTextOperations(
	operations: readonly CrdtTextOperation[],
): void {
	if (!Array.isArray(operations) || operations.length === 0) {
		throw new CrdtMutationError("INVALID_OPERATION");
	}
	for (const operation of operations) {
		if (
			!operation ||
			typeof operation !== "object" ||
			!Number.isSafeInteger(operation.index) ||
			operation.index < 0
		) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
		if (operation.type === "insert") {
			if (
				typeof operation.value !== "string" ||
				operation.value.length === 0 ||
				operation.value.includes("\0") ||
				hasUnpairedSurrogate(operation.value)
			) {
				throw new CrdtMutationError("INVALID_OPERATION");
			}
		} else if (
			operation.type !== "delete" ||
			!Number.isSafeInteger(operation.length) ||
			operation.length <= 0
		) {
			throw new CrdtMutationError("INVALID_OPERATION");
		}
	}
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(++index);
			if (next < 0xdc00 || next > 0xdfff) return true;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function randomUpdateId(): Uint8Array {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return bytes;
}

function updateIdHex(value: Uint8Array): string {
	return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isClientSetReplica(value: unknown): value is CrdtClientSetReplica {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as CrdtClientSetReplica).entries instanceof Map &&
		(value as CrdtClientSetReplica).activeDotOwners instanceof Map &&
		(value as CrdtClientSetReplica).removed instanceof Map
	);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index++) {
		difference |= left[index]! ^ right[index]!;
	}
	return difference === 0;
}

function isValidManifestOwner(
	owner: CrdtClientManifestOwner | undefined,
): boolean {
	if (
		!owner ||
		!Number.isSafeInteger(owner.schemaVersion) ||
		owner.schemaVersion < 0 ||
		owner.schemaVersion > 0xffff_ffff ||
		typeof owner.schemaFingerprint !== "string" ||
		owner.schemaFingerprint.length === 0 ||
		owner.schemaFingerprint.length > 128 ||
		typeof owner.awarenessEnabled !== "boolean"
	) {
		return false;
	}
	const fields = Object.entries(owner.fields);
	if (fields.length === 0 || fields.length > 32) return false;
	const slots = new Set<number>();
	for (const [key, field] of fields) {
		if (
			key.length === 0 ||
			!Number.isSafeInteger(field.fieldSlot) ||
			field.fieldSlot < 1 ||
			field.fieldSlot > 0xffff ||
			slots.has(field.fieldSlot) ||
			(field.format !== "text" && field.format !== "set") ||
			!Number.isSafeInteger(field.formatVersion) ||
			field.formatVersion < 0 ||
			field.formatVersion > 0xffff ||
			typeof field.engineId !== "string" ||
			field.engineId.length === 0 ||
			field.engineId.length > 256
		) {
			return false;
		}
		slots.add(field.fieldSlot);
	}
	return true;
}

function storageKey(parts: readonly string[]): string {
	return `questpie-crdt:v1:${encodeURIComponent(JSON.stringify(parts))}`;
}

function expectedStoredExactKey(document: PersistedDocument): string {
	return storageKey([
		"document",
		document.namespace,
		document.subject,
		document.incarnationKey,
		document.ownerKind,
		document.ownerKey,
		document.locator ?? "",
		document.schemaFingerprint,
		String(document.schemaVersion),
		document.aggregateEpoch,
		...document.fields.map((field) => `${field.fieldSlot}:${field.fieldEpoch}`),
	]);
}

function isPersistedBinding(value: unknown): value is PersistedBinding {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		(value as PersistedBinding).kind === "binding" &&
		typeof (value as PersistedBinding).exactKey === "string"
	);
}

function isPersistedDocument(value: unknown): value is PersistedDocument {
	if (
		!value ||
		typeof value !== "object" ||
		(value as PersistedDocument).kind !== "document"
	) {
		return false;
	}
	const document = value as PersistedDocument;
	if (
		typeof document.exactKey !== "string" ||
		typeof document.namespace !== "string" ||
		typeof document.subject !== "string" ||
		typeof document.incarnationKey !== "string" ||
		(document.ownerKind !== "collection" && document.ownerKind !== "global") ||
		typeof document.ownerKey !== "string" ||
		(document.locator !== undefined && typeof document.locator !== "string") ||
		typeof document.schemaFingerprint !== "string" ||
		!Number.isSafeInteger(document.schemaVersion) ||
		typeof document.aggregateEpoch !== "string" ||
		!Array.isArray(document.fields) ||
		!Array.isArray(document.pending) ||
		document.fields.length > 32 ||
		document.pending.length > MAX_RECEIPTS
	) {
		return false;
	}
	let snapshotBytes = 0;
	let previousFieldSlot = 0;
	for (const field of document.fields) {
		if (
			!field ||
			typeof field !== "object" ||
			!Number.isSafeInteger(field.fieldSlot) ||
			field.fieldSlot <= previousFieldSlot ||
			field.fieldSlot > 0xffff ||
			typeof field.fieldEpoch !== "string" ||
			typeof field.fieldCursor !== "string" ||
			(field.grant !== "view" && field.grant !== "edit") ||
			!(field.snapshot instanceof Uint8Array) ||
			field.snapshot.byteLength > MAX_FIELD_SNAPSHOT_BYTES
		) {
			return false;
		}
		previousFieldSlot = field.fieldSlot;
		snapshotBytes += field.snapshot.byteLength;
		if (snapshotBytes > MAX_AGGREGATE_SNAPSHOT_BYTES) return false;
	}
	let pendingBytes = 0;
	for (const bundle of document.pending) {
		if (
			!bundle ||
			typeof bundle !== "object" ||
			!(bundle.updateId instanceof Uint8Array) ||
			bundle.updateId.byteLength !== 16 ||
			!Number.isSafeInteger(bundle.createdAt) ||
			bundle.createdAt < 0 ||
			typeof bundle.aggregateEpoch !== "string" ||
			!Number.isSafeInteger(bundle.schemaVersion) ||
			bundle.schemaVersion < 0 ||
			bundle.schemaVersion > 0xffff_ffff ||
			!(bundle.submittedHash instanceof Uint8Array) ||
			bundle.submittedHash.byteLength !== 32 ||
			!Array.isArray(bundle.parts) ||
			bundle.parts.length === 0 ||
			bundle.parts.length > 32
		) {
			return false;
		}
		let bundleBytes = 16 + 8 + 4 + 2;
		let previousPartSlot = 0;
		for (const part of bundle.parts) {
			if (
				!part ||
				typeof part !== "object" ||
				!Number.isSafeInteger(part.fieldSlot) ||
				part.fieldSlot <= previousPartSlot ||
				part.fieldSlot > 0xffff ||
				typeof part.baseFieldCursor !== "string" ||
				typeof part.fieldEpoch !== "string" ||
				!Number.isSafeInteger(part.formatVersion) ||
				part.formatVersion < 0 ||
				part.formatVersion > 0xffff ||
				!(part.bytes instanceof Uint8Array) ||
				part.bytes.byteLength === 0 ||
				part.bytes.byteLength > MAX_UPDATE_BYTES
			) {
				return false;
			}
			previousPartSlot = part.fieldSlot;
			bundleBytes += 2 + 8 + 2 + 8 + 4 + part.bytes.byteLength;
			if (bundleBytes > MAX_BUNDLE_BYTES) return false;
		}
		pendingBytes += bundleBytes;
		if (pendingBytes > MAX_PENDING_BYTES) return false;
	}
	return true;
}

function parseStoredU64(value: string): bigint {
	if (!/^(0|[1-9][0-9]*)$/.test(value)) {
		throw new Error("invalid stored u64");
	}
	const parsed = BigInt(value);
	if (parsed < 0n || parsed > (1n << 64n) - 1n) {
		throw new Error("stored u64 exceeds range");
	}
	return parsed;
}

class DigestWriter {
	private readonly chunks: Uint8Array[] = [];

	u8(value: number): void {
		this.chunks.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.chunks.push(bytes);
	}

	u32(value: number): void {
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.chunks.push(bytes);
	}

	u64(value: bigint): void {
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value);
		this.chunks.push(bytes);
	}

	lengthPrefixed(value: Uint8Array): void {
		this.u32(value.byteLength);
		this.chunks.push(new Uint8Array(value));
	}

	raw(value: Uint8Array): void {
		this.chunks.push(new Uint8Array(value));
	}

	finish(): Uint8Array {
		return concatenate(this.chunks);
	}
}

function parseRosterPage(value: unknown): {
	generation: string;
	pageIndex: number;
	pageCount: number;
	participants: readonly unknown[];
} {
	if (
		!isExactRecord(value, [
			"v",
			"kind",
			"generation",
			"pageIndex",
			"pageCount",
			"participants",
		]) ||
		value.v !== 1 ||
		value.kind !== "roster-page" ||
		typeof value.generation !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.generation) ||
		!Number.isSafeInteger(value.pageIndex) ||
		!Number.isSafeInteger(value.pageCount) ||
		(value.pageIndex as number) < 0 ||
		(value.pageCount as number) < 1 ||
		(value.pageCount as number) > 16 ||
		(value.pageIndex as number) >= (value.pageCount as number) ||
		!Array.isArray(value.participants)
	) {
		throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
	}
	return {
		generation: value.generation,
		pageIndex: value.pageIndex as number,
		pageCount: value.pageCount as number,
		participants: value.participants,
	};
}

function isExactRecord(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return false;
	}
	const required = new Set(keys.filter((key) => !key.endsWith("?")));
	const permitted = new Set(keys.map((key) => key.replace(/\?$/, "")));
	const actual = Object.keys(value);
	return (
		actual.every((key) => permitted.has(key)) &&
		[...required].every((key) => Object.hasOwn(value, key))
	);
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
		value,
	);
}

function isCanonicalBase64Url(value: string, maxBytes = 258): boolean {
	if (
		value.length === 0 ||
		value.length > 344 ||
		value.length % 4 === 1 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		return false;
	}
	try {
		const padded =
			value.replace(/-/g, "+").replace(/_/g, "/") +
			"=".repeat((4 - (value.length % 4)) % 4);
		const decoded = atob(padded);
		if (decoded.length > maxBytes) return false;
		const canonical = btoa(decoded)
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		return canonical === value;
	} catch {
		return false;
	}
}

function isUtf16Boundary(value: string, offset: number): boolean {
	return !(
		offset > 0 &&
		offset < value.length &&
		value.charCodeAt(offset - 1) >= 0xd800 &&
		value.charCodeAt(offset - 1) <= 0xdbff &&
		value.charCodeAt(offset) >= 0xdc00 &&
		value.charCodeAt(offset) <= 0xdfff
	);
}

function snapshotAwarenessProfile(value: unknown): unknown {
	const canonical = canonicalJsonWithLimits(value, {
		maxDepth: 8,
		maxValues: 128,
	});
	if (new TextEncoder().encode(canonical).byteLength > 512) {
		throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
	}
	return JSON.parse(canonical);
}

function assertNoReservedAwarenessKeys(value: unknown): void {
	if (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		["activeField", "cursor", "selectionEnd"].some((key) =>
			Object.hasOwn(value, key),
		)
	) {
		throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
	}
}

function canonicalPresenceJson(value: unknown): string {
	return canonicalJsonWithLimits(value, {
		maxDepth: 16,
		maxValues: 2_048,
	});
}

function canonicalJsonWithLimits(
	value: unknown,
	limits: Readonly<{ maxDepth: number; maxValues: number }>,
): string {
	const ancestors = new Set<object>();
	let values = 0;
	const visit = (candidate: unknown, depth: number): string => {
		values++;
		if (values > limits.maxValues || depth > limits.maxDepth) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		if (
			candidate === null ||
			typeof candidate === "boolean" ||
			typeof candidate === "string"
		) {
			if (typeof candidate === "string" && hasUnpairedSurrogate(candidate)) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			return JSON.stringify(candidate);
		}
		if (typeof candidate === "number") {
			if (!Number.isFinite(candidate)) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			return JSON.stringify(candidate);
		}
		if (
			!candidate ||
			typeof candidate !== "object" ||
			ancestors.has(candidate)
		) {
			throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
		}
		ancestors.add(candidate);
		let result: string;
		if (Array.isArray(candidate)) {
			for (let index = 0; index < candidate.length; index++) {
				if (!Object.hasOwn(candidate, index)) {
					throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
				}
			}
			result = `[${candidate
				.map((entry) => visit(entry, depth + 1))
				.join(",")}]`;
		} else {
			if (Object.getPrototypeOf(candidate) !== Object.prototype) {
				throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
			}
			const object = candidate as Record<string, unknown>;
			result = `{${Object.keys(object)
				.sort()
				.map((key) => {
					if (hasUnpairedSurrogate(key) || object[key] === undefined) {
						throw new CrdtConnectError("CRDT_PROTOCOL_REJECTED");
					}
					return `${JSON.stringify(key)}:${visit(object[key], depth + 1)}`;
				})
				.join(",")}}`;
		}
		ancestors.delete(candidate);
		return result;
	};
	return visit(value, 0);
}

function encodeRecoveryArtifact(value: unknown): Uint8Array {
	const json = JSON.stringify(
		{
			format: "questpie-crdt-recovery-v1",
			value,
		},
		(_key, candidate: unknown) =>
			candidate instanceof Uint8Array
				? { $questpieBytes: base64Url(candidate) }
				: candidate,
	);
	return new TextEncoder().encode(`QUESTPIE_CRDT_RECOVERY_V1\u0000${json}`);
}

function base64Url(bytes: Uint8Array): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let output = "";
	for (let index = 0; index < bytes.byteLength; index += 3) {
		const first = bytes[index]!;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		output += alphabet[first >>> 2];
		output += alphabet[((first & 0x03) << 4) | ((second ?? 0) >>> 4)];
		if (second !== undefined) {
			output += alphabet[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)];
		}
		if (third !== undefined) output += alphabet[third & 0x3f];
	}
	return output;
}
