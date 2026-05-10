import { describe, expect, it } from "vitest";

import {
	snakeDeviceId,
	snakeWorkerId,
	toLegacyClaimResponse,
	toLegacyEnrollmentResponse,
	toLegacyJoinTokenResponse,
	toLegacyRunStatus,
	ttlSeconds,
} from "../lib/legacy-worker-contract";

describe("legacy worker contract helpers", () => {
	it("accepts snake_case and camelCase worker identifiers", () => {
		expect(snakeWorkerId({ worker_id: "worker-snake" })).toBe("worker-snake");
		expect(snakeWorkerId({ workerId: "worker-camel" })).toBe("worker-camel");
		expect(snakeDeviceId({ device_id: "device-snake" })).toBe("device-snake");
		expect(snakeDeviceId({ deviceId: "device-camel" })).toBe("device-camel");
		expect(ttlSeconds({ ttl_seconds: 3600 })).toBe(3600);
		expect(ttlSeconds({ ttlSeconds: 7200 })).toBe(7200);
	});

	it("returns old enrollment response shape", () => {
		expect(
			toLegacyEnrollmentResponse({
				workerId: "worker-1",
				machineSecret: "secret-1",
			}),
		).toEqual({
			worker_id: "worker-1",
			machine_secret: "secret-1",
		});
	});

	it("returns old join token response shape", () => {
		expect(
			toLegacyJoinTokenResponse({
				tokenId: "token-1",
				secret: "join-secret",
				expiresAt: new Date("2026-05-07T12:00:00.000Z"),
			}),
		).toEqual({
			token_id: "token-1",
			secret: "join-secret",
			expires_at: "2026-05-07T12:00:00.000Z",
		});
	});

	it("formats claim payloads for the existing daemon", () => {
		expect(
			toLegacyClaimResponse({
				leaseId: "lease-1",
				payload: {
					id: "run-1",
					taskId: "task-1",
					projectId: "project-1",
					status: "claimed",
					runtime: "codex",
					modelId: "gpt-5.3-codex",
					providerId: "provider-1",
					capabilityId: "capability-1",
					instructions: "Do the task",
					runtimeSessionRef: "session-1",
					resumedFromRunId: "run-0",
					taskTitle: "Implement",
					taskDescription: "Details",
					targeting: {
						runtimeHints: {
							workspace_mode: "none",
							parent_branch: "main",
						},
						actions: [{ type: "webhook" }],
						secret_refs: [{ name: "TOKEN" }],
						injected_context: { notes: "hello" },
						context_hints: [{ type: "knowledge", path: "docs/a.md" }],
					},
				},
			}),
		).toEqual({
			lease_id: "lease-1",
			run: expect.objectContaining({
				id: "run-1",
				agent_id: "capability-1",
				task_id: "task-1",
				project_id: "project-1",
				runtime: "codex",
				model: "gpt-5.3-codex",
				provider: "provider-1",
				instructions: "Do the task",
				runtime_session_ref: "session-1",
				resumed_from_run_id: "run-0",
				task_title: "Implement",
				task_description: "Details",
				workspace_mode: "none",
				parent_branch: "main",
				actions: [{ type: "webhook" }],
				secret_refs: [{ name: "TOKEN" }],
				injected_context: { notes: "hello" },
				context_hints: [{ type: "knowledge", path: "docs/a.md" }],
			}),
		});
	});

	it("formats run status payloads for old worker cleanup reads", () => {
		expect(
			toLegacyRunStatus({
				id: "run-1",
				status: "completed",
				task: { id: "task-1" },
				project: "project-1",
				worker: { id: "worker-1" },
			}),
		).toMatchObject({
			id: "run-1",
			status: "completed",
			task_id: "task-1",
			project_id: "project-1",
			worker_id: "worker-1",
		});
	});
});
