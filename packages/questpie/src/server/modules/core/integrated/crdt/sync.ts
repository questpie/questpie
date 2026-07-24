const MAX_CHUNK_BYTES = 256 * 1024;
const MAX_SYNC_BYTES = 64 * 1024 * 1024;
const MAX_UNACKNOWLEDGED_BYTES = 4 * 1024 * 1024;
const ENCODED_SYNC_CHUNK_OVERHEAD = 59;

export type CrdtSyncProof = Readonly<{
	fieldSlot: number;
	fieldEpoch: bigint;
	proof: Uint8Array;
}>;

export type CrdtSyncField = Readonly<{
	bindingId: string;
	fieldSlot: number;
	fieldEpoch: bigint;
	grant: 0 | 1;
	formatVersion: number;
	readFence: bigint;
	editFence: bigint;
	fieldCursor: bigint;
	bytes: Uint8Array;
}>;

export type CrdtSyncBasis = Readonly<{
	sessionId: string;
	resourceId: string;
	resourceEpochId: string;
	schemaId: string;
	aggregateEpoch: bigint;
	schemaVersion: number;
	commitHead: bigint;
	fields: readonly CrdtSyncField[];
}>;

export type CrdtSyncCommit = Readonly<{
	commitSeq: bigint;
	kind: 1;
	commitId: Uint8Array;
	fields: readonly Pick<
		CrdtSyncField,
		"fieldSlot" | "fieldEpoch" | "formatVersion" | "fieldCursor" | "bytes"
	>[];
}>;

export type CrdtSyncFrame = Readonly<{
	chunkIndex: number;
	fieldSlot: number;
	fieldEpoch: bigint;
	throughFieldCursor: bigint;
	final: boolean;
	bytes: Uint8Array;
}>;

export interface CrdtSyncSource {
	captureBasis(sessionId: string): Promise<CrdtSyncBasis>;
	verifyProof?(
		basis: CrdtSyncBasis,
		input: { field: CrdtSyncField; proof: Uint8Array },
	): Promise<Uint8Array | null>;
	validateBasis?(basis: CrdtSyncBasis): Promise<void>;
	registerCursor(sessionId: string, cursor: bigint): Promise<void>;
	readHead(basis: CrdtSyncBasis): Promise<bigint>;
	readCommits(
		basis: CrdtSyncBasis,
		after: bigint,
		through: bigint,
	): Promise<readonly CrdtSyncCommit[]>;
}

export class CrdtSyncRejectedError extends Error {
	readonly code = "CRDT_SYNC_REJECTED";

	constructor() {
		super("CRDT synchronization rejected");
		this.name = "CrdtSyncRejectedError";
	}
}

export class CrdtSyncRecoveryRequiredError extends Error {
	readonly code = "CRDT_SYNC_RECOVERY_REQUIRED";

	constructor() {
		super("CRDT synchronization requires recovery");
		this.name = "CrdtSyncRecoveryRequiredError";
	}
}

type SyncBoundary =
	| "basis-captured"
	| "cursor-registered"
	| "basis-sent"
	| "ack"
	| "drain-read";

export type CreateCrdtSyncSessionInput = Readonly<{
	sessionId: string;
	source: CrdtSyncSource;
	send(frame: CrdtSyncFrame): void | Promise<void>;
	sendUpdate?(commit: CrdtSyncCommit): void | Promise<void>;
	onBoundary?(boundary: SyncBoundary): void | Promise<void>;
	onReady?(cut: bigint): void | Promise<void>;
}>;

type QueuedFrame = CrdtSyncFrame & {
	readonly byteLength: number;
	readonly phase: "basis" | "drain";
	readonly cut: bigint;
};

type ChunkPlan = {
	readonly field: Pick<
		CrdtSyncField,
		"fieldSlot" | "fieldEpoch" | "formatVersion" | "fieldCursor"
	>;
	readonly bytes: Uint8Array;
	readonly phase: "basis" | "drain";
	readonly cut: bigint;
	offset: number;
};

export function createCrdtSyncSession(input: CreateCrdtSyncSessionInput) {
	return new CrdtSyncSession(input);
}

class CrdtSyncSession {
	state: "idle" | "syncing" | "ready" | "stopped" = "idle";
	cursor = 0n;
	unacknowledgedBytes = 0;
	readonly pendingFrames: QueuedFrame[] = [];

	private basis?: CrdtSyncBasis;
	private readonly plans: ChunkPlan[] = [];
	private nextChunkIndex = 0;
	private cursorRegistered = false;
	private advancing = false;
	private drainCutPending?: bigint;
	private readyDrain?: Promise<void>;

	constructor(private readonly input: CreateCrdtSyncSessionInput) {}

	async prepare(): Promise<CrdtSyncBasis> {
		if (this.state !== "idle") throw rejected();
		if (!this.basis) {
			const basis = await this.input.source.captureBasis(this.input.sessionId);
			this.assertBasis(basis);
			this.basis = basis;
		}
		return this.basis;
	}

	async start(proofs: readonly CrdtSyncProof[]): Promise<void> {
		if (this.state !== "idle") throw rejected();
		this.state = "syncing";
		const basis =
			this.basis ??
			(await this.input.source.captureBasis(this.input.sessionId));
		this.assertBasis(basis);
		this.basis = basis;
		this.cursor = basis.commitHead;
		await this.boundary("basis-captured");

		this.assertProofs(proofs, basis);
		const proofsBySlot = new Map(
			proofs.map((proof) => [proof.fieldSlot, proof]),
		);
		let totalBytes = 0;
		for (const field of basis.fields) {
			let bytes = field.bytes;
			const proof = proofsBySlot.get(field.fieldSlot);
			if (
				proof &&
				proof.fieldEpoch === field.fieldEpoch &&
				this.input.source.verifyProof
			) {
				try {
					bytes =
						(await this.input.source.verifyProof(basis, {
							field,
							proof: proof.proof,
						})) ?? field.bytes;
				} catch {
					bytes = field.bytes;
				}
			}
			totalBytes += bytes.byteLength;
			if (totalBytes > MAX_SYNC_BYTES) throw rejected();
			this.queueBytes(field, bytes, "basis", basis.commitHead);
		}
		if (this.plans.length === 0) {
			await this.registerCursor();
			await this.finishBasis();
			return;
		}
		await this.pump();
	}

	async ack(
		chunkIndex: number,
		fieldSlot: number,
		throughFieldCursor: bigint,
	): Promise<void> {
		if (this.state !== "syncing") throw rejected();
		const frame = this.pendingFrames[0];
		if (
			!frame ||
			frame.chunkIndex !== chunkIndex ||
			frame.fieldSlot !== fieldSlot ||
			frame.throughFieldCursor !== throughFieldCursor
		) {
			throw rejected();
		}
		this.pendingFrames.shift();
		this.unacknowledgedBytes -= frame.byteLength;
		await this.boundary("ack");
		await this.pump();
		await this.advanceAfterAcknowledgement();
	}

	async poll(): Promise<void> {
		if (this.state === "stopped" || this.state === "idle") throw rejected();
		if (this.state === "ready") {
			if (!this.readyDrain) {
				this.readyDrain = this.drainReady().finally(() => {
					this.readyDrain = undefined;
				});
			}
			await this.readyDrain;
			return;
		}
		await this.advanceAfterAcknowledgement();
	}

	async stop(): Promise<void> {
		if (this.state === "stopped") return;
		this.state = "stopped";
		this.plans.length = 0;
		this.pendingFrames.length = 0;
		this.unacknowledgedBytes = 0;
	}

	private assertBasis(basis: CrdtSyncBasis): void {
		if (
			basis.commitHead < 0n ||
			basis.fields.length > 32 ||
			new Set(basis.fields.map((field) => field.fieldSlot)).size !==
				basis.fields.length
		) {
			throw rejected();
		}
		for (const field of basis.fields) {
			if (
				field.fieldSlot < 1 ||
				field.fieldSlot > 0xffff ||
				field.fieldEpoch < 0n ||
				field.fieldCursor < 0n ||
				!(field.bytes instanceof Uint8Array)
			) {
				throw rejected();
			}
		}
	}

	private assertProofs(
		proofs: readonly CrdtSyncProof[],
		basis: CrdtSyncBasis,
	): void {
		if (proofs.length > 32) throw rejected();
		const known = new Set(basis.fields.map((field) => field.fieldSlot));
		let previous = -1;
		for (const proof of proofs) {
			if (
				!known.has(proof.fieldSlot) ||
				proof.fieldSlot <= previous ||
				proof.fieldEpoch < 0n ||
				!(proof.proof instanceof Uint8Array) ||
				proof.proof.byteLength > 64 * 1024
			) {
				throw rejected();
			}
			previous = proof.fieldSlot;
		}
	}

	private queueBytes(
		field: Pick<
			CrdtSyncField,
			"fieldSlot" | "fieldEpoch" | "formatVersion" | "fieldCursor"
		>,
		bytes: Uint8Array,
		phase: "basis" | "drain",
		cut: bigint,
	): void {
		this.plans.push({ field, bytes, phase, cut, offset: 0 });
	}

	private async pump(): Promise<void> {
		while (this.plans.length > 0) {
			const plan = this.plans[0]!;
			const end = Math.min(
				plan.bytes.byteLength,
				plan.offset + MAX_CHUNK_BYTES,
			);
			const chunk = plan.bytes.subarray(plan.offset, end);
			const final = end === plan.bytes.byteLength;
			const frame: QueuedFrame = {
				chunkIndex: this.nextChunkIndex,
				fieldSlot: plan.field.fieldSlot,
				fieldEpoch: plan.field.fieldEpoch,
				throughFieldCursor: plan.field.fieldCursor,
				final,
				bytes: chunk,
				byteLength: chunk.byteLength + ENCODED_SYNC_CHUNK_OVERHEAD,
				phase: plan.phase,
				cut: plan.cut,
			};
			if (
				this.unacknowledgedBytes > 0 &&
				this.unacknowledgedBytes + frame.byteLength > MAX_UNACKNOWLEDGED_BYTES
			) {
				return;
			}
			const isFinalBasis =
				final &&
				this.plans.every(
					(candidate, index) => index === 0 || candidate.phase !== "basis",
				);
			if (frame.phase === "basis" && isFinalBasis) {
				await this.registerCursor();
			}
			await this.input.source.validateBasis?.(this.basis!);
			this.nextChunkIndex++;
			if (final) {
				this.plans.shift();
			} else {
				plan.offset = end;
			}
			this.pendingFrames.push(frame);
			this.unacknowledgedBytes += frame.byteLength;
			await this.input.send(frame);
		}
	}

	private async registerCursor(): Promise<void> {
		if (this.cursorRegistered) return;
		await this.input.source.registerCursor(this.input.sessionId, this.cursor);
		this.cursorRegistered = true;
		await this.boundary("cursor-registered");
	}

	private async advanceAfterAcknowledgement(): Promise<void> {
		if (
			this.advancing ||
			this.state !== "syncing" ||
			this.pendingFrames.length > 0 ||
			this.plans.length > 0
		) {
			return;
		}
		this.advancing = true;
		try {
			await this.finishBasis();
		} finally {
			this.advancing = false;
		}
	}

	private async finishBasis(): Promise<void> {
		const basis = this.basis;
		if (!basis || !this.cursorRegistered) throw rejected();
		if (this.drainCutPending !== undefined) {
			await this.input.source.registerCursor(
				this.input.sessionId,
				this.drainCutPending,
			);
			this.cursor = this.drainCutPending;
			this.drainCutPending = undefined;
		}
		await this.boundary("basis-sent");
		while (this.state === "syncing") {
			const head = await this.input.source.readHead(basis);
			if (head < this.cursor) throw rejected();
			await this.boundary("drain-read");
			if (head === this.cursor) {
				await this.input.onReady?.(this.cursor);
				if (this.state !== "syncing") throw rejected();
				this.state = "ready";
				return;
			}
			const commits = await this.input.source.readCommits(
				basis,
				this.cursor,
				head,
			);
			this.assertCommits(commits, head);
			for (const commit of commits) {
				for (const field of commit.fields) {
					this.queueBytes(field, field.bytes, "drain", head);
				}
			}
			if (this.plans.length > 0) {
				this.drainCutPending = head;
				await this.pump();
				return;
			}
			this.cursor = head;
		}
	}

	private assertCommits(
		commits: readonly CrdtSyncCommit[],
		head: bigint,
	): void {
		let previous = this.cursor;
		for (const commit of commits) {
			if (commit.commitSeq !== previous + 1n || commit.commitSeq > head) {
				throw rejected();
			}
			previous = commit.commitSeq;
		}
		if (previous !== head) throw rejected();
	}

	private async drainReady(): Promise<void> {
		const basis = this.basis;
		if (!basis || this.state !== "ready") throw rejected();
		const head = await this.input.source.readHead(basis);
		if (head < this.cursor) throw rejected();
		if (head === this.cursor) return;
		const commits = await this.input.source.readCommits(
			basis,
			this.cursor,
			head,
		);
		this.assertCommits(commits, head);
		for (const commit of commits) {
			if (this.state !== "ready") throw rejected();
			if (commit.fields.length > 0) {
				if (!this.input.sendUpdate) throw rejected();
				await this.input.sendUpdate(commit);
			}
			if (this.state !== "ready") throw rejected();
			await this.input.source.registerCursor(
				this.input.sessionId,
				commit.commitSeq,
			);
			this.cursor = commit.commitSeq;
		}
	}

	private async boundary(boundary: SyncBoundary): Promise<void> {
		await this.input.onBoundary?.(boundary);
	}
}

function rejected(): CrdtSyncRejectedError {
	return new CrdtSyncRejectedError();
}
