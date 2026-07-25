import type {
	CrdtExchangeRequestFrameV1,
	CrdtExchangeResponseFrameV1,
} from "#questpie/shared/crdt-exchange.js";

import type { CrdtTextOperation } from "../../server/modules/core/integrated/crdt/types.js";

export type CrdtMutationErrorCode =
	| "NOT_READY"
	| "FIELD_HIDDEN"
	| "FIELD_VIEW_ONLY"
	| "INVALID_OPERATION"
	| "QUEUE_LIMIT"
	| "NESTED_TRANSACTION"
	| "ASYNC_TRANSACTION";

export class CrdtMutationError extends Error {
	constructor(public readonly code: CrdtMutationErrorCode) {
		super(`CRDT mutation rejected: ${code}`);
		this.name = "CrdtMutationError";
	}
}

export type CrdtReadErrorCode = "NOT_READY" | "FIELD_HIDDEN";

export class CrdtReadError extends Error {
	constructor(public readonly code: CrdtReadErrorCode) {
		super(`CRDT read rejected: ${code}`);
		this.name = "CrdtReadError";
	}
}

export type CrdtConnectErrorCode =
	| "CLOSED"
	| "CRDT_UNAVAILABLE"
	| "CRDT_EDIT_NOT_ALLOWED"
	| "CRDT_PROTOCOL_REJECTED"
	| "CRDT_RATE_LIMITED"
	| "CRDT_RECOVERY_REQUIRED"
	| "CRDT_TRANSPORT_UNAVAILABLE";

export class CrdtConnectError extends Error {
	constructor(public readonly code: CrdtConnectErrorCode) {
		super(`CRDT connection rejected: ${code}`);
		this.name = "CrdtConnectError";
	}
}

export type CrdtClientManifestField = Readonly<{
	fieldSlot: number;
	format: "text" | "set";
	formatVersion: number;
	engineId: string;
}>;

export type CrdtClientManifestOwner = Readonly<{
	schemaVersion: number;
	schemaFingerprint: string;
	awarenessEnabled: boolean;
	fields: Readonly<Record<string, CrdtClientManifestField>>;
}>;

export type CrdtClientManifest = Readonly<{
	collections: Readonly<Record<string, CrdtClientManifestOwner>>;
	globals: Readonly<Record<string, CrdtClientManifestOwner>>;
}>;

export type CrdtClientAuthorizedManifestOwner = Readonly<{
	schemaVersion: number;
	schemaFingerprint: string;
	awarenessEnabled: boolean;
	fields: Readonly<
		Record<
			string,
			CrdtClientManifestField & Readonly<{ grant: "view" | "edit" }>
		>
	>;
}>;

export interface CrdtClientTextEngine<TReplica = unknown> {
	readonly engineId: string;
	readonly formatVersion: number;
	restore(snapshot: Uint8Array): TReplica;
	snapshot(replica: TReplica): Uint8Array;
	proof(replica: TReplica): Uint8Array;
	value(replica: TReplica): string;
	apply(
		replica: TReplica,
		operations: readonly CrdtTextOperation[],
	): Readonly<{ replica: TReplica; update: Uint8Array }>;
	applyUpdate(replica: TReplica, update: Uint8Array): TReplica;
	mergeUpdates(updates: readonly Uint8Array[]): Uint8Array;
	toRelativePosition?(replica: TReplica, offset: number): string;
	fromRelativePosition?(
		replica: TReplica,
		position: string,
	): number | undefined;
}

export type CrdtClientStoredDocument = Readonly<{
	version: 1;
	updatedAt: number;
	value: unknown;
}>;

export type CrdtClientStoredPartition = Readonly<{
	revision: number;
	generation: number;
	document?: CrdtClientStoredDocument;
}>;

export type CrdtClientPartitionCommitResult = Readonly<{
	revision: number;
	generation: number;
	basisAccepted: boolean;
	bundlesAccepted: boolean;
}>;

export interface CrdtClientStorage {
	load(key: string): Promise<CrdtClientStoredDocument | undefined>;
	save(key: string, value: CrdtClientStoredDocument): Promise<void>;
	remove(key: string): Promise<void>;
	loadPartition?(
		bindingKey: string,
		now: number,
	): Promise<CrdtClientStoredPartition>;
	commitPartition?(input: {
		bindingKey: string;
		exactKey: string;
		document: CrdtClientStoredDocument;
		now: number;
		expectedRevision: number;
		expectedGeneration: number;
	}): Promise<CrdtClientPartitionCommitResult>;
	ackPartitionBundle?(input: {
		bindingKey: string;
		updateId: Uint8Array;
		acknowledgedAt: number;
	}): Promise<void>;
	ackPartitionBundles?(input: {
		bindingKey: string;
		updateIds: readonly Uint8Array[];
		acknowledgedAt: number;
	}): Promise<void>;
	purgePartition?(bindingKey: string): Promise<void>;
}

export type CrdtClientOpenedSession = Readonly<{
	protocol: "questpie-crdt-http";
	version: 1;
	namespace: string;
	deploymentFingerprint: string;
	bindingId: string;
	bindingIdBytes: Uint8Array;
	sessionGeneration: bigint;
	deliveryGeneration: bigint;
	leaseExpiresAt: string;
	incarnationKey: string;
	effectiveMode: "view" | "edit";
	offlineSubjectKey: string;
	manifest: CrdtClientAuthorizedManifestOwner;
}>;

/** @internal Typed Fetch-only CRDT transport used by the document runtime. */
export interface CrdtClientExchangePort {
	open(input: {
		openId: string;
		replacesBindingId?: string;
		owner:
			| { kind: "collection"; key: string; id: string | number }
			| { kind: "global"; key: string };
		mode: "view" | "edit";
		fallback?: "view";
		edgeSessionId: string;
		edgeToken: string;
		signal?: AbortSignal;
	}): Promise<CrdtClientOpenedSession>;
	exchange(
		frame: CrdtExchangeRequestFrameV1,
		signal?: AbortSignal,
	): Promise<CrdtExchangeResponseFrameV1>;
}

/** @internal Capability borrowed from the one client-wide realtime session. */
export interface CrdtClientRealtimeEdgeLease {
	readonly sessionId: string;
	readonly token: string;
	registerCrdt(input: {
		id: string;
		bindingId: string;
		onDirty(lane: "visible" | "awareness"): void;
		onError(error: Error): void;
	}): void | (() => void) | Promise<void | (() => void)>;
	release(): void;
}

/** @internal Narrow seam; it is not part of the public client configuration. */
export interface CrdtClientRealtimeSessionPort {
	acquireEdgeCapability(
		signal?: AbortSignal,
	): Promise<CrdtClientRealtimeEdgeLease>;
}

export interface CrdtClientClock {
	now(): number;
	setTimeout(callback: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export type CrdtClientRuntimeConfig = Readonly<{
	engines?: Readonly<{ text: CrdtClientTextEngine }>;
	storage?: CrdtClientStorage;
	clock?: CrdtClientClock;
	maxPendingUpdates?: number;
	maxPendingBytes?: number;
}>;

export const CRDT_OFFLINE_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export type CrdtClientHostConfig = Readonly<{
	baseURL: string;
	basePath: string;
	fetcher: typeof fetch;
	defaultHeaders?: Readonly<Record<string, string>>;
	getAuthHeaders?: () =>
		| Record<string, string>
		| undefined
		| Promise<Record<string, string> | undefined>;
	runtime?: CrdtClientRuntimeConfig;
	/** @internal */
	realtimeSession?: CrdtClientRealtimeSessionPort;
	/** @internal Test/deep-module injection; never exposed by QuestpieClientConfig. */
	exchange?: CrdtClientExchangePort;
}>;
