export type CrdtSyncAuthorityField = Readonly<{
	bindingId: string;
	fieldSlot: number;
	fieldEpoch: bigint;
	grant: 0 | 1;
	formatVersion: number;
	readFence: bigint;
	editFence: bigint;
	fieldCursor: bigint;
}>;

export type CrdtSyncAuthorityBasis = Readonly<{
	sessionId: string;
	bindingId?: string;
	sessionGeneration?: bigint;
	deliveryGeneration?: bigint;
	resourceId: string;
	resourceEpochId: string;
	schemaId: string;
	aggregateEpoch: bigint;
	schemaVersion: number;
	fields: readonly CrdtSyncAuthorityField[];
}>;

export type CrdtSyncSubmittedUpdate = Readonly<{
	updateId: Uint8Array;
	aggregateEpoch: bigint;
	schemaVersion: number;
	parts: readonly Readonly<{
		fieldSlot: number;
		fieldEpoch: bigint;
		formatVersion: number;
		baseFieldCursor: bigint;
		bytes: Uint8Array;
	}>[];
}>;

export type CrdtSyncReceiptQueryEntry = Readonly<{
	updateId: Uint8Array;
	submittedHash: Uint8Array;
	aggregateEpoch: bigint;
	schemaVersion: number;
}>;

export type CrdtSyncAppendReceipt = Readonly<{
	updateId: Uint8Array;
	cursors: readonly Readonly<{
		fieldSlot: number;
		fieldCursor: bigint;
	}>[];
}>;

/**
 * Private durable source used by the bounded Fetch exchange. It has no socket
 * state, push queue, transport affinity, or background process.
 */
export interface CrdtSyncSource {
	captureAuthorityBasis(sessionId: string): Promise<CrdtSyncAuthorityBasis>;
	submitUpdate?(
		basis: CrdtSyncAuthorityBasis,
		update: CrdtSyncSubmittedUpdate,
	): Promise<CrdtSyncAppendReceipt>;
	reconcileReceipts?(
		basis: CrdtSyncAuthorityBasis,
		entries: readonly CrdtSyncReceiptQueryEntry[],
	): Promise<readonly CrdtSyncAppendReceipt[]>;
}

export class CrdtSyncRecoveryRequiredError extends Error {
	readonly code = "CRDT_SYNC_RECOVERY_REQUIRED";

	constructor() {
		super("CRDT synchronization requires recovery");
		this.name = "CrdtSyncRecoveryRequiredError";
	}
}
