import assert from "node:assert/strict";

import type { GeneratedClientScope } from "#questpie/client";

export const tutorialId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
export const tutorialTime = "2026-09-08T10:00:00.000Z";
const protocol = { name: "questpie.realtime", version: 1 };

function result(
	summary: string,
): Awaited<ReturnType<GeneratedClientScope["queries"]["tickets.detailPage"]>> {
	return {
		nodes: [
			{
				id: tutorialId,
				summary,
				comments: [
					{
						id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132",
						body: "SSR comment",
						createdAt: new Date(tutorialTime),
					},
				],
			},
		],
		pageInfo: { endCursor: null, hasNextPage: false },
	};
}

export function createTutorialPeer() {
	const streams = new Map<
		string,
		ReadableStreamDefaultController<Uint8Array>
	>();
	const bindings = new Map<string, { scopeId: string; query: string }>();
	const stats = {
		serverReads: 0,
		browserReads: 0,
		serverStreams: 0,
		browserStreams: 0,
		opens: 0,
		closes: 0,
	};
	function send(scopeId: string, frame: object) {
		streams
			.get(scopeId)
			?.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ protocol, ...frame })}\n\n`,
				),
			);
	}
	return {
		stats,
		bindings,
		streams,
		close() {
			for (const stream of streams.values()) {
				try {
					stream.close();
				} catch {}
			}
			streams.clear();
			bindings.clear();
		},
		async handle(
			request: Request,
			side: "server" | "browser",
		): Promise<Response | undefined> {
			const url = new URL(request.url);
			if (url.pathname === "/_questpie/query/tickets.detailPage") {
				stats[side === "server" ? "serverReads" : "browserReads"]++;
				return Response.json(
					{
						callId: decodeURIComponent(
							request.headers.get("Questpie-Call-Id")!,
						),
						result: result("Server-rendered support ticket"),
					},
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			if (url.pathname !== "/_questpie/realtime") return;
			if (request.method === "GET") {
				stats[side === "server" ? "serverStreams" : "browserStreams"]++;
				const scopeId = request.headers.get("x-questpie-realtime-scope")!;
				let closed = false;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							streams.set(scopeId, controller);
							send(scopeId, { kind: "ready", scopeId });
							request.signal.addEventListener(
								"abort",
								() => {
									if (!closed) {
										closed = true;
										try {
											controller.close();
										} catch {}
									}
									streams.delete(scopeId);
								},
								{ once: true },
							);
						},
						cancel() {
							closed = true;
							streams.delete(scopeId);
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			const command = await request.json();
			if (command.command === "open") {
				assert.equal(command.query, "query:tickets.detailPage");
				assert.deepEqual(command.input, {
					ids: [tutorialId],
					first: 1,
					after: null,
				});
				stats.opens++;
				bindings.set(command.bindingId, {
					scopeId: command.scopeId,
					query: command.query,
				});
				send(command.scopeId, {
					kind: "delivery",
					bindingId: command.bindingId,
					query: command.query,
					delivery: "initial",
					payload: result("Live support ticket"),
					resetReason: null,
					resumeToken: `start-docs-${stats.opens}`,
				});
			} else if (command.command === "close") {
				stats.closes++;
				bindings.delete(command.bindingId);
			}
			return new Response(null, { status: 202 });
		},
	};
}
