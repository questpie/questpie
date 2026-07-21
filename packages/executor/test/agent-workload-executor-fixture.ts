import {
	createAuthenticatedAgentWorkloadTransport,
	type AgentWorkloadAuthorityRecord,
	type AgentWorkloadAuthorityStore,
	createAgentWorkloadPrincipalResolver,
} from "@questpie/ai";

import {
	activeAuthority,
	authoritySnapshot,
} from "../../ai/src/__tests__/agent-workload-fixture.js";
import { createAgentWorkloadExecutorBoundary } from "../src/exports/index.js";

export const EXECUTOR_NOW = new Date("2026-07-19T09:00:00.000Z");
export const EXECUTOR_TRANSPORT_SECRET = new TextEncoder().encode(
	"hreben-executor-workload-transport-key-32-bytes-minimum",
);

export function createExecutorFixture(
	initialRecord: AgentWorkloadAuthorityRecord = activeAuthority(),
) {
	let record = initialRecord;
	let reads = 0;
	let now = EXECUTOR_NOW;
	const authorityStore: AgentWorkloadAuthorityStore = {
		async loadFreshConsistentAuthority() {
			reads += 1;
			return authoritySnapshot(record);
		},
	};
	const resolver = createAgentWorkloadPrincipalResolver({
		audience: "executor",
		authorityStore,
		now: () => now,
		principalId: () => "principal_executor_fixture",
	});
	const transport = createAuthenticatedAgentWorkloadTransport({
		keyId: "executor-control-plane-v1",
		secret: EXECUTOR_TRANSPORT_SECRET,
	});
	const boundary = createAgentWorkloadExecutorBoundary({ resolver, transport });
	const fence = {
		runId: "run_marketing_launch",
		attemptId: "attempt_01",
		workerId: "worker_embedded_01",
		leaseId: "lease_run_marketing_launch",
		leaseEpoch: 11,
	} as const;

	return {
		boundary,
		fence,
		resolver,
		transport,
		reads: () => reads,
		resetReads: () => {
			reads = 0;
		},
		setRecord: (next: AgentWorkloadAuthorityRecord) => {
			record = next;
		},
		setNow: (next: Date) => {
			now = next;
		},
	};
}
