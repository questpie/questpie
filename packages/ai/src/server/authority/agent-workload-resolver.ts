import { randomUUID } from "node:crypto";

import {
	freezeTrustedAgentWorkloadPrincipal,
	isTrustedAgentWorkloadPrincipal,
} from "./agent-workload-brand.js";
import { AgentWorkloadAuthorityError } from "./agent-workload-error.js";
import {
	principalAuthorityFingerprint,
	recordAuthorityFingerprint,
} from "./agent-workload-fingerprint.js";
import {
	loadCurrentAgentWorkloadAuthority,
	type ResolvableAgentWorkloadAuthorityRecord,
} from "./agent-workload-state.js";
import { claimsFromAuthenticatedAgentWorkloadEnvelope } from "./agent-workload-transport.js";
import type {
	AgentWorkloadAudience,
	AgentWorkloadAuthorityStore,
	AgentWorkloadGrantRequirement,
	AgentWorkloadPrincipal,
	AgentWorkloadPrincipalClaims,
	AuthenticatedAgentWorkloadEnvelope,
	ResolveAgentWorkloadPrincipalInput,
} from "./agent-workload-types.js";
import { allowsExactScopedGrant } from "./exact-scope-grants.js";

const DEFAULT_PRINCIPAL_TTL_MS = 5 * 60 * 1000;

export interface AgentWorkloadPrincipalResolverOptions {
	readonly audience: AgentWorkloadAudience;
	readonly authorityStore: AgentWorkloadAuthorityStore;
	readonly now?: () => Date;
	readonly principalId?: () => string;
	readonly ttlMs?: number;
}

export interface AgentWorkloadPrincipalResolver {
	resolve(
		input: ResolveAgentWorkloadPrincipalInput,
	): Promise<AgentWorkloadPrincipal>;
	validate(
		principal: AgentWorkloadPrincipal | AuthenticatedAgentWorkloadEnvelope,
	): Promise<AgentWorkloadPrincipal>;
	hasGrant(
		principal: AgentWorkloadPrincipal,
		requirement: AgentWorkloadGrantRequirement,
	): Promise<boolean>;
}

function freezeStrings(values: readonly string[]): readonly string[] {
	return Object.freeze([...values]);
}

function buildPrincipal(
	record: ResolvableAgentWorkloadAuthorityRecord,
	audience: AgentWorkloadAudience,
	principalId: string,
	issuedAt: Date,
	ttlMs: number,
): AgentWorkloadPrincipal {
	const leaseExpiresAt = new Date(
		record.execution.workerLeaseExpiresAt,
	).getTime();
	const expiresAt = new Date(
		Math.min(issuedAt.getTime() + ttlMs, leaseExpiresAt),
	).toISOString();
	const principal: AgentWorkloadPrincipalClaims = {
		kind: "agent_workload",
		schemaVersion: 1,
		principalId,
		audience,
		run: Object.freeze({
			id: record.run.id,
			attemptId: record.run.attemptId,
			workRequestId: record.run.workRequestId,
			status: record.run.status,
			rootRunId: record.run.rootRunId,
			parentRunId: record.run.parentRunId,
			delegationDepth: record.run.delegationDepth,
			lineageFingerprint: record.run.lineageFingerprint,
		}),
		attribution: Object.freeze({
			agentActorId: record.agent.actorId,
			requesterActorId: record.requesterActorId,
		}),
		scope: Object.freeze({
			companyId: record.company.id,
			anchorSpaceId: record.anchorSpace.id,
		}),
		policies: Object.freeze({
			skillRevisionId: record.policies.skillRevisionId,
			requestPolicyRevisionId: record.policies.requestPolicyRevisionId,
			executionPolicyRevisionId: record.policies.executionPolicyRevisionId,
		}),
		grants: Object.freeze({
			company: freezeStrings(record.grants.company),
			anchorSpace: freezeStrings(record.grants.anchorSpace),
		}),
		capabilities: Object.freeze({
			tools: freezeStrings(record.capabilities.tools),
			effects: freezeStrings(record.capabilities.effects),
		}),
		execution: Object.freeze({
			providerConnectionId: record.execution.providerConnectionId,
			providerConnectionRevision: record.execution.providerConnectionRevision,
			modelOfferingId: record.execution.modelOfferingId,
			runtime: record.execution.runtime,
			workMachineId: record.execution.workMachineId,
			workerId: record.execution.workerId,
			workerCapabilitiesRevision: record.execution.workerCapabilitiesRevision,
			workerLeaseId: record.execution.workerLeaseId,
			workerLeaseEpoch: record.execution.workerLeaseEpoch,
			workerLeaseExpiresAt: record.execution.workerLeaseExpiresAt,
		}),
		disclosure: Object.freeze({
			mode: "anchor_space",
			anchorSpaceId: record.anchorSpace.id,
		}),
		epochs: Object.freeze({
			grant: record.run.grantEpoch,
			revocation: record.run.revocationEpoch,
		}),
		issuedAt: issuedAt.toISOString(),
		expiresAt,
	};

	return freezeTrustedAgentWorkloadPrincipal(principal);
}

function assertPrincipalSemantics(
	principal: AgentWorkloadPrincipalClaims,
	at: Date,
): void {
	const issuedAt = new Date(principal.issuedAt).getTime();
	const expiresAt = new Date(principal.expiresAt).getTime();
	const leaseExpiresAt = new Date(
		principal.execution.workerLeaseExpiresAt,
	).getTime();
	const invalidLineage =
		(principal.run.delegationDepth === 0 &&
			(principal.run.rootRunId !== principal.run.id ||
				principal.run.parentRunId !== null)) ||
		(principal.run.delegationDepth > 0 &&
			(principal.run.parentRunId === null ||
				principal.run.parentRunId === principal.run.id ||
				principal.run.rootRunId === principal.run.id));
	if (
		principal.disclosure.anchorSpaceId !== principal.scope.anchorSpaceId ||
		!Number.isFinite(issuedAt) ||
		!Number.isFinite(expiresAt) ||
		!Number.isFinite(leaseExpiresAt) ||
		issuedAt > at.getTime() ||
		expiresAt <= issuedAt ||
		expiresAt - issuedAt > DEFAULT_PRINCIPAL_TTL_MS ||
		expiresAt > leaseExpiresAt ||
		invalidLineage
	) {
		throw new AgentWorkloadAuthorityError("invalid_principal");
	}
	if (expiresAt <= at.getTime()) {
		throw new AgentWorkloadAuthorityError("principal_expired");
	}
}

function readResolverTime(now: () => Date): Date {
	try {
		const currentTimeMs = now().getTime();
		if (!Number.isFinite(currentTimeMs)) {
			throw new Error("invalid clock");
		}
		return new Date(currentTimeMs);
	} catch {
		throw new AgentWorkloadAuthorityError("invalid_resolver_configuration");
	}
}

function assertResolutionInput(
	input: ResolveAgentWorkloadPrincipalInput,
): asserts input is ResolveAgentWorkloadPrincipalInput {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new AgentWorkloadAuthorityError("invalid_resolution_input");
	}
	const keys = Object.keys(input);
	if (
		keys.length !== 2 ||
		!keys.includes("runId") ||
		!keys.includes("attemptId") ||
		typeof input.runId !== "string" ||
		input.runId.length === 0 ||
		typeof input.attemptId !== "string" ||
		input.attemptId.length === 0
	) {
		throw new AgentWorkloadAuthorityError("invalid_resolution_input");
	}
}

export function createAgentWorkloadPrincipalResolver(
	options: AgentWorkloadPrincipalResolverOptions,
): AgentWorkloadPrincipalResolver {
	const now = options.now ?? (() => new Date());
	const principalId = options.principalId ?? randomUUID;
	const requestedTtlMs = options.ttlMs ?? DEFAULT_PRINCIPAL_TTL_MS;
	const normalizedTtlMs = Math.floor(requestedTtlMs);
	if (!Number.isFinite(requestedTtlMs) || normalizedTtlMs < 1) {
		throw new AgentWorkloadAuthorityError("invalid_resolver_configuration");
	}
	const ttlMs = Math.min(normalizedTtlMs, DEFAULT_PRINCIPAL_TTL_MS);

	const resolver: AgentWorkloadPrincipalResolver = {
		async resolve(input) {
			assertResolutionInput(input);
			const { record, observedAt } = await loadCurrentAgentWorkloadAuthority(
				options.authorityStore,
				input,
				now,
			);
			return buildPrincipal(
				record,
				options.audience,
				principalId(),
				observedAt,
				ttlMs,
			);
		},
		async validate(principal) {
			const claims = isTrustedAgentWorkloadPrincipal(principal)
				? principal
				: claimsFromAuthenticatedAgentWorkloadEnvelope(principal);
			if (!claims) {
				throw new AgentWorkloadAuthorityError("invalid_principal");
			}
			if (claims.audience !== options.audience) {
				throw new AgentWorkloadAuthorityError("principal_wrong_audience");
			}
			assertPrincipalSemantics(claims, readResolverTime(now));
			const { record, observedAt } = await loadCurrentAgentWorkloadAuthority(
				options.authorityStore,
				{ runId: claims.run.id, attemptId: claims.run.attemptId },
				now,
			);
			assertPrincipalSemantics(claims, observedAt);
			if (
				claims.epochs.grant !== record.run.grantEpoch ||
				claims.epochs.revocation !== record.run.revocationEpoch
			) {
				throw new AgentWorkloadAuthorityError("authority_epoch_stale");
			}
			if (
				claims.execution.workerLeaseId !== record.execution.workerLeaseId ||
				claims.execution.workerLeaseEpoch !== record.execution.workerLeaseEpoch
			) {
				throw new AgentWorkloadAuthorityError("worker_lease_stale");
			}
			if (
				principalAuthorityFingerprint(claims) !==
				recordAuthorityFingerprint(record)
			) {
				throw new AgentWorkloadAuthorityError("authority_epoch_stale");
			}
			return isTrustedAgentWorkloadPrincipal(principal)
				? principal
				: freezeTrustedAgentWorkloadPrincipal({ ...claims });
		},
		async hasGrant(principal, requirement) {
			await resolver.validate(principal);
			return allowsExactScopedGrant(principal, requirement);
		},
	};
	return resolver;
}
