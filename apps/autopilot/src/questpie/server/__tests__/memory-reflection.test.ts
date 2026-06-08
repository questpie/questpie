import { describe, expect, it, vi } from "vitest";

import {
	buildReflectionPrompt,
	gateCandidates,
	MAX_CANDIDATES_PER_RUN,
	memoryContentHash,
	MIN_IMPORTANCE,
	parseReflectionResponse,
	type RawMemoryCandidate,
	reflectAndWrite,
	type ReflectFn,
	type ReflectionInput,
} from "../lib/memory-reflection";

function input(overrides: Partial<ReflectionInput> = {}): ReflectionInput {
	return {
		instructions: "Build a social scheduler",
		summary: "Built it; learned Twitter rate-limits bursts.",
		outcome: "completed",
		scope: { projectId: null, taskId: null },
		...overrides,
	};
}

describe("buildReflectionPrompt", () => {
	it("includes the outcome, instructions, and summary", () => {
		const prompt = buildReflectionPrompt(
			input({ outcome: "failed", error: "boom" }),
		);
		expect(prompt).toContain("The run FAILED: boom");
		expect(prompt).toContain("INSTRUCTIONS: Build a social scheduler");
		expect(prompt).toContain("SUMMARY:");
		expect(prompt).toContain("JSON array");
	});
});

describe("parseReflectionResponse — tolerant JSON-array extraction", () => {
	it("parses a bare JSON array", () => {
		const out = parseReflectionResponse('[{"content":"x","importance":5}]');
		expect(out).toEqual([{ content: "x", importance: 5 }]);
	});

	it("extracts the array from a ```json fenced / prose-wrapped reply", () => {
		const out = parseReflectionResponse(
			'Here you go:\n```json\n[{"content":"y","importance":7}]\n```\nDone.',
		);
		expect(out).toEqual([{ content: "y", importance: 7 }]);
	});

	it("returns [] on malformed / non-array / empty input (fail-safe)", () => {
		expect(parseReflectionResponse("not json")).toEqual([]);
		expect(parseReflectionResponse('{"content":"x"}')).toEqual([]);
		expect(parseReflectionResponse("")).toEqual([]);
		expect(parseReflectionResponse("[ broken")).toEqual([]);
	});
});

describe("memoryContentHash — stable + scope-keyed", () => {
	it("is stable across whitespace/case differences in content", () => {
		const a = memoryContentHash("Stagger Posts  >=15s", "company", null);
		const b = memoryContentHash("stagger posts >=15s", "company", null);
		expect(a).toBe(b);
	});

	it("differs by scope (same lesson at company vs project is distinct)", () => {
		const company = memoryContentHash("x", "company", null);
		const project = memoryContentHash("x", "project", "p1");
		expect(company).not.toBe(project);
	});
});

describe("gateCandidates — importance gate + scope + dedupe", () => {
	it(`drops candidates below importance ${MIN_IMPORTANCE} (the trivial-run gate)`, () => {
		const raw: RawMemoryCandidate[] = [
			{ content: "keep", importance: MIN_IMPORTANCE, scopeType: "company" },
			{ content: "drop", importance: MIN_IMPORTANCE - 1, scopeType: "company" },
		];
		const out = gateCandidates(raw, input());
		expect(out.map((c) => c.content)).toEqual(["keep"]);
	});

	it("drops empty-content candidates", () => {
		const out = gateCandidates(
			[{ content: "   ", importance: 9 }, { content: "ok", importance: 9 }],
			input(),
		);
		expect(out.map((c) => c.content)).toEqual(["ok"]);
	});

	it("down-scopes a task/project candidate when the run lacks that id", () => {
		// Declared task scope, but the run has neither task nor project → company.
		const out = gateCandidates(
			[{ content: "x", importance: 8, scopeType: "task" }],
			input({ scope: { projectId: null, taskId: null } }),
		);
		expect(out[0].scopeType).toBe("company");
		expect(out[0].scopeRef).toBeNull();
	});

	it("honors a declared task scope when the run HAS a task id", () => {
		const out = gateCandidates(
			[{ content: "x", importance: 8, scopeType: "task" }],
			input({ scope: { projectId: "p1", taskId: "t1" } }),
		);
		expect(out[0].scopeType).toBe("task");
		expect(out[0].scopeRef).toBe("t1");
	});

	it("falls back project→company when a task candidate has only a project id", () => {
		const out = gateCandidates(
			[{ content: "x", importance: 8, scopeType: "task" }],
			input({ scope: { projectId: "p1", taskId: null } }),
		);
		expect(out[0].scopeType).toBe("project");
		expect(out[0].scopeRef).toBe("p1");
	});

	it("normalizes invalid type to episodic and clamps importance to 1-10", () => {
		const out = gateCandidates(
			[{ content: "x", importance: 99, type: "bogus", scopeType: "company" }],
			input(),
		);
		expect(out[0].type).toBe("episodic");
		expect(out[0].importance).toBe(10);
	});

	it("de-duplicates identical lessons WITHIN the batch by contentHash", () => {
		const out = gateCandidates(
			[
				{ content: "same lesson", importance: 8, scopeType: "company" },
				{ content: "SAME   lesson", importance: 9, scopeType: "company" },
			],
			input(),
		);
		expect(out).toHaveLength(1);
	});

	it(`caps at ${MAX_CANDIDATES_PER_RUN} candidates`, () => {
		const raw = Array.from({ length: 10 }, (_v, i) => ({
			content: `lesson ${i}`,
			importance: 8,
			scopeType: "company",
		}));
		const out = gateCandidates(raw, input());
		expect(out).toHaveLength(MAX_CANDIDATES_PER_RUN);
	});

	it("stamps source=reflection + status=active + a contentHash", () => {
		const out = gateCandidates(
			[{ content: "x", importance: 8, scopeType: "company" }],
			input(),
		);
		expect(out[0].source).toBe("reflection");
		expect(out[0].status).toBe("active");
		expect(out[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe("reflectAndWrite — reflect → gate → persist (dedupe across runs)", () => {
	function writeCollections(existing: Record<string, boolean> = {}) {
		const created: Array<Record<string, unknown>> = [];
		return {
			created,
			collections: {
				agent_memory: {
					findOne: vi.fn(
						async ({ where }: { where: Record<string, unknown> }) => {
							const hash = String(where.contentHash);
							return existing[hash] ? { id: `existing-${hash}` } : null;
						},
					),
					create: vi.fn(async (data: Record<string, unknown>) => {
						created.push(data);
						return { id: `new-${created.length}` };
					}),
				},
			},
		};
	}

	it("writes gated candidates, stamping sourceRun provenance", async () => {
		const reflect: ReflectFn = async () => [
			{ content: "stagger posts >=15s", importance: 8, scopeType: "company" },
		];
		const { collections, created } = writeCollections();
		const result = await reflectAndWrite(reflect, collections, input(), "run-1");

		expect(result.written).toBe(1);
		expect(result.skippedDuplicates).toBe(0);
		expect(created[0]).toMatchObject({
			content: "stagger posts >=15s",
			importance: 8,
			scopeType: "company",
			source: "reflection",
			status: "active",
			sourceRun: "run-1",
		});
	});

	it("skips a candidate whose (scope, contentHash) already exists (cross-run dedupe)", async () => {
		const hash = memoryContentHash("known lesson", "company", null);
		const reflect: ReflectFn = async () => [
			{ content: "known lesson", importance: 8, scopeType: "company" },
		];
		const { collections, created } = writeCollections({ [hash]: true });
		const result = await reflectAndWrite(reflect, collections, input(), "run-2");

		expect(result.written).toBe(0);
		expect(result.skippedDuplicates).toBe(1);
		expect(created).toHaveLength(0);
	});

	it("writes nothing when the model emits an empty array (trivial run)", async () => {
		const reflect: ReflectFn = async () => [];
		const { collections, created } = writeCollections();
		const result = await reflectAndWrite(reflect, collections, input(), "run-3");
		expect(result.written).toBe(0);
		expect(created).toHaveLength(0);
	});

	it("writes nothing when all candidates fail the importance gate", async () => {
		const reflect: ReflectFn = async () => [
			{ content: "trivial", importance: 1, scopeType: "company" },
		];
		const { collections, created } = writeCollections();
		const result = await reflectAndWrite(reflect, collections, input(), "run-4");
		expect(result.written).toBe(0);
		expect(created).toHaveLength(0);
	});
});
