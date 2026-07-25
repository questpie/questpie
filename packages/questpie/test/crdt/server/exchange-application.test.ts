import { describe, expect, test } from "bun:test";

import { createCrdtExchangeApplicationV1 } from "../../../src/server/modules/core/integrated/crdt/exchange-application.js";
import {
	CRDT_EXCHANGE_V1_CONTENT_TYPE,
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
} from "../../../src/shared/crdt-exchange.js";

const REQUEST_ID = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const BINDING_ID = Uint8Array.from({ length: 16 }, (_, index) => 0xf0 - index);
const CLAIM = {
	sessionId: "00000000-0000-4000-8000-000000000001",
	bindingId: "f0efeeed-eceb-eae9-e8e7-e6e5e4e3e2e1",
	resourceId: "00000000-0000-4000-8000-000000000002",
	requestedMode: "view" as const,
	effectiveMode: "view" as const,
	sessionGeneration: 7n,
	deliveryGeneration: 3n,
};

describe("CRDT Fetch exchange application", () => {
	test("rejects compression, false length, overrun and malformed codec before callbacks", async () => {
		let callbacks = 0;
		const application = createApplication({
			onCallback() {
				callbacks++;
			},
		});
		const valid = heartbeatBytes();
		const malformed = Uint8Array.from([...valid, 0]);
		const requests = [
			request(valid, { "content-encoding": "gzip" }),
			request(valid, { "content-length": String(valid.byteLength - 1) }),
			request(valid, { "content-length": String(valid.byteLength + 1) }),
			request(malformed),
		];

		for (const candidate of requests) {
			const response = await application.handle(candidate);
			expect(response.status).toBe(404);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
		expect(callbacks).toBe(0);
	});

	test("reauthenticates and validates both generations before heartbeat mutation", async () => {
		const calls: string[] = [];
		const application = createApplication({
			onInspect(input) {
				expect(input).toEqual({
					bindingId: CLAIM.bindingId,
					sessionGeneration: 7n,
					deliveryGeneration: 3n,
					allowClosed: false,
				});
				calls.push("inspect");
			},
			onAuthenticate() {
				calls.push("authenticate");
			},
			onAuthorize(input) {
				expect(input.purpose).toBe("exchange");
				calls.push("authorize");
			},
			onValidate() {
				calls.push("validate");
			},
			onHeartbeat() {
				calls.push("heartbeat");
			},
		});

		const response = await application.handle(request(heartbeatBytes()));
		expect(calls).toEqual([
			"authenticate",
			"inspect",
			"authorize",
			"validate",
			"heartbeat",
		]);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			CRDT_EXCHANGE_V1_CONTENT_TYPE,
		);
		expect(response.headers.has("content-encoding")).toBeFalse();
		const decoded = decodeCrdtExchangeFrameV1(
			new Uint8Array(await response.arrayBuffer()),
		);
		expect(decoded).toEqual({
			major: 1,
			minor: 0,
			opcode: 0x85,
			requestId: REQUEST_ID,
			payload: { serverTimeMs: 1234n },
		});
	});

	test("returns one closed binary recovery shape after a decoded authority failure", async () => {
		const application = createApplication({
			onValidate() {
				throw new Error("private reason");
			},
		});

		const response = await application.handle(request(heartbeatBytes()));
		expect(response.status).toBe(404);
		expect(
			decodeCrdtExchangeFrameV1(new Uint8Array(await response.arrayBuffer())),
		).toEqual({
			major: 1,
			minor: 0,
			opcode: 0xff,
			requestId: REQUEST_ID,
			payload: { action: 1 },
		});
	});

	test("does not disclose a saturated exchange gate before fresh authentication", async () => {
		let startHeartbeat!: () => void;
		let finishHeartbeat!: () => void;
		const heartbeatStarted = new Promise<void>(
			(resolve) => (startHeartbeat = resolve),
		);
		const heartbeatFinished = new Promise<void>(
			(resolve) => (finishHeartbeat = resolve),
		);
		const application = createApplication({
			maximumConcurrentRequests: 1,
			authenticateBrowser(request) {
				return request.headers.has("authorization")
					? null
					: ({
							kind: "user",
							user: { id: "user-1" },
							session: { id: "session-1" },
						} as any);
			},
			async onHeartbeat() {
				startHeartbeat();
				await heartbeatFinished;
			},
		});
		const authorized = application.handle(request(heartbeatBytes()));
		await heartbeatStarted;

		const denied = await application.handle(
			request(heartbeatBytes(), { authorization: "Bearer denied" }),
		);

		expect(denied.status).toBe(404);
		expect(
			decodeCrdtExchangeFrameV1(new Uint8Array(await denied.arrayBuffer())),
		).toEqual({
			major: 1,
			minor: 0,
			opcode: 0xff,
			requestId: REQUEST_ID,
			payload: { action: 1 },
		});
		finishHeartbeat();
		expect((await authorized).status).toBe(200);
	});

	test("bounds stalled request bodies before authentication and releases admission on abort", async () => {
		let callbacks = 0;
		const application = createApplication({
			maximumConcurrentRequests: 1,
			onCallback() {
				callbacks++;
			},
		});
		const controller = new AbortController();
		const stalled = application.handle(stalledRequest(controller.signal));
		await new Promise((resolve) => setTimeout(resolve, 0));

		const rejected = await application.handle(request(heartbeatBytes()));

		expect(rejected.status).toBe(404);
		expect(rejected.headers.get("content-type")).toContain("application/json");
		expect(callbacks).toBe(0);
		controller.abort();
		expect((await stalled).status).toBe(404);
	});

	test("propagates request abort into pull execution and settles promptly", async () => {
		let observedSignal: AbortSignal | undefined;
		let pullStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			pullStarted = resolve;
		});
		const application = createApplication({
			onPull(input) {
				observedSignal = input.signal;
				pullStarted();
				return new Promise((_resolve, reject) => {
					const abort = () => reject(input.signal?.reason ?? new Error());
					if (input.signal?.aborted) abort();
					else input.signal?.addEventListener("abort", abort, { once: true });
				});
			},
		});
		const controller = new AbortController();
		const operation = application.handle(
			request(pullBytes(), {}, controller.signal),
		);
		await started;

		controller.abort(new DOMException("client left", "AbortError"));

		expect(observedSignal?.aborted).toBeTrue();
		const response = await Promise.race([
			operation,
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("pull did not abort")), 100),
			),
		]);
		expect(response.status).toBe(404);
	});

	test("copies fragmented bodies immediately and ignores empty stream chunks", async () => {
		const response = await createApplication({}).handle(
			fragmentedRequest(heartbeatBytes()),
		);

		expect(response.status).toBe(200);
		expect(
			decodeCrdtExchangeFrameV1(new Uint8Array(await response.arrayBuffer())),
		).toMatchObject({
			opcode: 0x85,
			requestId: REQUEST_ID,
		});
	});

	test("appends from lightweight session authority without materializing a sync basis", async () => {
		let fullBasisCaptures = 0;
		let authorityBasisCaptures = 0;
		const application = createApplication({
			mode: "edit",
			onCaptureBasis() {
				fullBasisCaptures++;
				throw new Error("full CRDT materialization must not run");
			},
			onCaptureAuthorityBasis() {
				authorityBasisCaptures++;
				return authorityBasis("edit");
			},
			onSubmitUpdate(_basis, update) {
				return {
					updateId: update.updateId,
					cursors: [{ fieldSlot: 1, fieldCursor: 1n }],
				};
			},
		});

		const response = await application.handle(request(appendBytes()));

		expect(response.status).toBe(200);
		expect(fullBasisCaptures).toBe(0);
		expect(authorityBasisCaptures).toBe(1);
		expect(
			decodeCrdtExchangeFrameV1(new Uint8Array(await response.arrayBuffer())),
		).toEqual({
			major: 1,
			minor: 0,
			opcode: 0x82,
			requestId: REQUEST_ID,
			payload: {
				updateId: REQUEST_ID,
				aggregateEpoch: 9n,
				cursors: [{ fieldSlot: 1, fieldCursor: 1n }],
			},
		});
	});

	test("reconciles receipts from lightweight session authority without materializing a sync basis", async () => {
		let fullBasisCaptures = 0;
		let authorityBasisCaptures = 0;
		const application = createApplication({
			onCaptureBasis() {
				fullBasisCaptures++;
				throw new Error("full CRDT materialization must not run");
			},
			onCaptureAuthorityBasis() {
				authorityBasisCaptures++;
				return authorityBasis("view");
			},
			onReconcileReceipts() {
				return [
					{
						updateId: REQUEST_ID,
						cursors: [{ fieldSlot: 1, fieldCursor: 1n }],
					},
				];
			},
		});

		const response = await application.handle(request(receiptBytes()));

		expect(response.status).toBe(200);
		expect(fullBasisCaptures).toBe(0);
		expect(authorityBasisCaptures).toBe(1);
		expect(
			decodeCrdtExchangeFrameV1(new Uint8Array(await response.arrayBuffer())),
		).toEqual({
			major: 1,
			minor: 0,
			opcode: 0x83,
			requestId: REQUEST_ID,
			payload: {
				receipts: [
					{
						updateId: REQUEST_ID,
						aggregateEpoch: 9n,
						cursors: [{ fieldSlot: 1, fieldCursor: 1n }],
					},
				],
			},
		});
	});
});

function createApplication(hooks: {
	mode?: "view" | "edit";
	maximumConcurrentRequests?: number;
	authenticateBrowser?(request: Request): any;
	onCallback?(): void;
	onInspect?(input: unknown): void;
	onAuthenticate?(): void;
	onAuthorize?(input: { purpose: string }): void;
	onValidate?(): void;
	onHeartbeat?(): void | Promise<void>;
	onPull?(input: any): Promise<any>;
	onCaptureBasis?(): unknown;
	onCaptureAuthorityBasis?(): unknown;
	onSubmitUpdate?(
		basis: any,
		update: any,
	): {
		updateId: Uint8Array;
		cursors: Array<{ fieldSlot: number; fieldCursor: bigint }>;
	};
	onReconcileReceipts?(): Array<{
		updateId: Uint8Array;
		cursors: Array<{ fieldSlot: number; fieldCursor: bigint }>;
	}>;
}) {
	const callback = <T>(value: T): T => {
		hooks.onCallback?.();
		return value;
	};
	const claim = {
		...CLAIM,
		requestedMode: hooks.mode ?? CLAIM.requestedMode,
		effectiveMode: hooks.mode ?? CLAIM.effectiveMode,
	};
	const authorization = {
		resourceId: CLAIM.resourceId,
		origin: null,
		audience: "https://example.test/",
		requestedMode: claim.requestedMode,
		effectiveMode: claim.effectiveMode,
		sessionGeneration: 7n,
	} as any;
	return createCrdtExchangeApplicationV1({
		namespace: "test",
		appUrl: "https://example.test",
		audience: "https://example.test/",
		async authenticateBrowser(request) {
			hooks.onAuthenticate?.();
			return callback(
				hooks.authenticateBrowser
					? await hooks.authenticateBrowser(request)
					: ({
							kind: "user",
							user: { id: "user-1" },
							session: { id: "session-1" },
						} as any),
			);
		},
		async authenticateAgent() {
			return null;
		},
		async inspectSession(input) {
			hooks.onInspect?.(input);
			return callback(claim);
		},
		async authorize(input) {
			hooks.onAuthorize?.(input);
			return callback(authorization);
		},
		async validateAuthority() {
			hooks.onValidate?.();
			callback(undefined);
		},
		async pull(input) {
			if (hooks.onPull) return hooks.onPull(input);
			throw new Error("not used");
		},
		sync: {
			async captureBasis() {
				return hooks.onCaptureBasis?.() as any;
			},
			async captureAuthorityBasis() {
				return hooks.onCaptureAuthorityBasis?.() as any;
			},
			async registerCursor() {},
			async readHead() {
				return 0n;
			},
			async readCommits() {
				return [];
			},
			async submitUpdate(basis, update) {
				const receipt = hooks.onSubmitUpdate?.(basis, update);
				if (!receipt) throw new Error("not used");
				return receipt;
			},
			async reconcileReceipts() {
				const receipts = hooks.onReconcileReceipts?.();
				if (!receipts) throw new Error("not used");
				return receipts;
			},
		} as any,
		presence: {
			async writeAwareness() {
				return [];
			},
			async projectRoster() {
				return [];
			},
			async heartbeat() {
				await hooks.onHeartbeat?.();
				return callback(1234n);
			},
			async close() {},
		},
		...(hooks.maximumConcurrentRequests === undefined
			? {}
			: { maximumConcurrentRequests: hooks.maximumConcurrentRequests }),
	});
}

function authorityBasis(mode: "view" | "edit") {
	return {
		sessionId: CLAIM.sessionId,
		bindingId: CLAIM.bindingId,
		sessionGeneration: CLAIM.sessionGeneration,
		deliveryGeneration: CLAIM.deliveryGeneration,
		resourceId: CLAIM.resourceId,
		resourceEpochId: "00000000-0000-4000-8000-000000000003",
		schemaId: "00000000-0000-4000-8000-000000000004",
		aggregateEpoch: 9n,
		schemaVersion: 1,
		fields: [
			{
				bindingId: "00000000-0000-4000-8000-000000000005",
				fieldSlot: 1,
				fieldEpoch: 1n,
				grant: mode === "edit" ? 1 : 0,
				formatVersion: 1,
				readFence: 0n,
				editFence: 0n,
				fieldCursor: 0n,
			},
		],
	};
}

function heartbeatBytes() {
	return encodeCrdtExchangeFrameV1({
		major: 1,
		minor: 0,
		opcode: 0x05,
		requestId: REQUEST_ID,
		payload: {
			bindingId: BINDING_ID,
			sessionGeneration: 7n,
			deliveryGeneration: 3n,
		},
	});
}

function appendBytes() {
	return encodeCrdtExchangeFrameV1({
		major: 1,
		minor: 0,
		opcode: 0x02,
		requestId: REQUEST_ID,
		payload: {
			bindingId: BINDING_ID,
			sessionGeneration: 7n,
			deliveryGeneration: 3n,
			updateId: REQUEST_ID,
			aggregateEpoch: 9n,
			schemaVersion: 1,
			parts: [
				{
					fieldSlot: 1,
					fieldEpoch: 1n,
					formatVersion: 1,
					baseFieldCursor: 0n,
					bytes: new Uint8Array([1]),
				},
			],
		},
	});
}

function pullBytes() {
	return encodeCrdtExchangeFrameV1({
		major: 1,
		minor: 0,
		opcode: 0x01,
		requestId: REQUEST_ID,
		payload: {
			bindingId: BINDING_ID,
			sessionGeneration: 7n,
			deliveryGeneration: 3n,
			pullId: REQUEST_ID,
			schemaVersion: 1,
			continuation: null,
			proofs: [],
		},
	});
}

function receiptBytes() {
	return encodeCrdtExchangeFrameV1({
		major: 1,
		minor: 0,
		opcode: 0x03,
		requestId: REQUEST_ID,
		payload: {
			bindingId: BINDING_ID,
			sessionGeneration: 7n,
			deliveryGeneration: 3n,
			receipts: [
				{
					updateId: REQUEST_ID,
					submittedHash: new Uint8Array(32),
					aggregateEpoch: 9n,
					schemaVersion: 1,
				},
			],
		},
	});
}

function request(
	bytes: Uint8Array,
	headers: Record<string, string> = {},
	signal?: AbortSignal,
) {
	return new Request("https://example.test/api/realtime/crdt/exchange", {
		method: "POST",
		headers: {
			"content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE,
			...headers,
		},
		body: bytes,
		signal,
	});
}

function stalledRequest(signal: AbortSignal) {
	return new Request("https://example.test/api/realtime/crdt/exchange", {
		method: "POST",
		headers: { "content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE },
		body: new ReadableStream<Uint8Array>({
			pull: () => new Promise(() => {}),
		}),
		signal,
	});
}

function fragmentedRequest(bytes: Uint8Array) {
	let offset = 0;
	let empty = true;
	const reusable = new Uint8Array(1);
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (empty) {
				empty = false;
				controller.enqueue(new Uint8Array(0));
				return;
			}
			if (offset === bytes.byteLength) {
				controller.close();
				return;
			}
			reusable[0] = bytes[offset++]!;
			empty = true;
			controller.enqueue(reusable);
		},
	});
	return new Request("https://example.test/api/realtime/crdt/exchange", {
		method: "POST",
		headers: { "content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE },
		body,
	});
}
