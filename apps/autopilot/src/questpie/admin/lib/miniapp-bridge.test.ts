import { describe, expect, it, vi } from "vitest";

import {
	type MiniAppRpcReply,
	buildRpcUrl,
	handleBridgeMessage,
	isMiniAppRpcMessage,
	validateBridgeMessage,
} from "./miniapp-bridge";

const FRAME = { id: "frame" } as unknown;

function rpc(action: string, input?: unknown, app = "social-scheduler") {
	return { __miniapp_rpc: true, id: "social-scheduler:1", app, action, input };
}

describe("isMiniAppRpcMessage", () => {
	it("accepts a well-formed rpc and rejects anything else", () => {
		expect(isMiniAppRpcMessage(rpc("status"))).toBe(true);
		expect(isMiniAppRpcMessage(null)).toBe(false);
		expect(isMiniAppRpcMessage({})).toBe(false);
		expect(isMiniAppRpcMessage({ __miniapp_rpc: true })).toBe(false);
		expect(
			isMiniAppRpcMessage({
				__miniapp_rpc: false,
				id: "x",
				app: "y",
				action: "z",
			}),
		).toBe(false);
	});
});

describe("validateBridgeMessage (source/origin/app)", () => {
	const config = {
		appId: "social-scheduler",
		frameWindow: FRAME,
		allowedOrigins: ["null", ""],
	};

	it("accepts a message from the bound frame, a null origin, and the right app", () => {
		const result = validateBridgeMessage(
			{ data: rpc("status"), source: FRAME, origin: "null" },
			config,
		);
		expect(result.ok).toBe(true);
	});

	it("rejects a non-rpc message", () => {
		const result = validateBridgeMessage(
			{ data: { hello: 1 }, source: FRAME, origin: "null" },
			config,
		);
		expect(result).toEqual({ ok: false, reason: "not-rpc" });
	});

	it("rejects a message from a DIFFERENT source window (spoof)", () => {
		const result = validateBridgeMessage(
			{ data: rpc("status"), source: { id: "other" }, origin: "null" },
			config,
		);
		expect(result).toEqual({ ok: false, reason: "bad-source" });
	});

	it("rejects a message from an unexpected origin", () => {
		const result = validateBridgeMessage(
			{ data: rpc("status"), source: FRAME, origin: "https://evil.com" },
			config,
		);
		expect(result).toEqual({ ok: false, reason: "bad-origin" });
	});

	it("rejects a message claiming a DIFFERENT app", () => {
		const result = validateBridgeMessage(
			{ data: rpc("status", {}, "other-app"), source: FRAME, origin: "null" },
			config,
		);
		expect(result).toEqual({ ok: false, reason: "app-mismatch" });
	});
});

describe("buildRpcUrl", () => {
	it("POSTs a named action with the input as JSON", () => {
		const out = buildRpcUrl("/api", "social-scheduler", "status", { x: 1 });
		expect(out.method).toBe("POST");
		expect(out.url).toBe("/api/apps/social-scheduler/status");
		expect(JSON.parse(out.body!)).toEqual({ x: 1 });
	});

	it("GETs an fs:read at the encoded path", () => {
		const out = buildRpcUrl("/api", "social-scheduler", "fs:read", {
			path: "company/apps/social-scheduler/data/queue.json",
		});
		expect(out.method).toBe("GET");
		expect(out.url).toBe(
			"/api/apps/social-scheduler/fs/company/apps/social-scheduler/data/queue.json",
		);
	});

	it("adds ?list=1 for an fs:read list request", () => {
		const out = buildRpcUrl("/api", "app", "fs:read", {
			path: "dir",
			list: true,
		});
		expect(out.url).toBe("/api/apps/app/fs/dir?list=1");
	});

	it("PUTs an fs:write with the body", () => {
		const out = buildRpcUrl("/api", "app", "fs:write", {
			path: "data/x.json",
			body: '{"a":1}',
		});
		expect(out.method).toBe("PUT");
		expect(out.url).toBe("/api/apps/app/fs/data/x.json");
		expect(out.body).toBe('{"a":1}');
	});

	it("encodes path segments (no traversal smuggling through the URL builder)", () => {
		const out = buildRpcUrl("/api", "app", "fs:read", { path: "a/../b c" });
		// `..` and the space are percent-encoded per segment.
		expect(out.url).toBe("/api/apps/app/fs/a/../b%20c");
	});
});

describe("handleBridgeMessage (end-to-end dispatch)", () => {
	const baseConfig = {
		appId: "social-scheduler",
		frameWindow: FRAME,
		allowedOrigins: ["null"],
		apiBase: "/api",
		getToken: () => "TOKEN-123",
	};

	it("attaches the token, POSTs the action, and replies with the envelope", async () => {
		const envelope = { ok: true, output: { queueCount: 3 }, logs: [] };
		const fetchImpl = vi.fn(
			async () =>
				new Response(JSON.stringify(envelope), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const replies: MiniAppRpcReply[] = [];

		const outcome = await handleBridgeMessage(
			{ data: rpc("status", { n: 1 }), source: FRAME, origin: "null" },
			{ ...baseConfig, fetchImpl },
			(r) => replies.push(r),
		);

		expect(outcome).toBe("dispatched");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("/api/apps/social-scheduler/status");
		expect((init as RequestInit).method).toBe("POST");
		expect(
			(init as RequestInit & { headers: Record<string, string> }).headers[
				"x-miniapp-token"
			],
		).toBe("TOKEN-123");
		expect(replies).toEqual([
			{ __miniapp_reply: true, id: "social-scheduler:1", result: envelope },
		]);
	});

	it("does NOT fetch or reply for a bad-source message (ignored silently)", async () => {
		const fetchImpl = vi.fn();
		const replies: MiniAppRpcReply[] = [];
		const outcome = await handleBridgeMessage(
			{ data: rpc("status"), source: { id: "other" }, origin: "null" },
			{ ...baseConfig, fetchImpl: fetchImpl as any },
			(r) => replies.push(r),
		);
		expect(outcome).toBe("bad-source");
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(replies).toHaveLength(0);
	});

	it("replies with the structured error on a non-ok response", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ ok: false, error: "boom", timedOut: false }),
					{
						status: 500,
						headers: { "content-type": "application/json" },
					},
				),
		);
		const replies: MiniAppRpcReply[] = [];
		await handleBridgeMessage(
			{ data: rpc("status"), source: FRAME, origin: "null" },
			{ ...baseConfig, fetchImpl },
			(r) => replies.push(r),
		);
		expect(replies[0]).toEqual({
			__miniapp_reply: true,
			id: "social-scheduler:1",
			error: "boom",
		});
	});

	it("replies with an error when fetch itself throws (network failure)", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new Error("network down");
		});
		const replies: MiniAppRpcReply[] = [];
		await handleBridgeMessage(
			{ data: rpc("status"), source: FRAME, origin: "null" },
			{ ...baseConfig, fetchImpl },
			(r) => replies.push(r),
		);
		expect(replies[0]).toEqual({
			__miniapp_reply: true,
			id: "social-scheduler:1",
			error: "network down",
		});
	});

	it("returns fs:read text bodies as the result", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response('{"queue":[]}', {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const replies: MiniAppRpcReply[] = [];
		await handleBridgeMessage(
			{
				data: rpc("fs:read", { path: "data/queue.json" }),
				source: FRAME,
				origin: "null",
			},
			{ ...baseConfig, fetchImpl },
			(r) => replies.push(r),
		);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("/api/apps/social-scheduler/fs/data/queue.json");
		expect((init as RequestInit).method).toBe("GET");
		expect(replies[0].result).toEqual({ queue: [] });
	});
});
