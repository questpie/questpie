import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createFetchHandler } from "../../../src/server/adapters/http.js";
import { createCrdtExchangeApplicationV1 } from "../../../src/server/modules/core/integrated/crdt/exchange-application.js";
import {
	CRDT_EXCHANGE_V1_CONTENT_TYPE,
	CRDT_EXCHANGE_V1_HEADER_BYTES,
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
	type CrdtExchangeRequestFrameV1,
} from "../../../src/shared/crdt-exchange.js";
import { buildMockApp } from "../../utils/mocks/mock-app-builder.js";

describe("CRDT open core Fetch route", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("is registered under the normal adapter and fails closed when CRDT is unavailable", async () => {
		const response = await createFetchHandler(setup.app, {
			basePath: "/api",
		})(
			new Request("http://localhost/api/realtime/crdt/open", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			error: {
				code: "CRDT_UNAVAILABLE",
				message: "CRDT unavailable",
			},
		});
	});

	it("hosts the exchange on the same normal Fetch catch-all", async () => {
		const response = await createFetchHandler(setup.app, {
			basePath: "/api",
		})(
			new Request("http://localhost/api/realtime/crdt/exchange", {
				method: "POST",
				headers: {
					"content-type": "application/vnd.questpie.crdt-exchange",
				},
				body: new Uint8Array([0]),
			}),
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			error: {
				code: "CRDT_UNAVAILABLE",
				message: "CRDT unavailable",
			},
		});
	});

	it("dispatches every closed exchange operation through the normal Fetch route", async () => {
		const bindingId = Uint8Array.from(
			{ length: 16 },
			(_, index) => 0x80 + index,
		);
		const requestId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
		const pullId = Uint8Array.from({ length: 16 }, (_, index) => 0x40 + index);
		const claim = {
			sessionId: "00000000-0000-4000-8000-000000000101",
			bindingId: "80818283-8485-8687-8889-8a8b8c8d8e8f",
			resourceId: "00000000-0000-4000-8000-000000000102",
			requestedMode: "edit" as const,
			effectiveMode: "edit" as const,
			sessionGeneration: 1n,
			deliveryGeneration: 2n,
		};
		const authorityBasis = {
			sessionId: claim.sessionId,
			bindingId: claim.bindingId,
			sessionGeneration: 1n,
			deliveryGeneration: 2n,
			resourceId: claim.resourceId,
			resourceEpochId: "00000000-0000-4000-8000-000000000103",
			schemaId: "00000000-0000-4000-8000-000000000104",
			aggregateEpoch: 3n,
			schemaVersion: 1,
			fields: [],
		};
		const application = createCrdtExchangeApplicationV1({
			namespace: "route-test",
			appUrl: "http://localhost",
			audience: "http://localhost/api/",
			async authenticateBrowser() {
				return {
					kind: "user",
					user: { id: "user-1" },
					session: { id: "session-1" },
				} as any;
			},
			async authenticateAgent() {
				return null;
			},
			async inspectSession() {
				return claim;
			},
			async authorize() {
				return {
					resourceId: claim.resourceId,
					origin: null,
					audience: "http://localhost/api/",
					requestedMode: "edit",
					effectiveMode: "edit",
					sessionGeneration: 1n,
				} as any;
			},
			async validateAuthority() {},
			async pull() {
				const frame = encodeCrdtExchangeFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x81,
					requestId,
					payload: {
						pullId,
						aggregateEpoch: 3n,
						schemaVersion: 1,
						artifactDigest: new Uint8Array(32),
						complete: true,
						continuation: null,
						fields: [],
						chunks: [],
					},
				});
				return {
					opcode: 0x81,
					payload: frame.slice(CRDT_EXCHANGE_V1_HEADER_BYTES),
					final: true,
				};
			},
			sync: {
				async captureAuthorityBasis() {
					return authorityBasis;
				},
				async captureBasis() {
					throw new Error("not used");
				},
				async registerCursor() {},
				async readHead() {
					return 0n;
				},
				async readCommits() {
					return [];
				},
				async submitUpdate(_basis, update) {
					return { updateId: update.updateId, cursors: [] };
				},
				async reconcileReceipts() {
					return [];
				},
			},
			presence: {
				async writeAwareness() {
					return [];
				},
				async projectRoster() {
					return [];
				},
				async heartbeat() {
					return 1234n;
				},
				async close() {},
			},
		});
		setup.app.crdtOperations = {
			...setup.app.crdtOperations,
			available: true,
			handleExchange: application.handle,
		};
		const session = {
			bindingId,
			sessionGeneration: 1n,
			deliveryGeneration: 2n,
		};
		const frames: Array<{
			frame: CrdtExchangeRequestFrameV1;
			responseOpcode: number;
		}> = [
			{
				frame: {
					major: 1,
					minor: 0,
					opcode: 0x01,
					requestId,
					payload: {
						...session,
						pullId,
						schemaVersion: 1,
						continuation: null,
						proofs: [],
					},
				},
				responseOpcode: 0x81,
			},
			{
				frame: {
					major: 1,
					minor: 0,
					opcode: 0x02,
					requestId,
					payload: {
						...session,
						updateId: requestId,
						aggregateEpoch: 3n,
						schemaVersion: 1,
						parts: [
							{
								fieldSlot: 1,
								fieldEpoch: 0n,
								formatVersion: 1,
								baseFieldCursor: 0n,
								bytes: Uint8Array.of(1),
							},
						],
					},
				},
				responseOpcode: 0x82,
			},
			{
				frame: {
					major: 1,
					minor: 0,
					opcode: 0x03,
					requestId,
					payload: { ...session, receipts: [] },
				},
				responseOpcode: 0x83,
			},
			{
				frame: {
					major: 1,
					minor: 0,
					opcode: 0x04,
					requestId,
					payload: { ...session, action: "roster" },
				},
				responseOpcode: 0x84,
			},
			{
				frame: {
					major: 1,
					minor: 0,
					opcode: 0x05,
					requestId,
					payload: session,
				},
				responseOpcode: 0x85,
			},
			{
				frame: {
					major: 1,
					minor: 0,
					opcode: 0x06,
					requestId,
					payload: session,
				},
				responseOpcode: 0x86,
			},
		];
		const handler = createFetchHandler(setup.app, { basePath: "/api" });

		for (const entry of frames) {
			const response = await handler(
				new Request("http://localhost/api/realtime/crdt/exchange", {
					method: "POST",
					headers: { "content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE },
					body: encodeCrdtExchangeFrameV1(entry.frame),
				}),
			);
			expect(response.status).toBe(200);
			expect(
				decodeCrdtExchangeFrameV1(new Uint8Array(await response.arrayBuffer()))
					.opcode,
			).toBe(entry.responseOpcode);
		}
	});
});
