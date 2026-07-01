import {
	createQuestpieResumableStreamStore,
	finalizeRun,
	type FinalizeRunDeps,
} from "@questpie/ai/harness-core";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];
const POLL_INTERVAL_MS = 250;

function isTerminal(status: unknown): boolean {
	return typeof status === "string" && TERMINAL_STATUSES.includes(status);
}

interface RunStreamContext {
	request: Request;
	// Loosely typed (autopilot collections/services/workflows); the tail only
	// touches run_links + chat_messages, and finalizeRun's deps are optional.
	collections: {
		run_links: {
			findOne(args: {
				where: unknown;
			}): Promise<Record<string, unknown> | null | undefined>;
			update(args: {
				where: unknown;
				data: Record<string, unknown>;
			}): Promise<unknown>;
		};
		chat_messages?: { create(data: Record<string, unknown>): Promise<unknown> };
	};
	kv: unknown;
	services?: { knowledgeResource?: FinalizeRunDeps["knowledgeResource"] };
	workflows?: FinalizeRunDeps["workflows"];
	runId: string;
}

function resolveOffset(request: Request): number {
	const lastEventId = request.headers.get("Last-Event-ID");
	if (lastEventId) return Number.parseInt(lastEventId, 10) || 0;
	const offsetParam = new URL(request.url).searchParams.get("offset");
	return offsetParam ? Number.parseInt(offsetParam, 10) || 0 : 0;
}

/**
 * The single stream tail (§3.11): inline liveness → contiguity-safe SSE, framed
 * exactly ONCE (`id:{seq}\ndata:{json}\n\n`), closing on `:done` / terminal
 * run status / `event: expired`. `204` when there is no stream or it is drained.
 * Shared by GET /api/runs/{id}/stream and the flag-on chat wrapper.
 */
export async function createRunStreamResponse(
	ctx: RunStreamContext,
): Promise<Response> {
	const { request, collections, runId } = ctx;
	const kv = ctx.kv as Parameters<
		typeof createQuestpieResumableStreamStore
	>[0]["kv"];
	const store = createQuestpieResumableStreamStore({ kv });

	let run = await collections.run_links.findOne({ where: { id: runId } });
	if (!run) return new Response(null, { status: 204 });

	// Inline liveness (§3.8 mech.3): a claimed/running row whose lease expired is
	// failed inline on the next reader hit (bounds orphan latency to ~lease-TTL
	// for interactive runs). finalizeRun's latch keeps this exactly-once.
	const lease =
		run.producerLease && typeof run.producerLease === "object"
			? (run.producerLease as Record<string, unknown>)
			: null;
	const leaseExpired =
		lease &&
		typeof lease.expiresAt === "string" &&
		new Date(lease.expiresAt).getTime() < Date.now();
	if (
		(run.status === "claimed" || run.status === "running") &&
		leaseExpired
	) {
		const finalizeDeps: FinalizeRunDeps = {
			collections,
			streamStore: store,
			workflows: ctx.workflows,
			knowledgeResource: ctx.services?.knowledgeResource,
		};
		await finalizeRun(finalizeDeps, {
			runId,
			kind: typeof run.kind === "string" ? run.kind : null,
			terminal: "failed",
			epoch: typeof lease.epoch === "number" ? lease.epoch : 0,
			error: "worker lease expired",
			activeStreamId:
				typeof run.activeStreamId === "string"
					? run.activeStreamId
					: undefined,
		}).catch(() => {});
		run = await collections.run_links.findOne({ where: { id: runId } });
	}

	const activeStreamId =
		typeof run?.activeStreamId === "string" ? run.activeStreamId.trim() : "";
	if (!activeStreamId) return new Response(null, { status: 204 });

	const fromOffset = resolveOffset(request);
	const initial = await store.readFrom(activeStreamId, fromOffset);
	const finished = await store.isFinished(activeStreamId);
	if (finished && initial.chunks.length === 0 && !initial.gap) {
		return new Response(null, { status: 204 });
	}

	const encoder = new TextEncoder();
	let offset = fromOffset;
	let closed = false;
	const frame = (
		controller: ReadableStreamDefaultController<Uint8Array>,
		chunks: string[],
		base: number,
	) => {
		chunks.forEach((json, index) => {
			controller.enqueue(
				encoder.encode(`id: ${base + index}\ndata: ${json}\n\n`),
			);
		});
	};

	const stream = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (closed) return;
			if (request.signal.aborted) {
				closed = true;
				controller.close();
				return;
			}
			const { chunks, nextOffset, gap } = await store.readFrom(
				activeStreamId,
				offset,
			);
			if (gap) {
				// Requested offset below the TTL-expired floor — signal + close so
				// the FE falls back to persisted parts rather than a torn message.
				controller.enqueue(encoder.encode("event: expired\ndata: {}\n\n"));
				closed = true;
				controller.close();
				return;
			}
			frame(controller, chunks, offset);
			offset = nextOffset; // true index span, not += chunks.length

			const done = await store.isFinished(activeStreamId);
			const current = await collections.run_links.findOne({
				where: { id: runId },
			});
			if (done || isTerminal(current?.status)) {
				const tail = await store.readFrom(activeStreamId, offset);
				if (!tail.gap) frame(controller, tail.chunks, offset);
				controller.enqueue(encoder.encode("data: [DONE]\n\n"));
				closed = true;
				controller.close();
				return;
			}
			if (chunks.length === 0) {
				await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			}
		},
		cancel() {
			closed = true;
		},
	});

	request.signal.addEventListener("abort", () => {
		closed = true;
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
