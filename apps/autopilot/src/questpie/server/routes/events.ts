import { route } from "questpie/services";

function sse(data: unknown) {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export default route()
	.get()
	.raw()
	.handler(async ({ request, collections }) => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const encoder = new TextEncoder();
				const seenActivity = new Set<string>();
				const seenRuns = new Set<string>();
				let closed = false;

				const write = (data: unknown) => {
					if (!closed) controller.enqueue(encoder.encode(sse(data)));
				};

				const tick = async () => {
					try {
						const [activity, runs] = await Promise.all([
							collections.activity.find({
								orderBy: { createdAt: "desc" },
								limit: 25,
							}),
							collections.runs.find({
								where: { status: { in: ["pending", "claimed", "running"] } },
								orderBy: { updatedAt: "desc" },
								limit: 25,
							}),
						]);

						for (const item of activity.docs.reverse()) {
							if (seenActivity.has(item.id)) continue;
							seenActivity.add(item.id);
							write({ type: "activity", activity: item });
						}
						for (const run of runs.docs.reverse()) {
							const marker = `${run.id}:${run.status}:${String(run.updatedAt)}`;
							if (seenRuns.has(marker)) continue;
							seenRuns.add(marker);
							write({ type: "run", run });
						}
					} catch (error) {
						write({
							type: "error",
							error: error instanceof Error ? error.message : String(error),
						});
					}
				};

				write({ type: "heartbeat", ts: new Date().toISOString() });
				void tick();
				const interval = setInterval(() => {
					write({ type: "heartbeat", ts: new Date().toISOString() });
					void tick();
				}, 5000);

				request.signal.addEventListener("abort", () => {
					closed = true;
					clearInterval(interval);
					controller.close();
				});
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
