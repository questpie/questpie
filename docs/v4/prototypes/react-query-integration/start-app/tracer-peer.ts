const firstId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const streamedId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132";
const time = "2026-09-08T10:00:00.000Z";
const protocol = { name: "questpie.realtime", version: 1 };

export function createPeer(
	options: { result?: (id: string, request: Request) => unknown } = {},
) {
	const delayed = Promise.withResolvers<void>();
	const asset = Promise.withResolvers<void>();
	const carriers = new Map<
		string,
		ReadableStreamDefaultController<Uint8Array>
	>();
	const opens: string[] = [];
	const activeBindings = new Set<string>();
	const closes: string[] = [];
	const stats = {
		serverReads: 0,
		serverStreams: 0,
		browserReads: 0,
		browserStreams: 0,
		prematureStreams: 0,
		ssrComplete: false,
		assetReleased: false,
	};
	let token = 0;
	const send = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		frame: object,
	) =>
		controller.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol, ...frame })}\n\n`,
			),
		);
	return {
		stats,
		opens,
		closes,
		activeBindings,
		releaseDelayed() {
			delayed.resolve();
		},
		releaseAsset() {
			stats.assetReleased = true;
			asset.resolve();
		},
		async handle(request: Request): Promise<Response | undefined> {
			const url = new URL(request.url);
			const server = request.headers.get("x-proof-side") === "server";
			if (url.pathname === "/__load-barrier") {
				await asset.promise;
				return new Response(
					'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
					{ headers: { "content-type": "image/svg+xml" } },
				);
			}
			if (url.pathname === "/_questpie/query/tasks.detail") {
				if (server) stats.serverReads++;
				else stats.browserReads++;
				const id = url.searchParams.get("id");
				if (id === streamedId) {
					if (request.headers.has("x-proof-hold")) await delayed.promise;
					else await new Promise((resolve) => setTimeout(resolve, 300));
				}
				return Response.json(
					{
						callId: decodeURIComponent(
							request.headers.get("Questpie-Call-Id")!,
						),
						result: {
							id,
							title: id === firstId ? "Finite SSR task" : "Streamed SSR task",
							updatedAt: time,
						},
					},
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			if (url.pathname !== "/_questpie/realtime") return;
			if (request.method === "GET") {
				if (server) stats.serverStreams++;
				else stats.browserStreams++;
				if (!stats.ssrComplete || !stats.assetReleased)
					stats.prematureStreams++;
				const scope = request.headers.get("x-questpie-realtime-scope")!;
				let closed = false;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							carriers.set(scope, controller);
							send(controller, { kind: "ready", scopeId: scope });
							request.signal.addEventListener(
								"abort",
								() => {
									if (!closed) {
										closed = true;
										controller.close();
									}
									carriers.delete(scope);
								},
								{ once: true },
							);
						},
						cancel() {
							closed = true;
							carriers.delete(scope);
						},
					}),
					{ headers: { "content-type": "text/event-stream" } },
				);
			}
			const command = await request.json();
			if (command.command === "open") {
				activeBindings.add(command.bindingId);
				const id = command.input.id;
				opens.push(id);
				send(carriers.get(command.scopeId)!, {
					kind: "delivery",
					bindingId: command.bindingId,
					query: command.query,
					delivery: "initial",
					payload: options.result
						? options.result(id, request)
						: id === firstId
							? null
							: { id, title: "Current live task", updatedAt: time },
					resetReason: null,
					resumeToken: `tracer-${++token}`,
				});
			}
			if (command.command === "close") {
				activeBindings.delete(command.bindingId);
				closes.push(command.bindingId);
			}
			return new Response(null, { status: 202 });
		},
	};
}
