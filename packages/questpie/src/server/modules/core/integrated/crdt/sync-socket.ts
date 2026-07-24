import {
	type CrdtFrameV1,
	CrdtProtocolMachineV1,
	decodeCrdtFrameV1,
	encodeCrdtFrameV1,
} from "#questpie/shared/crdt-protocol.js";

import type { CrdtAuthenticatedSocketV1 } from "./host-application.js";
import type { CrdtHostSocketPeerV1 } from "./host.js";
import type { CrdtDrainSession } from "./sync-coordinator.js";
import {
	createCrdtSyncSession,
	type CrdtSyncCommit,
	type CrdtSyncSource,
} from "./sync.js";

export interface CrdtSyncCoordinatorRegistration {
	register(session: CrdtDrainSession): () => void;
}

export async function createCrdtAuthenticatedSyncSocketV1(input: {
	sessionId: string;
	authRequestId: bigint;
	protocol: CrdtProtocolMachineV1;
	peer: CrdtHostSocketPeerV1;
	source: CrdtSyncSource;
	aggregateHash: string;
	coordinator?: CrdtSyncCoordinatorRegistration;
}): Promise<CrdtAuthenticatedSocketV1> {
	let serverSequence = 1n;
	let syncRequestId: bigint | undefined;
	let closed = false;
	let releaseCoordinator: (() => void) | undefined;
	let blocked:
		| {
				bytes: Uint8Array;
				resolve(): void;
				reject(error: unknown): void;
		  }
		| undefined;

	const sendBytes = async (bytes: Uint8Array): Promise<void> => {
		if (closed) throw rejected();
		if (blocked) throw rejected();
		if (input.peer.send(bytes)) return;
		await new Promise<void>((resolve, reject) => {
			blocked = { bytes, resolve, reject };
		});
	};

	const send = async (frame: CrdtFrameV1): Promise<void> => {
		input.protocol.accept("server-to-client", frame);
		await sendBytes(encodeCrdtFrameV1(frame));
	};

	const sync = createCrdtSyncSession({
		sessionId: input.sessionId,
		source: input.source,
		send: async (chunk) => {
			if (syncRequestId === undefined) throw rejected();
			await send({
				major: 1,
				minor: 0,
				opcode: 0x82,
				connectionSeq: serverSequence++,
				requestId: syncRequestId,
				payload: chunk,
			});
		},
		sendUpdate: async (commit) => {
			await sendUpdate(commit);
		},
		onReady: async (readyCut) => {
			if (syncRequestId === undefined) throw rejected();
			const cursors = new Map(
				readyCut.fields.map((field) => [field.fieldSlot, field.fieldCursor]),
			);
			await send({
				major: 1,
				minor: 0,
				opcode: 0x81,
				connectionSeq: serverSequence++,
				requestId: syncRequestId,
				payload: {
					aggregateEpoch: basis.aggregateEpoch,
					schemaVersion: basis.schemaVersion,
					grants: basis.fields.map((field) => ({
						fieldSlot: field.fieldSlot,
						grant: field.grant,
						fieldEpoch: field.fieldEpoch,
						headFieldCursor: cursors.get(field.fieldSlot) ?? field.fieldCursor,
					})),
				},
			});
		},
	});
	const basis = await sync.prepare();
	const terminate = async (code: number, reason: string) => {
		if (closed) return;
		closed = true;
		releaseCoordinator?.();
		releaseCoordinator = undefined;
		blocked?.reject(rejected());
		blocked = undefined;
		await sync.stop();
		input.peer.close(code, reason);
	};
	const authentication = send({
		major: 1,
		minor: 0,
		opcode: 0x89,
		connectionSeq: serverSequence++,
		requestId: input.authRequestId,
		payload: {
			aggregateEpoch: basis.aggregateEpoch,
			schemaVersion: basis.schemaVersion,
		},
	});
	// The downstream socket owns this promise even when no later client message
	// observes it (for example, close while the first send is backpressured).
	void authentication.catch(() => {});

	async function sendUpdate(commit: CrdtSyncCommit): Promise<void> {
		if (commit.commitId.byteLength !== 16) throw rejected();
		await send({
			major: 1,
			minor: 0,
			opcode: 0x83,
			connectionSeq: serverSequence++,
			requestId: 0n,
			payload: {
				commitId: commit.commitId,
				aggregateEpoch: basis.aggregateEpoch,
				parts: commit.fields.map((field) => {
					return {
						fieldSlot: field.fieldSlot,
						fieldEpoch: field.fieldEpoch,
						formatVersion: field.formatVersion,
						fieldCursor: field.fieldCursor,
						bytes: field.bytes,
					};
				}),
			},
		});
	}

	return Object.freeze({
		async message(data) {
			if (closed) throw rejected();
			await authentication;
			const frame = decodeCrdtFrameV1(data);
			input.protocol.accept("client-to-server", frame);
			if (frame.opcode === 0x02) {
				if (
					syncRequestId !== undefined ||
					frame.payload.schemaVersion !== basis.schemaVersion
				) {
					throw rejected();
				}
				syncRequestId = frame.requestId;
				releaseCoordinator = input.coordinator?.register({
					id: input.sessionId,
					aggregateHash: input.aggregateHash,
					reconcile: async (_reason, signal) => {
						const abort = () => {
							void terminate(1012, "CRDT synchronization stopped");
						};
						signal.addEventListener("abort", abort, { once: true });
						try {
							await sync.poll(signal);
							return { behind: sync.state !== "ready" };
						} catch (error) {
							await terminate(1012, "CRDT synchronization recovery required");
							throw error;
						} finally {
							signal.removeEventListener("abort", abort);
						}
					},
				});
				await sync.start(frame.payload.parts);
				return;
			}
			if (frame.opcode === 0x03) {
				await sync.ack(
					frame.payload.chunkIndex,
					frame.payload.fieldSlot,
					frame.payload.throughFieldCursor,
				);
				return;
			}
			throw rejected();
		},
		async drain() {
			const pending = blocked;
			if (!pending || closed) return;
			if (!input.peer.send(pending.bytes)) return;
			blocked = undefined;
			pending.resolve();
		},
		async close(code, reason) {
			await terminate(code, reason);
		},
	});
}

function rejected(): Error {
	return new Error("CRDT synchronized socket rejected");
}
