import { afterEach, describe, expect, it } from "bun:test";

import type {
	CrdtHostApplicationV1,
	CrdtHostSocketSessionV1,
} from "questpie/crdt";

import { createElysiaCrdtHost, questpieElysia } from "../../src/server.js";

describe("Elysia CRDT host", () => {
	const running: Array<ReturnType<typeof createElysiaCrdtHost>> = [];

	afterEach(() => {
		for (const app of running.splice(0)) app.server?.stop(true);
	});

	it("mounts bounded browser and Agent ticket handlers at a custom path", async () => {
		const seen: string[] = [];
		const app = createElysiaCrdtHost({
			path: "/collaboration",
			application: application({
				handleTicket: async (request) => {
					seen.push(`browser:${await request.text()}`);
					return Response.json({ ticket: "browser" });
				},
				handleAgentTicket: async (request) => {
					seen.push(`agent:${await request.text()}`);
					return Response.json({ ticket: "agent" });
				},
			}),
		});

		const browser = await app.handle(
			new Request("http://localhost/collaboration/ticket", {
				method: "POST",
				body: '{"namespace":"acme"}',
			}),
		);
		const agent = await app.handle(
			new Request("http://localhost/collaboration/agent-ticket", {
				method: "POST",
				body: '{"namespace":"acme"}',
			}),
		);
		const oversized = await app.handle(
			new Request("http://localhost/collaboration/ticket", {
				method: "POST",
				body: "x".repeat(8 * 1024 + 1),
			}),
		);

		expect(await browser.json()).toEqual({ ticket: "browser" });
		expect(await agent.json()).toEqual({ ticket: "agent" });
		expect(oversized.status).toBe(413);
		expect(seen).toEqual([
			'browser:{"namespace":"acme"}',
			'agent:{"namespace":"acme"}',
		]);
	});

	it("mounts the installed kernel under the QUESTPIE base path", async () => {
		const seen: string[] = [];
		const core = application({
			handleTicket: async () => {
				seen.push("ticket");
				return new Response(null, { status: 204 });
			},
		});
		const app = questpieElysia(
			{
				config: { routes: undefined, logger: undefined },
				crdtHostApplication: core,
			} as never,
			{
				basePath: "/api",
				crdt: { path: "/collaboration" },
			},
		);

		const response = await app.handle(
			new Request("http://localhost/api/collaboration/ticket", {
				method: "POST",
			}),
		);
		expect(response.status).toBe(204);
		expect(seen).toEqual(["ticket"]);
	});

	it("accepts binary QPCR frames without negotiating compression", async () => {
		let messages = 0;
		const app = createElysiaCrdtHost({
			application: application({
				openSocket: async ({ peer }) =>
					session({
						message: async (data) => {
							messages += 1;
							peer.send(data);
							return { authenticated: messages > 0 };
						},
					}),
			}),
		});
		running.push(app);
		app.listen({ hostname: "127.0.0.1", port: 0 });
		const socket = new WebSocket(
			`ws://127.0.0.1:${app.server!.port}/crdt/socket`,
		);
		socket.binaryType = "arraybuffer";
		await opened(socket);
		expect(socket.extensions).toBe("");

		socket.send(Uint8Array.of(1, 2, 3));
		expect(new Uint8Array(await nextMessage(socket))).toEqual(
			Uint8Array.of(1, 2, 3),
		);
		socket.send(Uint8Array.of(4));
		expect(new Uint8Array(await nextMessage(socket))).toEqual(Uint8Array.of(4));
		expect(messages).toBe(2);
		const socketClosed = closed(socket);
		socket.close();
		await socketClosed;
	});

	it("enforces one pending AUTH frame and five unauthenticated sockets per direct IP", async () => {
		const releaseFirst = deferred();
		const app = createElysiaCrdtHost({
			application: application({
				openSocket: async () =>
					session({
						message: async () => {
							await releaseFirst.promise;
							return { authenticated: false };
						},
					}),
			}),
		});
		running.push(app);
		app.listen({ hostname: "127.0.0.1", port: 0 });
		const url = `ws://127.0.0.1:${app.server!.port}/crdt/socket`;
		const sockets = Array.from({ length: 6 }, () => new WebSocket(url));
		const closeResults = sockets.map(closed);
		await Promise.all(sockets.map(opened));
		expect(await closeResults[5]).toMatchObject({ code: 1013 });

		sockets[0]!.send(Uint8Array.of(1));
		sockets[0]!.send(Uint8Array.of(2));
		expect(await closeResults[0]).toMatchObject({ code: 1008 });
		releaseFirst.resolve();
		for (const socket of sockets.slice(1, 5)) socket.close();
		await Promise.all(closeResults.slice(1, 5));
	});

	it("uses only an explicit trusted-proxy resolver and times unauthenticated sockets out", async () => {
		let resolvedIp = "";
		const app = createElysiaCrdtHost({
			path: "/api/collaboration",
			resolveTrustedProxyClientIp: ({ request, directClientIp }) => {
				expect(directClientIp).toBe("127.0.0.1");
				expect(request.headers.get("x-forwarded-for")).toBeNull();
				return "203.0.113.9";
			},
			application: application({
				openSocket: async ({ clientIp }) => {
					resolvedIp = clientIp;
					return session();
				},
			}),
		});
		running.push(app);
		app.listen({ hostname: "127.0.0.1", port: 0 });
		const socket = new WebSocket(
			`ws://127.0.0.1:${app.server!.port}/api/collaboration/socket`,
		);
		const socketClosed = closed(socket);
		await opened(socket);
		expect(resolvedIp).toBe("203.0.113.9");
		expect(await socketClosed).toMatchObject({
			code: 1008,
			reason: "CRDT authentication timeout",
		});
	}, 10_000);

	it("stops core ticket admission with the Elysia lifecycle", async () => {
		let stopped = false;
		const app = createElysiaCrdtHost({
			application: application({
				stop: async () => {
					stopped = true;
				},
			}),
		});
		running.push(app);
		app.listen({ hostname: "127.0.0.1", port: 0 });
		await app.stop(true);
		expect(stopped).toBe(true);
	});
});

function application(
	overrides: Partial<CrdtHostApplicationV1> = {},
): CrdtHostApplicationV1 {
	return {
		protocol: "QPCR/1.0",
		handleTicket: async () => new Response(null, { status: 204 }),
		handleAgentTicket: async () => new Response(null, { status: 204 }),
		openSocket: async () => session(),
		stop: async () => {},
		...overrides,
	};
}

function session(
	overrides: Partial<CrdtHostSocketSessionV1> = {},
): CrdtHostSocketSessionV1 {
	return {
		message: async () => ({ authenticated: false }),
		drain: async () => {},
		close: async () => {},
		...overrides,
	};
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function opened(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
	return new Promise((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("socket failed")), {
			once: true,
		});
	});
}

function closed(
	socket: WebSocket,
): Promise<Readonly<{ code: number; reason: string }>> {
	if (socket.readyState === WebSocket.CLOSED) {
		return Promise.resolve({ code: 1006, reason: "" });
	}
	return new Promise((resolve) => {
		socket.addEventListener(
			"close",
			(event) => resolve({ code: event.code, reason: event.reason }),
			{ once: true },
		);
	});
}

function nextMessage(socket: WebSocket): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		socket.addEventListener(
			"message",
			(event) => {
				if (event.data instanceof ArrayBuffer) resolve(event.data);
				else reject(new Error("expected binary frame"));
			},
			{ once: true },
		);
	});
}
