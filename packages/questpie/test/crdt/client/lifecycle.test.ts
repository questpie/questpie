import { describe, expect, it } from "bun:test";

import {
	CrdtConnectError,
	CrdtMutationError,
	CrdtReadError,
	type CrdtClientStorage,
} from "../../../src/client/crdt/types.js";
import { createClient } from "../../../src/client/index.js";
import { CrdtExchangeHarness, testTextEngine } from "./http-harness.js";

describe("CRDT client lifecycle over shared realtime", () => {
	it("constructs an inert SSR-safe handle and fails closed before connect", () => {
		let storageCalls = 0;
		let fetchCalls = 0;
		const storage: CrdtClientStorage = {
			load: async () => {
				storageCalls++;
				return undefined;
			},
			save: async () => {
				storageCalls++;
			},
			remove: async () => {
				storageCalls++;
			},
		};
		const client = createClient<any>({
			baseURL: "https://api.example.com",
			fetch: (async () => {
				fetchCalls++;
				return new Response();
			}) as typeof fetch,
			crdt: {
				storage,
				engines: { text: testTextEngine() },
			},
		});
		const document = client.crdt.collections.articles.document({
			id: "article-1",
		});

		expect(document.getSnapshot()).toEqual({ status: "idle" });
		expect(document.replicaRevision).toBe(0);
		expect(storageCalls).toBe(0);
		expect(fetchCalls).toBe(0);
		expect(() => document.fields.title.text.value()).toThrow(
			new CrdtReadError("NOT_READY"),
		);
		expect(() =>
			document.fields.title.text.apply([
				{ type: "insert", index: 0, value: "x" },
			]),
		).toThrow(new CrdtMutationError("NOT_READY"));
		expect(storageCalls).toBe(0);
		expect(fetchCalls).toBe(0);
	});

	it("rejects duplicate manifest field slots before topology registration", async () => {
		const harness = new CrdtExchangeHarness({
			fields: [{ key: "title", fieldSlot: 1, format: "text", value: "Draft" }],
		});
		harness.openOverride = (_input, opened) =>
			({
				...opened,
				manifest: {
					...opened.manifest,
					fields: {
						title: opened.manifest.fields.title!,
						content: {
							...opened.manifest.fields.title!,
							grant: "edit",
						},
					},
				},
			}) as typeof opened;
		const document = harness.createDocument();

		await expect(document.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CRDT_PROTOCOL_REJECTED"),
		);
		expect(harness.registrations).toHaveLength(0);
		expect(document.getSnapshot()).toEqual({
			status: "failed",
			code: "CRDT_PROTOCOL_REJECTED",
			retryable: false,
		});
	});

	it("fails before open when offline queue limits are invalid", async () => {
		const harness = new CrdtExchangeHarness({
			maxPendingBytes: Number.POSITIVE_INFINITY,
		});
		const document = harness.createDocument();

		await expect(document.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CRDT_UNAVAILABLE"),
		);
		expect(harness.opened).toHaveLength(0);
		expect(document.getSnapshot()).toEqual({
			status: "denied",
			code: "CRDT_UNAVAILABLE",
		});
	});

	it("shares concurrent connects, reference-counts disconnect, and closes terminally", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();

		await Promise.all([
			document.connect({ mode: "edit" }),
			document.connect({ mode: "edit" }),
		]);
		expect(harness.opened).toHaveLength(1);
		expect(harness.registrations).toHaveLength(1);

		await document.disconnect();
		expect(document.getSnapshot().status).toBe("ready");
		expect(harness.registrations).toHaveLength(1);
		await document.disconnect();
		expect(document.getSnapshot().status).toBe("offline");
		expect(harness.registrations).toHaveLength(0);
		expect(harness.sent.some((frame) => frame.opcode === 0x06)).toBe(true);

		await document.close();
		expect(document.getSnapshot()).toEqual({ status: "closed" });
		await expect(document.connect({ mode: "edit" })).rejects.toEqual(
			new CrdtConnectError("CLOSED"),
		);
	});

	it("isolates throwing observers and rejects oversized speculative updates", async () => {
		const base = testTextEngine();
		const harness = new CrdtExchangeHarness({
			textEngine: {
				...base,
				apply: (replica, operations) => ({
					replica: base.apply(replica, operations).replica,
					update: new Uint8Array(256 * 1024 + 1),
				}),
			},
		});
		const document = harness.createDocument();
		let healthyNotifications = 0;
		document.subscribe(() => {
			throw new Error("observer failure");
		});
		document.subscribe(() => {
			healthyNotifications++;
		});
		await document.connect({ mode: "edit" });
		const before = document.replicaRevision;

		expect(() =>
			(document.fields.title as any).text.apply([
				{ type: "insert", index: 5, value: "!" },
			]),
		).toThrow(new CrdtMutationError("INVALID_OPERATION"));
		expect((document.fields.title as any).text.value()).toBe("Draft");
		expect(document.replicaRevision).toBe(before);
		expect(healthyNotifications).toBeGreaterThan(0);
	});

	it("enforces the server-issued effective mode and explicit fallback", async () => {
		const forged = new CrdtExchangeHarness();
		forged.openOverride = (_input, opened) =>
			({
				...opened,
				effectiveMode: "edit",
				manifest: forged.manifest,
			}) as typeof opened;
		await expect(
			forged.createDocument().connect({ mode: "view" }),
		).rejects.toEqual(new CrdtConnectError("CRDT_PROTOCOL_REJECTED"));

		const fallback = new CrdtExchangeHarness();
		fallback.openOverride = (_input, opened) =>
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
		const fallbackDocument = fallback.createDocument();
		await fallbackDocument.connect({ mode: "edit", fallback: "view" });
		expect(fallbackDocument.getSnapshot()).toMatchObject({
			status: "ready",
			fieldGrants: { title: "view" },
		});
		expect(() =>
			(fallbackDocument.fields.title as any).text.apply([
				{ type: "insert", index: 0, value: "x" },
			]),
		).toThrow(new CrdtMutationError("FIELD_VIEW_ONLY"));
	});

	it("refreshes authority after a recovery frame and rebinds exact topology", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		let recoverOnce = true;
		harness.responseOverride = (request, response) => {
			if (recoverOnce && request.opcode === 0x01) {
				recoverOnce = false;
				return {
					major: 1,
					minor: 0,
					opcode: 0xff,
					requestId: request.requestId,
					payload: { action: 1 },
				};
			}
			return response;
		};

		harness.dirty("visible");
		await waitUntil(() => harness.opened.length === 2);
		await waitUntil(() => document.getSnapshot().status === "ready");

		expect(harness.releasedRegistrations).toHaveLength(1);
		expect(harness.registrations).toHaveLength(1);
		expect(harness.opened[1]?.openId).not.toBe(harness.opened[0]?.openId);
		expect(harness.sent.filter((frame) => frame.opcode === 0x06)).toHaveLength(
			1,
		);
	});

	it("uses atomic replacement across rapid authority refreshes when close responses are lost", async () => {
		const harness = new CrdtExchangeHarness();
		const logicalOpenIds = new Set<string>();
		const activeBindings = new Set<string>();
		harness.openOverride = (input, opened) => {
			if (input.replacesBindingId) {
				activeBindings.delete(input.replacesBindingId);
			}
			if (activeBindings.size >= 5) {
				throw new CrdtConnectError("CRDT_UNAVAILABLE");
			}
			logicalOpenIds.add(input.openId);
			activeBindings.add(opened.bindingId);
			return opened;
		};
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });

		for (let refresh = 0; refresh < 6; refresh++) {
			let invalidateOnce = true;
			harness.responseOverride = (request, response) => {
				if (request.opcode === 0x06) {
					throw new DOMException("close response lost", "TimeoutError");
				}
				if (invalidateOnce && request.opcode === 0x01) {
					invalidateOnce = false;
					return {
						major: 1,
						minor: 0,
						opcode: 0xff,
						requestId: request.requestId,
						payload: { action: 1 },
					};
				}
				return response;
			};

			harness.dirty("visible");
			await waitUntil(() => harness.opened.length === refresh + 2);
			await waitUntil(() => document.getSnapshot().status === "ready");
		}

		expect(logicalOpenIds.size).toBe(7);
		expect(harness.sent.filter((frame) => frame.opcode === 0x06)).toHaveLength(
			6,
		);
		expect(activeBindings.size).toBe(1);
		expect(harness.registrations).toHaveLength(1);
	});

	it("uses a fresh logical open to adopt a changed authority cut", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		const initialOpenId = harness.opened[0]!.openId;
		harness.openOverride = (input, opened) => {
			if (input.openId === initialOpenId) {
				throw new CrdtConnectError("CRDT_UNAVAILABLE");
			}
			return {
				...opened,
				offlineSubjectKey: "B".repeat(43),
			};
		};

		harness.failRealtime();
		await waitUntil(() => harness.opened.length === 2);
		await waitUntil(() => document.getSnapshot().status === "ready");

		expect(harness.opened[1]?.openId).not.toBe(initialOpenId);
		expect(harness.sent.filter((frame) => frame.opcode === 0x06)).toHaveLength(
			1,
		);
	});

	it("keeps one logical openId when connect is retried after an ambiguous failure", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		let failOnce = true;
		harness.openOverride = async (_input, opened) => {
			if (failOnce) {
				failOnce = false;
				throw new DOMException("response lost", "TimeoutError");
			}
			return opened;
		};

		await expect(document.connect({ mode: "edit" })).rejects.toBeInstanceOf(
			CrdtConnectError,
		);
		await document.connect({ mode: "edit" });

		expect(harness.opened).toHaveLength(2);
		expect(harness.opened[1]?.openId).toBe(harness.opened[0]?.openId);
	});

	it("retires an in-flight pull before synchronizing a refreshed binding", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		let releasePull!: () => void;
		const pullGate = new Promise<void>((resolve) => {
			releasePull = resolve;
		});
		let blockOnce = true;
		harness.responseOverride = async (request, response, signal) => {
			if (blockOnce && request.opcode === 0x01) {
				blockOnce = false;
				await Promise.race([
					pullGate,
					new Promise<never>((_resolve, reject) => {
						const abort = () =>
							reject(signal?.reason ?? new Error("pull aborted"));
						if (signal?.aborted) abort();
						else signal?.addEventListener("abort", abort, { once: true });
					}),
				]);
			}
			return response;
		};

		harness.dirty("visible");
		await waitUntil(
			() => harness.sent.filter((frame) => frame.opcode === 0x01).length === 2,
		);
		harness.failRealtime();
		await waitUntil(() => harness.opened.length === 2);
		await waitUntil(() => document.getSnapshot().status === "ready");
		releasePull();

		expect(document.getSnapshot().status).toBe("ready");
		expect(harness.registrations).toHaveLength(1);
		expect(harness.opened[1]?.openId).not.toBe(harness.opened[0]?.openId);
		expect(harness.sent.filter((frame) => frame.opcode === 0x06)).toHaveLength(
			1,
		);
	});

	it("never falls back to readable or editable offline state after explicit authority invalidation", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		let recoverOnce = true;
		harness.responseOverride = (request, response) => {
			if (recoverOnce && request.opcode === 0x01) {
				recoverOnce = false;
				return {
					major: 1,
					minor: 0,
					opcode: 0xff,
					requestId: request.requestId,
					payload: { action: 1 },
				};
			}
			return response;
		};
		harness.openOverride = async () => {
			throw new CrdtConnectError("CRDT_UNAVAILABLE");
		};

		harness.dirty("visible");
		await waitUntil(() => document.getSnapshot().status === "denied");

		expect(document.getSnapshot()).toEqual({
			status: "denied",
			code: "CRDT_UNAVAILABLE",
		});
		expect(() => (document.fields.title as any).text.value()).toThrow(
			new CrdtReadError("NOT_READY"),
		);
		expect(() =>
			(document.fields.title as any).text.apply([
				{ type: "insert", index: 0, value: "x" },
			]),
		).toThrow(new CrdtMutationError("NOT_READY"));
	});

	it("does not let disconnect turn an in-flight explicit invalidation into editable offline state", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		let recoverOnce = true;
		harness.responseOverride = (request, response) => {
			if (recoverOnce && request.opcode === 0x01) {
				recoverOnce = false;
				return {
					major: 1,
					minor: 0,
					opcode: 0xff,
					requestId: request.requestId,
					payload: { action: 1 },
				};
			}
			return response;
		};
		let rejectRefresh: ((error: Error) => void) | undefined;
		harness.openOverride = (_input, opened) =>
			new Promise<typeof opened>((_resolve, reject) => {
				rejectRefresh = reject;
			});

		harness.dirty("visible");
		await waitUntil(() => harness.opened.length === 2);
		await document.disconnect();

		expect(document.getSnapshot()).toEqual({ status: "idle" });
		expect(() => (document.fields.title as any).text.value()).toThrow(
			new CrdtReadError("NOT_READY"),
		);
		expect(() =>
			(document.fields.title as any).text.apply([
				{ type: "insert", index: 0, value: "x" },
			]),
		).toThrow(new CrdtMutationError("NOT_READY"));
		rejectRefresh!(new Error("refresh cancelled"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(document.getSnapshot()).toEqual({ status: "idle" });
	});

	it("cannot adopt a refreshed subject after disconnect wins a delayed storage purge", async () => {
		let startPurge!: () => void;
		let releasePurge!: () => void;
		const purgeStarted = new Promise<void>((resolve) => {
			startPurge = resolve;
		});
		const purgeGate = new Promise<void>((resolve) => {
			releasePurge = resolve;
		});
		const storage: CrdtClientStorage = {
			async load() {
				return undefined;
			},
			async save() {},
			async remove() {},
			async purgePartition() {
				startPurge();
				await purgeGate;
			},
		};
		const harness = new CrdtExchangeHarness({ storage });
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		let recoverOnce = true;
		harness.responseOverride = (request, response) => {
			if (recoverOnce && request.opcode === 0x01) {
				recoverOnce = false;
				return {
					major: 1,
					minor: 0,
					opcode: 0xff,
					requestId: request.requestId,
					payload: { action: 1 },
				};
			}
			return response;
		};
		harness.openOverride = (_input, opened) => ({
			...opened,
			offlineSubjectKey: "B".repeat(43),
		});

		harness.dirty("visible");
		await purgeStarted;
		const disconnecting = document.disconnect();
		releasePurge();
		await disconnecting;
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.getSnapshot()).toEqual({ status: "idle" });
		expect(harness.registrations).toHaveLength(0);
		expect(() => (document.fields.title as any).text.value()).toThrow(
			new CrdtReadError("NOT_READY"),
		);
	});

	it("cannot publish ready from a refreshed HTTP session whose exact realtime registration failed", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		harness.registrationOverride = (_input, sequence) => {
			if (sequence === 2) throw new Error("exact registration rejected");
		};
		let recoverOnce = true;
		harness.responseOverride = (request, response) => {
			if (recoverOnce && request.opcode === 0x01) {
				recoverOnce = false;
				return {
					major: 1,
					minor: 0,
					opcode: 0xff,
					requestId: request.requestId,
					payload: { action: 1 },
				};
			}
			return response;
		};

		harness.dirty("visible");
		await waitUntil(() => harness.opened.length === 2);
		await waitUntil(() => document.getSnapshot().status === "failed");
		harness.dirty("visible");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.getSnapshot()).toMatchObject({
			status: "failed",
			code: "CRDT_TRANSPORT_UNAVAILABLE",
		});
		expect(harness.registrations).toHaveLength(1);
		expect(harness.sent.filter((frame) => frame.opcode === 0x06)).toHaveLength(
			1,
		);
	});

	it("closes a distinct refreshed candidate when topology registration fails", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		const candidateBinding = new Uint8Array(16).fill(0x21);
		harness.openOverride = (_input, opened) => ({
			...opened,
			bindingId: "21212121-2121-4121-a121-212121212121",
			bindingIdBytes: candidateBinding,
		});
		harness.registrationOverride = (_input, sequence) => {
			if (sequence === 2) throw new Error("exact registration rejected");
		};

		harness.failRealtime();
		await waitUntil(() => document.getSnapshot().status === "failed");

		const closes = harness.sent.filter((frame) => frame.opcode === 0x06);
		expect(closes).toHaveLength(1);
		expect(closes[0]?.payload.bindingId).toEqual(candidateBinding);
	});

	it("freezes pending bytes instead of replaying them across a refreshed subject identity", async () => {
		const harness = new CrdtExchangeHarness({ autoAcknowledge: false });
		const document = harness.createDocument();
		await document.connect({ mode: "edit" });
		(document.fields.title as any).text.apply([
			{ type: "insert", index: 5, value: "!" },
		]);
		await waitUntil(
			() => harness.sent.filter((frame) => frame.opcode === 0x02).length === 1,
		);
		let recoverOnce = true;
		harness.responseOverride = (request, response) => {
			if (recoverOnce && request.opcode === 0x01) {
				recoverOnce = false;
				return {
					major: 1,
					minor: 0,
					opcode: 0xff,
					requestId: request.requestId,
					payload: { action: 1 },
				};
			}
			return response;
		};
		harness.openOverride = (_input, opened) => ({
			...opened,
			offlineSubjectKey: "B".repeat(43),
		});

		harness.dirty("visible");
		await waitUntil(
			() => document.getSnapshot().status === "recovery-required",
		);

		expect(document.getSnapshot()).toEqual({
			status: "recovery-required",
			reason: "pending_update_rejected",
			pendingUpdates: 1,
		});
		expect(harness.sent.filter((frame) => frame.opcode === 0x02)).toHaveLength(
			1,
		);
	});

	it("rejects a pull that elevates a view-only open manifest to edit", async () => {
		const harness = new CrdtExchangeHarness();
		harness.responseOverride = (request, response) => {
			if (request.opcode !== 0x01 || response.opcode !== 0x81) {
				return response;
			}
			return {
				...response,
				payload: {
					...response.payload,
					fields: response.payload.fields.map((field) => ({
						...field,
						grant: 1 as const,
					})),
				},
			};
		};

		await expect(
			harness.createDocument().connect({ mode: "view" }),
		).rejects.toEqual(new CrdtConnectError("CRDT_PROTOCOL_REJECTED"));
	});

	it("does not install a late pull after disconnect has revoked the local lifecycle", async () => {
		const harness = new CrdtExchangeHarness();
		const document = harness.createDocument();
		await document.connect({ mode: "view" });
		harness.setText(1, "Late remote value", 1n);
		let releasePull: (() => void) | undefined;
		const pullGate = new Promise<void>((resolve) => {
			releasePull = resolve;
		});
		harness.responseOverride = async (request, response) => {
			if (request.opcode === 0x01) await pullGate;
			return response;
		};
		const beforeRevision = document.replicaRevision;

		harness.dirty("visible");
		await waitUntil(
			() => harness.sent.filter((frame) => frame.opcode === 0x01).length === 2,
		);
		await document.disconnect();
		releasePull!();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.getSnapshot().status).toBe("offline");
		expect(document.replicaRevision).toBe(beforeRevision);
		expect((document.fields.title as any).text.value()).toBe("Draft");
	});
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
	throw new Error("condition not reached");
}
