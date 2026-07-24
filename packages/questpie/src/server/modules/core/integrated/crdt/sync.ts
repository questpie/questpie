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
	fieldCursor: bigint;
	bytes: Uint8Array;
}>;

export type CrdtSyncBasis = Readonly<{
	sessionId?: string;
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
	kind?: 1;
	fields: readonly Omit<CrdtSyncField, "bindingId">[];
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
	verifyProof?(input: {
		field: CrdtSyncField;
		proof: Uint8Array;
	}): Promise<Uint8Array | null>;
	onBoundary?(boundary: SyncBoundary): void | Promise<void>;
	onReady?(cut: bigint): void | Promise<void>;
}>;

type QueuedFrame = CrdtSyncFrame & {
	readonly byteLength: number;
	readonly phase: "basis" | "drain";
	readonly cut: bigint;
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
	private readonly waiting: QueuedFrame[] = [];
	private nextChunkIndex = 0;
	private cursorRegistered = false;
	private advancing = false;
	private drainCutPending?: bigint;
	private readyDrain?: Promise<void>;

	constructor(private readonly input: CreateCrdtSyncSessionInput) {}

	async start(proofs: readonly CrdtSyncProof[]): Promise<void> {
		if (this.state !== "idle") throw rejected();
		this.state = "syncing";
		const basis = await this.input.source.captureBasis(this.input.sessionId);
		this.assertBasis(basis);
		this.basis = basis;
		this.cursor = basis.commitHead;
		await this.boundary("basis-captured");

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
				(this.input.verifyProof || this.input.source.verifyProof)
			) {
				try {
					bytes =
						(await (this.input.verifyProof
							? this.input.verifyProof({ field, proof: proof.proof })
							: this.input.source.verifyProof!(basis, {
									field,
									proof: proof.proof,
								}))) ?? field.bytes;
				} catch {
					bytes = field.bytes;
				}
			}
			totalBytes += bytes.byteLength;
			if (totalBytes > MAX_SYNC_BYTES) throw rejected();
			this.queueBytes(field, bytes, "basis", basis.commitHead);
		}
		if (this.waiting.length === 0) {
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
		this.waiting.length = 0;
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

	private queueBytes(
		field: Omit<CrdtSyncField, "bindingId">,
		bytes: Uint8Array,
		phase: "basis" | "drain",
		cut: bigint,
	): void {
		const chunks = Math.max(1, Math.ceil(bytes.byteLength / MAX_CHUNK_BYTES));
		for (let index = 0; index < chunks; index++) {
			const start = index * MAX_CHUNK_BYTES;
			const chunk = bytes.slice(
				start,
				Math.min(bytes.byteLength, start + MAX_CHUNK_BYTES),
			);
			this.waiting.push({
				chunkIndex: this.nextChunkIndex++,
				fieldSlot: field.fieldSlot,
				fieldEpoch: field.fieldEpoch,
				throughFieldCursor: field.fieldCursor,
				final: index === chunks - 1,
				bytes: chunk,
				byteLength: chunk.byteLength + ENCODED_SYNC_CHUNK_OVERHEAD,
				phase,
				cut,
			});
		}
	}

	private async pump(): Promise<void> {
		while (this.waiting.length > 0) {
			const frame = this.waiting[0]!;
			if (
				this.unacknowledgedBytes > 0 &&
				this.unacknowledgedBytes + frame.byteLength > MAX_UNACKNOWLEDGED_BYTES
			) {
				return;
			}
			if (
				frame.phase === "basis" &&
				this.waiting.every((candidate) => candidate.phase !== "basis")
			) {
				throw rejected();
			}
			const isFinalBasis = this.waiting.every(
				(candidate, index) => index === 0 || candidate.phase !== "basis",
			);
			if (frame.phase === "basis" && isFinalBasis) {
				await this.registerCursor();
			}
			this.waiting.shift();
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
			this.waiting.length > 0
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
				this.state = "ready";
				await this.input.onReady?.(this.cursor);
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
			if (this.waiting.length > 0) {
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
