import { route } from "questpie/services";

import { sessionOnly } from "../lib/route-access";

function sse(event: string, data: unknown) {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default route()
	.get()
	.access(sessionOnly)
	.raw()
	.handler(async ({ request, collections, realtime }) => {
		const url = new URL(request.url);
		const runId =
			url.searchParams.get("runId") ?? url.searchParams.get("run_id");
		if (!runId) {
			return Response.json({ error: "runId is required" }, { status: 400 });
		}

		let cleanupStream: (() => void) | null = null;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				let closed = false;
				let refreshInFlight = false;
				let refreshQueued = false;
				let heartbeat: ReturnType<typeof setInterval> | null = null;
				let unsubscribeRun: (() => void) | null = null;

				const cleanup = () => {
					if (closed) return false;
					closed = true;
					if (heartbeat) clearInterval(heartbeat);
					unsubscribeRun?.();
					return true;
				};
				cleanupStream = () => {
					cleanup();
				};

				const write = (event: string, data: unknown) => {
					if (closed) return;
					controller.enqueue(encoder.encode(sse(event, data)));
				};

				const close = () => {
					if (!cleanup()) return;
					try {
						controller.close();
					} catch {
						// The consumer may already have cancelled the stream.
					}
				};

				const refresh = async () => {
					if (closed) return;
					if (refreshInFlight) {
						refreshQueued = true;
						return;
					}
					refreshInFlight = true;

					try {
						const run = await collections.run_links.findOne({
							where: { id: runId },
						});
						if (!run) {
							write("stream_error", { error: "run not found" });
							return;
						}

						write("run", { type: "run", run });
					} catch (error) {
						write("stream_error", {
							error: error instanceof Error ? error.message : String(error),
						});
					} finally {
						refreshInFlight = false;
						if (refreshQueued) {
							refreshQueued = false;
							void refresh();
						}
					}
				};

				write("heartbeat", { type: "heartbeat", ts: new Date().toISOString() });
				void refresh();

				unsubscribeRun = realtime.subscribe(() => void refresh(), {
					resourceType: "collection",
					resource: "run_links",
					where: { id: runId },
				});

				heartbeat = setInterval(() => {
					write("heartbeat", {
						type: "heartbeat",
						ts: new Date().toISOString(),
					});
				}, 30000);

				request.signal.addEventListener("abort", close);
			},
			cancel() {
				cleanupStream?.();
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});
