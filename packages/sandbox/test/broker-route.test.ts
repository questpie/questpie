import { describe, expect, it } from "bun:test";

import {
	BROKER_HTTP_RESULT_CAP_BYTES,
	BROKER_NATIVE_RESULT_CAP_BYTES,
	HTTP_FETCH_BODY_CAP_BYTES,
	SandboxBroker,
} from "questpie/executor";

import {
	BROKER_HTTP_BODY_CAP_BYTES,
	brokerResultValueCap,
} from "../src/broker-wire.js";
import sandboxRpcRoute, {
	handleSandboxBrokerRequest,
} from "../src/server/modules/sandbox/routes/sandbox/rpc.js";

const request = (body: BodyInit | null, headers?: HeadersInit) =>
	new Request("https://app.example/api/sandbox/rpc", {
		method: "POST",
		body,
		headers,
	});

describe("sandbox broker route", () => {
	it("is an explicitly public POST transport guarded by its inner token", () => {
		expect(sandboxRpcRoute.method).toBe("POST");
		expect(sandboxRpcRoute.access).toBe(true);
		expect(BROKER_HTTP_BODY_CAP_BYTES).toBe(HTTP_FETCH_BODY_CAP_BYTES);
		expect(brokerResultValueCap("http.fetch")).toBe(
			BROKER_HTTP_RESULT_CAP_BYTES,
		);
		expect(brokerResultValueCap("files.read")).toBe(
			BROKER_NATIVE_RESULT_CAP_BYTES,
		);
	});

	it("requires the opaque broker token inside an explicitly public route", async () => {
		const broker = new SandboxBroker(() => "secret-token");
		const response = await handleSandboxBrokerRequest(
			request(JSON.stringify({ method: "files.read", args: {} }), {
				"content-type": "application/json",
			}),
			broker,
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			ok: false,
			error: {
				code: "unauthorized",
				message: "invalid or expired sandbox token",
			},
		});
	});

	it("dispatches through the core broker without widening capabilities", async () => {
		const broker = new SandboxBroker(() => "secret-token");
		const minted = broker.mint({
			capabilities: { fs: { read: ["/allowed/**"], write: [] } },
			target: {
				files: {
					read: async (args) => ({ args }),
				},
			},
		});
		const response = await handleSandboxBrokerRequest(
			request(
				JSON.stringify({
					method: "files.read",
					args: { path: "/denied/file.txt" },
				}),
				{
					"content-type": "application/json",
					"x-questpie-sandbox-token": minted.token,
				},
			),
			broker,
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			ok: false,
			error: { code: "forbidden" },
		});
	});

	it("keeps the custom-tool method family out of the native broker", async () => {
		let nativeCalls = 0;
		const response = await handleSandboxBrokerRequest(
			request(JSON.stringify({ method: "tools.list", args: {} }), {
				"content-type": "application/json",
				"x-questpie-sandbox-token": "unregistered",
			}),
			{
				handleRpc: async () => {
					nativeCalls += 1;
					return { ok: true as const, value: null };
				},
			},
		);

		expect(response.status).toBe(401);
		expect(nativeCalls).toBe(0);
		expect(await response.json()).toEqual({
			ok: false,
			error: {
				code: "unauthorized",
				message: "sandbox custom tool session is unavailable",
			},
		});
	});

	it("rejects malformed, extra-key and oversized bodies before dispatch", async () => {
		let calls = 0;
		const broker = {
			handleRpc: async () => {
				calls++;
				return { ok: true as const, value: null };
			},
		};

		for (const [body, expectedStatus] of [
			["{", 400],
			[JSON.stringify({ method: "files.read", unexpected: true }), 400],
			[
				JSON.stringify({
					method: "files.read",
					args: "x".repeat(64 * 1024),
				}),
				413,
			],
		] as const) {
			const response = await handleSandboxBrokerRequest(
				request(body, { "content-type": "application/json" }),
				broker,
			);
			expect(response.status).toBe(expectedStatus);
		}
		expect(calls).toBe(0);
	});

	it("applies a larger derived wire budget to brokered HTTP bodies", async () => {
		let receivedBytes = 0;
		const bodyBase64 = "A".repeat(70 * 1024);
		const response = await handleSandboxBrokerRequest(
			request(
				JSON.stringify({
					method: "http.fetch",
					args: { url: "https://api.example/upload", bodyBase64 },
				}),
				{ "content-type": "application/json" },
			),
			{
				handleRpc: async (_token, method, args) => {
					expect(method).toBe("http.fetch");
					receivedBytes = (
						args as {
							bodyBase64: string;
						}
					).bodyBase64.length;
					return { ok: true as const, value: { accepted: true } };
				},
			},
		);

		expect(response.status).toBe(200);
		expect(receivedBytes).toBe(bodyBase64.length);
	});

	it("does not reflect broker failures, tokens or request arguments", async () => {
		const response = await handleSandboxBrokerRequest(
			request(JSON.stringify({ method: "files.read", args: "top-secret" }), {
				"content-type": "application/json",
				"x-questpie-sandbox-token": "secret-token",
			}),
			{
				handleRpc: async () => {
					throw new Error("database secret");
				},
			},
		);

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			ok: false,
			error: {
				code: "execution_error",
				message: "sandbox broker request failed",
			},
		});
	});

	it("rejects hostile native results before JSON serialization and redacts returned execution errors", async () => {
		let getterCalls = 0;
		const accessor = Object.defineProperty({}, "secret", {
			enumerable: true,
			get() {
				getterCalls += 1;
				return "must-not-run";
			},
		});
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;

		for (const value of [accessor, cyclic, "x".repeat(769 * 1024)]) {
			const response = await handleSandboxBrokerRequest(
				request(JSON.stringify({ method: "files.read", args: {} }), {
					"content-type": "application/json",
				}),
				{
					handleRpc: async () => ({ ok: true as const, value }),
				},
			);
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({
				ok: false,
				error: {
					code: "execution_error",
					message: "sandbox broker returned an invalid result",
				},
			});
		}
		expect(getterCalls).toBe(0);

		const rawFailure = await handleSandboxBrokerRequest(
			request(JSON.stringify({ method: "files.read", args: {} }), {
				"content-type": "application/json",
			}),
			{
				handleRpc: async () => ({
					ok: false as const,
					error: {
						code: "execution_error" as const,
						message: "postgres://user:secret@db.internal/tenant",
					},
				}),
			},
		);
		expect(rawFailure.status).toBe(500);
		const rawFailureBody = await rawFailure.json();
		expect(rawFailureBody).toMatchObject({
			ok: false,
			error: {
				code: "execution_error",
				message: "sandbox binding operation failed",
			},
		});
		expect(JSON.stringify(rawFailureBody)).not.toContain("secret");
	});
});
