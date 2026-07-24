import { describe, expect, it } from "bun:test";

import { SandboxBroker } from "questpie/executor";

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
});
