import { describe, expect, it, vi } from "vitest";

import { createAiRunLink } from "../lib/ai-run-links";

// T2: createRunLink evolves — accept kind/retryPolicy, mint activeStreamId up
// front, enqueue the run-available kick. Fully mocked ctx (no DB).
describe("createAiRunLink (T2)", () => {
	it("mints activeStreamId, persists kind/retryPolicy as pending, and enqueues the run-available kick", async () => {
		const create = vi.fn(async (data: Record<string, unknown>) => ({
			...data,
		}));
		const publish = vi.fn(async () => {});
		const ctx = {
			collections: { run_links: { create } },
			queue: { runAvailable: { publish } },
		} as any;

		const row = await createAiRunLink({
			ctx,
			runtime: {
				runtime: "claude-code",
				providerId: null,
				modelId: null,
			} as any,
			initiatedBy: "chat",
			instructions: "hi",
			kind: "chat",
			retryPolicy: "auto",
		});

		expect(create).toHaveBeenCalledTimes(1);
		const payload = create.mock.calls[0][0] as Record<string, unknown>;
		expect(payload.status).toBe("pending");
		expect(payload.kind).toBe("chat");
		expect(payload.retryPolicy).toBe("auto");
		expect(payload.activeStreamId).toMatch(/^run-stream:/);
		expect(payload.aiRun).toBeUndefined();

		// The minted stream id flows through to the returned row — this is what
		// lets the enqueue site address the stream without a separate return shape.
		expect(row.activeStreamId).toBe(payload.activeStreamId);

		expect(publish).toHaveBeenCalledTimes(1);
		expect(publish.mock.calls[0][0]).toEqual({ runtime: "claude-code" });
	});

	it("defaults retryPolicy to 'none' and still enqueues the kick when kind is omitted", async () => {
		const create = vi.fn(async (data: Record<string, unknown>) => ({
			...data,
		}));
		const publish = vi.fn(async () => {});
		const ctx = {
			collections: { run_links: { create } },
			queue: { runAvailable: { publish } },
		} as any;

		await createAiRunLink({
			ctx,
			runtime: { runtime: "codex" } as any,
			initiatedBy: "task",
			instructions: "x",
		});

		const payload = create.mock.calls[0][0] as Record<string, unknown>;
		expect(payload.retryPolicy).toBe("none");
		expect(payload.kind).toBeUndefined();
		expect(payload.activeStreamId).toMatch(/^run-stream:/);
		expect(publish).toHaveBeenCalledOnce();
		expect(publish.mock.calls[0][0]).toEqual({ runtime: "codex" });
	});

	it("does not let a failed kick fail run creation", async () => {
		const create = vi.fn(async (data: Record<string, unknown>) => ({
			...data,
		}));
		const publish = vi.fn(async () => {
			throw new Error("queue down");
		});
		const ctx = {
			collections: { run_links: { create } },
			queue: { runAvailable: { publish } },
		} as any;

		// Must resolve to the created row despite the kick throwing.
		const row = await createAiRunLink({
			ctx,
			runtime: { runtime: "claude-code" } as any,
			initiatedBy: "mcp",
			instructions: "y",
			kind: "mcp",
		});

		expect(row.status).toBe("pending");
		expect(create).toHaveBeenCalledTimes(1);
		expect(publish).toHaveBeenCalledTimes(1);
	});
});
