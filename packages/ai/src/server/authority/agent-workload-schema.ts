import { z } from "zod";

import type {
	AgentWorkloadAuthorityRecord,
	AgentWorkloadPrincipalClaims,
} from "./agent-workload-types.js";

const identifier = z.string().min(1).max(512);
const stringList = z.array(identifier).max(512);
const runStatus = z.enum([
	"requested",
	"queued",
	"evaluating",
	"working",
	"responding",
	"waiting_for_permission",
	"completed",
	"failed",
	"rejected",
	"timed_out",
	"cancelled",
]);
const activeRunStatus = z.enum([
	"requested",
	"queued",
	"evaluating",
	"working",
	"responding",
	"waiting_for_permission",
]);

const authorityRecordSchema = z.strictObject({
	run: z.strictObject({
		id: identifier,
		attemptId: identifier,
		workRequestId: identifier,
		companyId: identifier,
		anchorSpaceId: identifier,
		agentActorId: identifier,
		requesterActorId: identifier,
		status: runStatus,
		rootRunId: identifier,
		parentRunId: identifier.nullable(),
		delegationDepth: z.number().int().nonnegative(),
		lineageFingerprint: identifier,
		grantEpoch: z.number().int().nonnegative(),
		revocationEpoch: z.number().int().nonnegative(),
	}),
	agent: z.strictObject({
		actorId: identifier,
		companyId: identifier,
		status: z.enum(["active", "inactive", "suspended", "archived"]),
	}),
	requesterActorId: identifier,
	company: z.strictObject({
		id: identifier,
		membershipActorId: identifier,
		status: z.enum(["active", "archived"]),
		membershipStatus: z.enum(["active", "suspended", "archived", "missing"]),
	}),
	anchorSpace: z.strictObject({
		id: identifier,
		companyId: identifier,
		membershipActorId: identifier,
		status: z.enum(["active", "archived"]),
		membershipStatus: z.enum(["active", "suspended", "archived", "missing"]),
	}),
	policies: z.strictObject({
		skillRevisionId: identifier,
		skillAgentActorId: identifier,
		skillStatus: z.enum(["active", "missing", "archived", "incompatible"]),
		requestPolicyRevisionId: identifier,
		requestPolicyAgentActorId: identifier,
		requestPolicyStatus: z.enum(["active", "missing", "archived"]),
		executionPolicyRevisionId: identifier,
		executionPolicyAgentActorId: identifier,
		executionPolicyStatus: z.enum(["active", "missing", "archived"]),
	}),
	grants: z.strictObject({
		company: stringList,
		anchorSpace: stringList,
	}),
	capabilities: z.strictObject({
		tools: stringList,
		effects: stringList,
	}),
	execution: z.strictObject({
		providerConnectionId: identifier,
		providerConnectionRevision: identifier,
		modelOfferingId: identifier,
		runtime: identifier,
		workMachineId: identifier,
		workerId: identifier,
		workerCapabilitiesRevision: identifier,
		workerStatus: z.enum(["online", "busy", "draining", "offline", "revoked"]),
		workerLeaseId: identifier,
		workerLeaseRunId: identifier,
		workerLeaseAttemptId: identifier,
		workerLeaseWorkerId: identifier,
		workerLeaseEpoch: z.number().int().nonnegative(),
		workerLeaseExpiresAt: identifier,
		currentWorkerLeaseId: identifier,
		currentWorkerLeaseEpoch: z.number().int().nonnegative(),
		workerLeaseStatus: z.enum(["active", "expired", "released"]),
		workerSupportsRuntime: z.boolean(),
	}),
	currentEpochs: z.strictObject({
		grant: z.number().int().nonnegative(),
		revocation: z.number().int().nonnegative(),
	}),
});

const principalClaimsSchema = z.strictObject({
	kind: z.literal("agent_workload"),
	schemaVersion: z.literal(1),
	principalId: identifier,
	audience: z.enum(["mcp", "sandbox", "executor", "effect", "projection"]),
	run: z.strictObject({
		id: identifier,
		attemptId: identifier,
		workRequestId: identifier,
		status: activeRunStatus,
		rootRunId: identifier,
		parentRunId: identifier.nullable(),
		delegationDepth: z.number().int().nonnegative().max(3),
		lineageFingerprint: identifier,
	}),
	attribution: z.strictObject({
		agentActorId: identifier,
		requesterActorId: identifier,
	}),
	scope: z.strictObject({
		companyId: identifier,
		anchorSpaceId: identifier,
	}),
	policies: z.strictObject({
		skillRevisionId: identifier,
		requestPolicyRevisionId: identifier,
		executionPolicyRevisionId: identifier,
	}),
	grants: z.strictObject({
		company: stringList,
		anchorSpace: stringList,
	}),
	capabilities: z.strictObject({
		tools: stringList,
		effects: stringList,
	}),
	execution: z.strictObject({
		providerConnectionId: identifier,
		providerConnectionRevision: identifier,
		modelOfferingId: identifier,
		runtime: identifier,
		workMachineId: identifier,
		workerId: identifier,
		workerCapabilitiesRevision: identifier,
		workerLeaseId: identifier,
		workerLeaseEpoch: z.number().int().nonnegative(),
		workerLeaseExpiresAt: identifier,
	}),
	disclosure: z.strictObject({
		mode: z.literal("anchor_space"),
		anchorSpaceId: identifier,
	}),
	epochs: z.strictObject({
		grant: z.number().int().nonnegative(),
		revocation: z.number().int().nonnegative(),
	}),
	issuedAt: identifier,
	expiresAt: identifier,
});

export function parseAgentWorkloadAuthorityRecord(
	input: unknown,
): AgentWorkloadAuthorityRecord | null {
	const parsed = authorityRecordSchema.safeParse(input);
	return parsed.success ? parsed.data : null;
}

export function parseAgentWorkloadPrincipalClaims(
	input: unknown,
): AgentWorkloadPrincipalClaims | null {
	const parsed = principalClaimsSchema.safeParse(input);
	return parsed.success ? parsed.data : null;
}
