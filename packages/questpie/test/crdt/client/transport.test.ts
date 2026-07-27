import { describe, expect, it } from "bun:test";

import {
	createCrdtHttpExchangeClient,
	CrdtHttpProtocolError,
} from "../../../src/client/crdt/transport.js";
import { CrdtConnectError } from "../../../src/client/crdt/types.js";
import {
	CRDT_EXCHANGE_V1_CONTENT_TYPE,
	decodeCrdtExchangeFrameV1,
	encodeCrdtExchangeFrameV1,
} from "../../../src/shared/crdt-exchange.js";

describe("CRDT typed HTTP transport", () => {
	it("retries one stable openId and binds the request to the shared edge token", async () => {
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		let attempts = 0;
		const client = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com/",
			basePath: "/api",
			defaultHeaders: { "x-static": "present" },
			getAuthHeaders: async () => ({ authorization: "Bearer rotating" }),
			fetcher: (async (input, init) => {
				requests.push({ url: String(input), init });
				if (attempts++ === 0) throw new TypeError("network reset");
				return Response.json(openResponse(), { status: 201 });
			}) as typeof fetch,
		});

		const opened = await client.open({
			openId: "00000000-0000-4000-8000-000000000001",
			replacesBindingId: "00000000-0000-4000-8000-000000000002",
			owner: { kind: "collection", key: "articles", id: "article-1" },
			mode: "edit",
			edgeSessionId: "00000000-0000-4000-8000-000000000010",
			edgeToken: "edge-secret",
		});

		expect(opened.protocol).toBe("questpie-crdt-http");
		expect(opened.bindingIdBytes).toHaveLength(16);
		expect(requests).toHaveLength(2);
		expect(requests.map((request) => request.url)).toEqual([
			"https://api.example.com/api/realtime/crdt/open",
			"https://api.example.com/api/realtime/crdt/open",
		]);
		for (const request of requests) {
			expect(request.init).toMatchObject({
				method: "POST",
				credentials: "include",
				headers: {
					"x-static": "present",
					authorization: "Bearer rotating",
					"content-type": "application/json",
					"x-questpie-realtime-token": "edge-secret",
				},
			});
			expect(JSON.parse(String(request.init?.body))).toMatchObject({
				openId: "00000000-0000-4000-8000-000000000001",
				replacesBindingId: "00000000-0000-4000-8000-000000000002",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
			});
		}
	});

	it("round-trips binary exchange frames without opening a socket", async () => {
		const requestId = new Uint8Array(16).fill(1);
		const client = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com",
			basePath: "/api",
			fetcher: (async (input, init) => {
				expect(String(input)).toBe(
					"https://api.example.com/api/realtime/crdt/exchange",
				);
				expect(init?.headers).toMatchObject({
					"content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE,
				});
				const request = decodeCrdtExchangeFrameV1(
					new Uint8Array(init?.body as ArrayBuffer),
				);
				expect(request.opcode).toBe(0x05);
				const bytes = encodeCrdtExchangeFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x85,
					requestId: request.requestId,
					payload: { serverTimeMs: 42n },
				});
				return new Response(bytes.buffer as ArrayBuffer, {
					status: 200,
					headers: {
						"content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE,
					},
				});
			}) as typeof fetch,
		});

		await expect(
			client.exchange({
				major: 1,
				minor: 0,
				opcode: 0x05,
				requestId,
				payload: {
					bindingId: new Uint8Array(16).fill(2),
					sessionGeneration: 1n,
					deliveryGeneration: 1n,
				},
			}),
		).resolves.toEqual({
			major: 1,
			minor: 0,
			opcode: 0x85,
			requestId,
			payload: { serverTimeMs: 42n },
		});
	});

	it("fails closed on extra open fields and mismatched response correlation", async () => {
		const malformedOpen = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com",
			basePath: "/api",
			fetcher: (async () =>
				Response.json(
					{
						...openResponse(),
						clientPath: "/socket",
					},
					{ status: 201 },
				)) as typeof fetch,
		});
		await expect(
			malformedOpen.open({
				openId: "00000000-0000-4000-8000-000000000001",
				owner: { kind: "global", key: "settings" },
				mode: "view",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
				edgeToken: "edge-secret",
			}),
		).rejects.toBeInstanceOf(CrdtHttpProtocolError);

		const wrongCorrelation = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com",
			basePath: "/api",
			fetcher: (async () => {
				const bytes = encodeCrdtExchangeFrameV1({
					major: 1,
					minor: 0,
					opcode: 0x85,
					requestId: new Uint8Array(16).fill(9),
					payload: { serverTimeMs: 42n },
				});
				return new Response(bytes.buffer as ArrayBuffer, {
					headers: {
						"content-type": CRDT_EXCHANGE_V1_CONTENT_TYPE,
					},
				});
			}) as typeof fetch,
		});
		await expect(
			wrongCorrelation.exchange({
				major: 1,
				minor: 0,
				opcode: 0x05,
				requestId: new Uint8Array(16).fill(1),
				payload: {
					bindingId: new Uint8Array(16).fill(2),
					sessionGeneration: 1n,
					deliveryGeneration: 1n,
				},
			}),
		).rejects.toBeInstanceOf(CrdtHttpProtocolError);
	});

	it("maps the disclosure-safe open 404 to CRDT_UNAVAILABLE, not recovery", async () => {
		let requests = 0;
		const client = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com",
			basePath: "/api",
			fetcher: (async () => {
				requests++;
				return Response.json(
					{ error: { code: "CRDT_UNAVAILABLE", message: "CRDT unavailable" } },
					{ status: 404 },
				);
			}) as typeof fetch,
		});

		await expect(
			client.open({
				openId: "00000000-0000-4000-8000-000000000001",
				owner: { kind: "global", key: "settings" },
				mode: "view",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
				edgeToken: "edge-secret",
			}),
		).rejects.toEqual(new CrdtConnectError("CRDT_UNAVAILABLE"));
		expect(requests).toBe(1);
	});

	it("accepts only the ratified 201 status for a successful open", async () => {
		const client = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com",
			basePath: "/api",
			fetcher: (async () =>
				Response.json(openResponse(), { status: 200 })) as typeof fetch,
		});

		await expect(
			client.open({
				openId: "00000000-0000-4000-8000-000000000001",
				owner: { kind: "global", key: "settings" },
				mode: "view",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
				edgeToken: "edge-secret",
			}),
		).rejects.toBeInstanceOf(CrdtHttpProtocolError);
	});

	it("rejects a successful open with the wrong response media type", async () => {
		const client = createCrdtHttpExchangeClient({
			baseURL: "https://api.example.com",
			basePath: "/api",
			fetcher: (async () =>
				new Response(JSON.stringify(openResponse()), {
					status: 201,
					headers: { "content-type": "text/plain" },
				})) as typeof fetch,
		});

		await expect(
			client.open({
				openId: "00000000-0000-4000-8000-000000000001",
				owner: { kind: "global", key: "settings" },
				mode: "view",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
				edgeToken: "edge-secret",
			}),
		).rejects.toBeInstanceOf(CrdtHttpProtocolError);
	});

	it("keeps the request deadline active until the complete response body arrives", async () => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let requests = 0;
		const client = createCrdtHttpExchangeClient(
			{
				baseURL: "https://api.example.com",
				basePath: "/api",
				fetcher: (async () => {
					requests++;
					return new Response(
						new ReadableStream({
							start(controller) {
								timer = setTimeout(() => {
									controller.enqueue(
										new TextEncoder().encode(JSON.stringify(openResponse())),
									);
									controller.close();
								}, 50);
							},
							cancel() {
								if (timer !== undefined) clearTimeout(timer);
							},
						}),
						{
							status: 201,
							headers: { "content-type": "application/json" },
						},
					);
				}) as typeof fetch,
			},
			{ requestTimeoutMs: 5 },
		);

		await expect(
			client.open({
				openId: "00000000-0000-4000-8000-000000000001",
				owner: { kind: "global", key: "settings" },
				mode: "view",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
				edgeToken: "edge-secret",
			}),
		).rejects.toMatchObject({ name: "TimeoutError" });
		expect(requests).toBe(2);
	});

	it("retries a lost committed open response after its internal deadline with the same openId", async () => {
		const bodies: string[] = [];
		const client = createCrdtHttpExchangeClient(
			{
				baseURL: "https://api.example.com",
				basePath: "/api",
				fetcher: (async (_input, init) => {
					bodies.push(String(init?.body));
					if (bodies.length === 1) {
						return new Response(
							new ReadableStream({
								pull: () => new Promise(() => {}),
							}),
							{
								status: 201,
								headers: { "content-type": "application/json" },
							},
						);
					}
					return Response.json(openResponse(), { status: 201 });
				}) as typeof fetch,
			},
			{ requestTimeoutMs: 5 },
		);

		await expect(
			client.open({
				openId: "00000000-0000-4000-8000-000000000001",
				owner: { kind: "global", key: "settings" },
				mode: "view",
				edgeSessionId: "00000000-0000-4000-8000-000000000010",
				edgeToken: "edge-secret",
			}),
		).resolves.toMatchObject({ bindingId: openResponse().bindingId });
		expect(bodies.map((body) => JSON.parse(body).openId)).toEqual([
			"00000000-0000-4000-8000-000000000001",
			"00000000-0000-4000-8000-000000000001",
		]);
	});
});

function openResponse() {
	return {
		protocol: "questpie-crdt-http",
		version: 1,
		namespace: "app",
		deploymentFingerprint: "deployment-1",
		bindingId: "00000000-0000-4000-8000-000000000020",
		sessionGeneration: "1",
		deliveryGeneration: "1",
		leaseExpiresAt: "2026-07-25T12:00:00.000Z",
		incarnationKey: "00000000-0000-4000-8000-000000000030",
		effectiveMode: "edit",
		offlineSubjectKey: "A".repeat(43),
		manifest: {
			schemaVersion: 1,
			schemaFingerprint: "S".repeat(43),
			awarenessEnabled: false,
			fields: {
				title: {
					fieldSlot: 1,
					format: "text",
					formatVersion: 1,
					engineId: "test-text",
					grant: "edit",
				},
			},
		},
		initialPull: { operation: "pull", continuation: null },
	};
}
