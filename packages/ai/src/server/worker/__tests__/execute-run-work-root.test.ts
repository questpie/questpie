import { describe, expect, it } from "bun:test";

import type { QuestpieKVLike } from "../../modules/ai/lib/questpie-resumable-streams.js";
import { executeRun, type ExecuteRunDeps } from "../execute-run.js";

function createTestKV(): QuestpieKVLike {
	const values = new Map<string, unknown>();
	return {
		async get<T>(key: string) {
			return (values.get(key) as T | undefined) ?? null;
		},
		async set(key: string, value: unknown) {
			values.set(key, value);
		},
		async delete(key: string) {
			values.delete(key);
		},
		async has(key: string) {
			return values.has(key);
		},
	};
}

describe("executeRun managed work-root authority", () => {
	it("terminalizes missing app claim authority before harness construction", async () => {
		const row: Record<string, unknown> = {
			id: "run-invalid-workspace",
			kind: "task",
			status: "claimed",
			activeStreamId: "run-stream:invalid-workspace",
			producerLease: { epoch: 1 },
			project: "project-alpha",
			metadata: {
				workspace: {
					volumeId: "vol_worker",
					repoLocator: "repos/project-alpha",
					worktreeLocator: "drafts/draft-alpha",
					projectId: "project-alpha",
					draftId: "draft-alpha",
				},
			},
		};
		let resolverCalls = 0;
		const deps: ExecuteRunDeps = {
			collections: {
				run_links: {
					async update({ data }) {
						Object.assign(row, data);
						return [{ ...row }];
					},
					async findOne() {
						return { ...row };
					},
				},
			},
			kv: createTestKV(),
			workerDir: "/worker-owned-root",
			volumeId: "vol_worker",
			resolveWorkRoot: (_run, authority) => {
				resolverCalls += 1;
				expect(authority).toEqual({
					managedRoot: "/worker-owned-root",
					currentVolumeId: "vol_worker",
				});
				throw new Error("Invalid managed workspace");
			},
		};

		await executeRun(deps, {
			lease: {
				id: "lease-invalid-workspace",
				runId: String(row.id),
				expiresAt: new Date(Date.now() + 60_000),
			},
			spawn: { runtime: "claude-code", prompt: "never runs" },
			run: row,
			epoch: 1,
		});

		expect(resolverCalls).toBe(1);
		expect(row.status).toBe("failed");
		expect(row.error).toBe("Invalid managed workspace");
		expect(row.finalizedAt).toBeInstanceOf(Date);
	});
});
