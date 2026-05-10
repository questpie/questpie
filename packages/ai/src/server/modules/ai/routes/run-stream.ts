import { ApiError, route } from "questpie";

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export default route()
  .get()
  .raw()
  .handler(async ({ request, collections, realtime }: any) => {
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId") ?? url.searchParams.get("run_id");
    if (!runId) {
      throw ApiError.badRequest("runId is required");
    }

    let cleanupStream: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const seenEventIds = new Set<string>();
        let closed = false;
        let refreshInFlight = false;
        let refreshQueued = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        let unsubscribeRun: (() => void) | null = null;
        let unsubscribeRunEvents: (() => void) | null = null;

        const cleanup = () => {
          if (closed) return false;
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsubscribeRun?.();
          unsubscribeRunEvents?.();
          return true;
        };
        cleanupStream = () => cleanup();

        const write = (event: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(sse(event, data)));
        };

        const close = () => {
          if (!cleanup()) return;
          try {
            controller.close();
          } catch {}
        };

        const refresh = async () => {
          if (closed) return;
          if (refreshInFlight) {
            refreshQueued = true;
            return;
          }
          refreshInFlight = true;

          try {
            const run = await collections.ai_runs.findOne({ where: { id: runId } });
            if (!run) {
              write("stream_error", { error: "run not found" });
              return;
            }
            write("run", { type: "run", run });

            const events = await collections.ai_run_events.find({
              where: { run: runId },
              orderBy: { createdAt: "asc" },
              limit: 500,
            });
            for (const event of events.docs) {
              if (seenEventIds.has(event.id)) continue;
              seenEventIds.add(event.id);
              write("run_event", { type: "run_event", event });
            }
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
          resource: "ai_runs",
          where: { id: runId },
        });
        unsubscribeRunEvents = realtime.subscribe(() => void refresh(), {
          resourceType: "collection",
          resource: "ai_run_events",
          where: { run: runId },
        });

        heartbeat = setInterval(() => {
          write("heartbeat", { type: "heartbeat", ts: new Date().toISOString() });
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
