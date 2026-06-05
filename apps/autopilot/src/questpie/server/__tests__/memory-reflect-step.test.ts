import { describe, expect, it, vi } from "vitest";

import {
	noopReflect,
	type ReflectStepCollections,
	runReflectionStep,
} from "../lib/memory-reflect-step";
import type { ReflectFn, ReflectionInput } from "../lib/memory-reflection";

function reflectionInput(): ReflectionInput {
	return {
		instructions: "Build X",
		summary: "built X",
		outcome: "completed",
		scope: { projectId: null, taskId: null },
	};
}

/** Collections double: gate (memory_settings) + write (agent_memory). */
function fakeCollections(opts: {
	agentMayWrite?: boolean | null;
	existingHashes?: Set<string>;
}): ReflectStepCollections & { created: Array<Record<string, unknown>> } {
	const created: Array<Record<string, unknown>> = [];
	const existing = opts.existingHashes ?? new Set<string>();
	return {
		created,
		memory_settings: {
			findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
				where.scopeType === "company"
					? { agentMayWrite: opts.agentMayWrite ?? true }
					: null,
			),
		},
		agent_memory: {
			findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
				existing.has(String(where.contentHash))
					? { id: "existing" }
					: null,
			),
			create: vi.fn(async (data: Record<string, unknown>) => {
				created.push(data);
				return { id: `new-${created.length}` };
			}),
		},
	};
}

describe("runReflectionStep", () => {
	it("SKIPS the write entirely when the scope toggle is off", async () => {
		const collections = fakeCollections({ agentMayWrite: false });
		const reflect = vi.fn(noopReflect);
		const result = await runReflectionStep(collections, {
			runId: "r1",
			input: reflectionInput(),
			scope: { projectId: null, taskId: null },
			reflect,
		});
		expect(result.skipped).toBe(true);
		expect(result.written).toBe(0);
		// The model boundary is not even invoked when writes are disabled.
		expect(reflect).not.toHaveBeenCalled();
	});

	it("writes gated candidates when allowed", async () => {
		const collections = fakeCollections({ agentMayWrite: true });
		const reflect: ReflectFn = async () => [
			{ content: "durable lesson", importance: 8, scopeType: "company" },
		];
		const result = await runReflectionStep(collections, {
			runId: "r2",
			input: reflectionInput(),
			scope: { projectId: null, taskId: null },
			reflect,
		});
		expect(result.skipped).toBe(false);
		expect(result.written).toBe(1);
		expect(collections.created[0]).toMatchObject({
			content: "durable lesson",
			sourceRun: "r2",
		});
	});

	it("the default noopReflect writes nothing (the not-yet-wired model boundary)", async () => {
		const collections = fakeCollections({ agentMayWrite: true });
		const result = await runReflectionStep(collections, {
			runId: "r3",
			input: reflectionInput(),
			scope: { projectId: null, taskId: null },
		});
		expect(result.written).toBe(0);
		expect(collections.created).toHaveLength(0);
	});

	it("never throws when the model boundary throws (off-path enrichment)", async () => {
		const collections = fakeCollections({ agentMayWrite: true });
		const reflect: ReflectFn = async () => {
			throw new Error("model exploded");
		};
		const warn = vi.fn();
		const result = await runReflectionStep(collections, {
			runId: "r4",
			input: reflectionInput(),
			scope: { projectId: null, taskId: null },
			reflect,
			log: { warn },
		});
		expect(result.written).toBe(0);
		expect(result.skipped).toBe(false);
		expect(warn).toHaveBeenCalled();
	});
});
