import { describe, expect, it } from "bun:test";

import {
	CRDT_OFFLINE_HORIZON_MS,
	CrdtConnectError,
	type CrdtClientClock,
	type CrdtClientPartitionCommitResult,
	type CrdtClientStorage,
	type CrdtClientStoredDocument,
	type CrdtClientStoredPartition,
} from "../../../src/client/crdt/types.js";
import { CrdtExchangeHarness } from "./http-harness.js";

describe("CRDT offline persistence and replay", () => {
	it("rehydrates speculative state, queries receipts, then serially replays", async () => {
		const storage = memoryStorage();
		const firstHarness = new CrdtExchangeHarness({
			fields: [{ key: "title", fieldSlot: 1, format: "text", value: "Hello" }],
			storage,
			autoAcknowledge: false,
		});
		const first = firstHarness.createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await waitUntil(
			() =>
				first.getSnapshot().status === "ready" &&
				first.getSnapshot().pendingUpdates === 1,
		);
		await first.disconnect();

		const secondHarness = new CrdtExchangeHarness({
			fields: [{ key: "title", fieldSlot: 1, format: "text", value: "Hello" }],
			storage,
		});
		const second = secondHarness.createDocument();
		await second.connect({ mode: "edit" });

		expect((second.fields.title as any).text.value()).toBe("Hello!");
		const exchangeOrder = secondHarness.sent.map((frame) => frame.opcode);
		expect(exchangeOrder.indexOf(0x03)).toBeGreaterThan(
			exchangeOrder.indexOf(0x01),
		);
		expect(exchangeOrder.indexOf(0x02)).toBeGreaterThan(
			exchangeOrder.indexOf(0x03),
		);
		await waitUntil(
			() =>
				second.getSnapshot().status === "ready" &&
				second.getSnapshot().pendingUpdates === 0,
		);
	});

	it("publishes ready only after receipt reconciliation and old replay, before accepting a new append", async () => {
		const storage = memoryStorage();
		const firstHarness = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
		});
		const first = firstHarness.createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await first.disconnect();

		const secondHarness = new CrdtExchangeHarness({ storage });
		const second = secondHarness.createDocument();
		let appendedFromReady = false;
		second.subscribe((state) => {
			if (state.status !== "ready" || appendedFromReady) return;
			appendedFromReady = true;
			(second.fields.title as any).text.apply([
				{ type: "insert", index: 6, value: "?" },
			]);
		});
		await second.connect({ mode: "edit" });
		await waitUntil(
			() =>
				appendedFromReady &&
				second.getSnapshot().status === "ready" &&
				second.getSnapshot().pendingUpdates === 0,
		);

		expect(secondHarness.sent.map((frame) => frame.opcode).slice(0, 4)).toEqual(
			[0x01, 0x03, 0x02, 0x02],
		);
		expect((second.fields.title as any).text.value()).toBe("Draft!?");
	});

	it("partitions durable bytes by server-issued subject and deployment", async () => {
		const storage = memoryStorage();
		const firstHarness = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
			offlineSubjectKey: "A".repeat(43),
			deploymentFingerprint: "deployment-a",
		});
		const first = firstHarness.createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: " secret" },
		]);
		await first.disconnect();

		const otherSubject = new CrdtExchangeHarness({
			storage,
			offlineSubjectKey: "B".repeat(43),
			deploymentFingerprint: "deployment-a",
		}).createDocument();
		await otherSubject.connect({ mode: "edit" });
		expect((otherSubject.fields.title as any).text.value()).toBe("Draft");
		expect(otherSubject.getSnapshot()).toMatchObject({ pendingUpdates: 0 });

		const otherDeployment = new CrdtExchangeHarness({
			storage,
			offlineSubjectKey: "A".repeat(43),
			deploymentFingerprint: "deployment-b",
		}).createDocument();
		await otherDeployment.connect({ mode: "edit" });
		expect((otherDeployment.fields.title as any).text.value()).toBe("Draft");
		expect(otherDeployment.getSnapshot()).toMatchObject({ pendingUpdates: 0 });
	});

	it("freezes pending work when the owner incarnation is retired", async () => {
		const storage = memoryStorage();
		const first = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
			incarnationKey: "00000000-0000-4000-8000-000000000030",
		}).createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await first.disconnect();

		const retired = new CrdtExchangeHarness({
			storage,
			incarnationKey: "00000000-0000-4000-8000-000000000031",
		}).createDocument();
		await expect(retired.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CRDT_RECOVERY_REQUIRED"),
		);
		expect(retired.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "owner_retired",
			pendingUpdates: 1,
		});
		const recovery = await retired.export();
		expect(recovery.byteLength).toBeGreaterThan(0);
		await retired.discard();
		expect(retired.getSnapshot()).toEqual({ status: "idle" });
	});

	it("freezes pending work beyond the 30-day offline horizon", async () => {
		const storage = memoryStorage();
		const first = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
			clock: staticClock(1_000),
		}).createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await first.disconnect();

		const expired = new CrdtExchangeHarness({
			storage,
			clock: staticClock(1_000 + CRDT_OFFLINE_HORIZON_MS + 1),
		}).createDocument();
		await expect(expired.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CRDT_RECOVERY_REQUIRED"),
		);
		expect(expired.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "offline_horizon_expired",
			pendingUpdates: 1,
		});
	});

	it("does not replay pending bytes after the field is downgraded to view", async () => {
		const storage = memoryStorage();
		const first = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
		}).createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await first.disconnect();

		const revokedHarness = new CrdtExchangeHarness({ storage });
		revokedHarness.openOverride = (_input, opened) =>
			({
				...opened,
				effectiveMode: "view",
				manifest: {
					...opened.manifest,
					fields: Object.fromEntries(
						Object.entries(opened.manifest.fields).map(([key, field]) => [
							key,
							{ ...field, grant: "view" },
						]),
					),
				},
			}) as typeof opened;
		const revoked = revokedHarness.createDocument();
		await expect(
			revoked.connect({ mode: "edit", fallback: "view" }),
		).rejects.toEqual(new CrdtConnectError("CRDT_RECOVERY_REQUIRED"));
		expect(revoked.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "pending_update_rejected",
			pendingUpdates: 1,
		});
		expect(revokedHarness.sent.some((frame) => frame.opcode === 0x02)).toBe(
			false,
		);
	});

	it("detects a corrupted persisted submitted hash before any replay", async () => {
		const storage = memoryStorage();
		const first = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
		}).createDocument();
		await first.connect({ mode: "edit" });
		(first.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await first.disconnect();
		const exactRecord = [...storage.records.values()].find(
			(record) => (record.value as { kind?: string }).kind === "document",
		);
		const pending = (
			exactRecord!.value as {
				pending: Array<{ submittedHash: Uint8Array }>;
			}
		).pending;
		pending[0]!.submittedHash[0] ^= 0xff;

		const corruptedHarness = new CrdtExchangeHarness({ storage });
		const corrupted = corruptedHarness.createDocument();
		await expect(corrupted.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CRDT_RECOVERY_REQUIRED"),
		);
		expect(corrupted.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "local_store_corrupt",
			pendingUpdates: 1,
		});
		expect(corruptedHarness.sent.some((frame) => frame.opcode === 0x02)).toBe(
			false,
		);
	});

	it("never adopts a newer purged partition generation while local pending bytes exist", async () => {
		const storage = partitionMemoryStorage();
		const harness = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		(document.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await waitUntil(() => document.getSnapshot().pendingUpdates === 1);
		await document.disconnect();
		await storage.purgeCurrent();

		await expect(document.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CRDT_RECOVERY_REQUIRED"),
		);
		expect(document.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "pending_update_rejected",
			pendingUpdates: 1,
		});
		expect(storage.current().document).toBeUndefined();
	});

	it("reloads the partition even when its exact key is unchanged so an external ACK cannot resurrect a bundle", async () => {
		const storage = partitionMemoryStorage();
		const harness = new CrdtExchangeHarness({
			storage,
			autoAcknowledge: false,
		});
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		(document.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await waitUntil(() => document.getSnapshot().pendingUpdates === 1);
		await document.disconnect();
		storage.dropPendingWithoutRevision();
		const appendCount = harness.sent.filter(
			(frame) => frame.opcode === 0x02,
		).length;

		await document.connect({ mode: "edit" });

		expect(document.getSnapshot()).toMatchObject({
			status: "ready",
			pendingUpdates: 0,
		});
		expect(harness.sent.filter((frame) => frame.opcode === 0x02)).toHaveLength(
			appendCount,
		);
		expect((document.fields.title as any).text.value()).toBe("Draft");
	});

	it("does not install a pull whose durable write completes after disconnect revokes the lifecycle", async () => {
		const storage = partitionMemoryStorage();
		const harness = new CrdtExchangeHarness({ storage });
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		const beforeRevision = document.replicaRevision;
		harness.setText(1, "Late durable value", 1n);
		const blockedCommit = storage.blockNextCommit();

		harness.dirty("visible");
		await blockedCommit.started;
		const disconnecting = document.disconnect();
		blockedCommit.release();
		await disconnecting;
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.getSnapshot().status).toBe("offline");
		expect(document.replicaRevision).toBe(beforeRevision);
		expect((document.fields.title as any).text.value()).toBe("Draft");
	});
});

function memoryStorage(): CrdtClientStorage & {
	records: Map<string, CrdtClientStoredDocument>;
} {
	const records = new Map<string, CrdtClientStoredDocument>();
	return {
		records,
		async load(key) {
			return records.get(key);
		},
		async save(key, value) {
			records.set(key, value);
		},
		async remove(key) {
			records.delete(key);
		},
	};
}

function partitionMemoryStorage(): CrdtClientStorage & {
	current(): CrdtClientStoredPartition;
	purgeCurrent(): Promise<void>;
	dropPendingWithoutRevision(): void;
	blockNextCommit(): { started: Promise<void>; release(): void };
} {
	let partition: CrdtClientStoredPartition = Object.freeze({
		revision: 0,
		generation: 0,
	});
	let commitGate:
		| {
				start(): void;
				wait: Promise<void>;
		  }
		| undefined;
	return {
		current: () => partition,
		async purgeCurrent() {
			partition = Object.freeze({
				revision: partition.revision + 1,
				generation: partition.generation + 1,
			});
		},
		dropPendingWithoutRevision() {
			if (!partition.document) throw new Error("missing partition document");
			const value = partition.document.value as Record<string, unknown>;
			partition = Object.freeze({
				...partition,
				document: Object.freeze({
					...partition.document,
					value: Object.freeze({ ...value, pending: Object.freeze([]) }),
				}),
			});
		},
		blockNextCommit() {
			let start!: () => void;
			let release!: () => void;
			const started = new Promise<void>((resolve) => {
				start = resolve;
			});
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			commitGate = { start, wait };
			return { started, release };
		},
		async load() {
			return undefined;
		},
		async save() {},
		async remove() {},
		async loadPartition() {
			return partition;
		},
		async commitPartition(input) {
			const gate = commitGate;
			if (gate) {
				commitGate = undefined;
				gate.start();
				await gate.wait;
			}
			if (input.expectedGeneration !== partition.generation) {
				return partitionCommit(partition, false, false);
			}
			if (input.expectedRevision !== partition.revision) {
				return partitionCommit(partition, false, true);
			}
			partition = Object.freeze({
				revision: partition.revision + 1,
				generation: partition.generation,
				document: input.document,
			});
			return partitionCommit(partition, true, true);
		},
		async purgePartition() {
			partition = Object.freeze({
				revision: partition.revision + 1,
				generation: partition.generation + 1,
			});
		},
	};
}

function partitionCommit(
	partition: CrdtClientStoredPartition,
	basisAccepted: boolean,
	bundlesAccepted: boolean,
): CrdtClientPartitionCommitResult {
	return Object.freeze({
		revision: partition.revision,
		generation: partition.generation,
		basisAccepted,
		bundlesAccepted,
	});
}

function staticClock(now: number): CrdtClientClock {
	return {
		now: () => now,
		setTimeout: () => 0,
		clearTimeout: () => undefined,
	};
}

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition not reached");
}
