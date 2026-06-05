import { describe, expect, it, vi } from "vitest";

import {
	agentMayWriteMemory,
	type MemorySettingsCollections,
} from "../lib/memory-gate";

/**
 * A `memory_settings.findOne` double. `rows` maps a JSON-stringified `where` to the
 * row that exists for it (absent key ⇒ no row ⇒ that tier is skipped).
 */
function fakeSettings(
	rows: Record<string, { agentMayWrite?: boolean | null }>,
): MemorySettingsCollections & { calls: Array<Record<string, unknown>> } {
	const calls: Array<Record<string, unknown>> = [];
	return {
		calls,
		memory_settings: {
			findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
				calls.push(where);
				return rows[JSON.stringify(where)] ?? null;
			}),
		},
	};
}

describe("agentMayWriteMemory — most-specific-first, default-allow", () => {
	it("defaults to ALLOWED when no setting exists anywhere", async () => {
		const settings = fakeSettings({});
		const allowed = await agentMayWriteMemory(settings, {
			projectId: "p1",
			taskId: "t1",
		});
		expect(allowed).toBe(true);
	});

	it("a company-scope disable blocks when no more-specific row exists", async () => {
		const settings = fakeSettings({
			[JSON.stringify({ scopeType: "company" })]: { agentMayWrite: false },
		});
		const allowed = await agentMayWriteMemory(settings, {});
		expect(allowed).toBe(false);
	});

	it("a task-scope row OVERRIDES a company disable (most-specific wins)", async () => {
		const settings = fakeSettings({
			[JSON.stringify({ scopeType: "company" })]: { agentMayWrite: false },
			[JSON.stringify({ scopeType: "task", scopeRef: "t1" })]: {
				agentMayWrite: true,
			},
		});
		const allowed = await agentMayWriteMemory(settings, {
			projectId: "p1",
			taskId: "t1",
		});
		expect(allowed).toBe(true);
	});

	it("a project-scope disable blocks when no task row exists", async () => {
		const settings = fakeSettings({
			[JSON.stringify({ scopeType: "project", scopeRef: "p1" })]: {
				agentMayWrite: false,
			},
		});
		const allowed = await agentMayWriteMemory(settings, {
			projectId: "p1",
			taskId: "t1",
		});
		expect(allowed).toBe(false);
	});

	it("checks task → project → company in order, stopping at the first hit", async () => {
		const settings = fakeSettings({
			[JSON.stringify({ scopeType: "project", scopeRef: "p1" })]: {
				agentMayWrite: true,
			},
		});
		await agentMayWriteMemory(settings, { projectId: "p1", taskId: "t1" });
		// task is checked first (miss), then project (hit) — company is NOT reached.
		expect(settings.calls).toEqual([
			{ scopeType: "task", scopeRef: "t1" },
			{ scopeType: "project", scopeRef: "p1" },
		]);
	});

	it("treats a null agentMayWrite column on an existing row as allowed", async () => {
		const settings = fakeSettings({
			[JSON.stringify({ scopeType: "company" })]: { agentMayWrite: null },
		});
		const allowed = await agentMayWriteMemory(settings, {});
		expect(allowed).toBe(true);
	});
});
