import {
	AgentWorkloadAuthorityError,
	type AgentWorkloadPrincipal,
	type AgentWorkloadPrincipalResolver,
	type AuthenticatedAgentWorkloadEnvelope,
} from "@questpie/ai";

import {
	authorityInvalidatedEvent,
	capabilityAuthorizedEvent,
	capabilityDenialEvent,
	policyDenialEvent,
	sandboxCreationEvent,
	sandboxPreparationEvent,
	type AgentWorkloadSandboxAuditEvent,
} from "./agent-workload-audit.js";
import {
	allowsAgentWorkloadSandboxCapability,
	type AgentWorkloadSandboxCapabilityRequest,
} from "./agent-workload-capabilities.js";
import { AgentWorkloadSandboxDeniedError } from "./agent-workload-denial.js";
import {
	deriveAgentWorkloadRoot,
	matchesAgentWorkloadSandboxPolicy,
	normalizeAgentWorkloadRootBase,
	snapshotAgentWorkloadSandboxPolicy,
	type AgentWorkloadSandboxPolicy,
} from "./agent-workload-policy.js";

export interface AgentWorkloadSandboxBoundaryOptions {
	readonly resolver: AgentWorkloadPrincipalResolver;
	readonly workRootBase: string;
	readonly policy: AgentWorkloadSandboxPolicy;
	readonly audit?: (
		event: AgentWorkloadSandboxAuditEvent,
	) => void | Promise<void>;
}

export interface AgentWorkloadSandboxContext {
	/** Host-owned root; it is never injected as a host path into guest code. */
	readonly workRoot: string;
	/** Stable guest-visible cwd mounted by the sandbox runtime. */
	readonly cwd: "/work";
	/** Deliberately empty: no process environment or HOME fallback. */
	readonly environment: Readonly<Record<string, never>>;
	readonly disclosure: AgentWorkloadSandboxPolicy["disclosure"];
	readonly execution: AgentWorkloadSandboxPolicy["execution"];
}

export interface AgentWorkloadSandboxGuestContext {
	readonly cwd: "/work";
	readonly environment: Readonly<Record<string, never>>;
	readonly handles: Readonly<{
		filesystem: AgentWorkloadSandboxPolicy["filesystem"];
		network: AgentWorkloadSandboxPolicy["network"];
		secrets: readonly string[];
		tools: readonly string[];
		effects: readonly string[];
		disclosure: AgentWorkloadSandboxPolicy["disclosure"];
	}>;
}

export interface AgentWorkloadSandboxSession {
	readonly guest: AgentWorkloadSandboxGuestContext;
	prepare<T>(
		prepareSandbox: (
			context: AgentWorkloadSandboxHostContext,
		) => T | Promise<T>,
	): Promise<T>;
	create<T>(
		createSandbox: (context: AgentWorkloadSandboxHostContext) => T | Promise<T>,
	): Promise<T>;
	useCapability<T>(
		request: AgentWorkloadSandboxCapabilityRequest,
		use: (context: AgentWorkloadSandboxHostContext) => T | Promise<T>,
	): Promise<T>;
}

export interface AgentWorkloadSandboxHostContext {
	readonly principal: AgentWorkloadPrincipal;
	readonly context: AgentWorkloadSandboxContext;
	readonly guest: AgentWorkloadSandboxGuestContext;
}

export interface AgentWorkloadSandboxBoundary {
	open(
		authority: AuthenticatedAgentWorkloadEnvelope,
	): Promise<AgentWorkloadSandboxSession>;
}

function assertAuthenticatedEnvelope(
	authority: unknown,
): asserts authority is AuthenticatedAgentWorkloadEnvelope {
	if (
		!authority ||
		typeof authority !== "object" ||
		Array.isArray(authority) ||
		(authority as { kind?: unknown }).kind !==
			"authenticated_agent_workload_envelope" ||
		(authority as { version?: unknown }).version !== 1 ||
		Object.keys(authority).some((key) => key !== "kind" && key !== "version")
	) {
		throw new AgentWorkloadAuthorityError("invalid_principal");
	}
}

export function createAgentWorkloadSandboxBoundary(
	options: AgentWorkloadSandboxBoundaryOptions,
): AgentWorkloadSandboxBoundary {
	const workRootBase = normalizeAgentWorkloadRootBase(options.workRootBase);
	const policy = snapshotAgentWorkloadSandboxPolicy(options.policy);
	const environment = Object.freeze({});
	const guest = Object.freeze({
		cwd: "/work" as const,
		environment,
		handles: Object.freeze({
			filesystem: policy.filesystem,
			network: policy.network,
			secrets: policy.secrets,
			tools: policy.tools,
			effects: policy.effects,
			disclosure: policy.disclosure,
		}),
	});
	return {
		async open(authority) {
			assertAuthenticatedEnvelope(authority);
			const principal = await options.resolver.validate(authority);
			if (!matchesAgentWorkloadSandboxPolicy(principal, policy)) {
				try {
					await options.audit?.(policyDenialEvent(principal));
				} catch {
					// Audit backends never get to replace a secret-safe authorization denial.
				}
				throw new AgentWorkloadSandboxDeniedError();
			}
			const workRoot = deriveAgentWorkloadRoot(workRootBase, principal);
			const context = Object.freeze({
				workRoot,
				cwd: "/work" as const,
				environment,
				disclosure: policy.disclosure,
				execution: policy.execution,
			});
			return Object.freeze({
				guest,
				async prepare<T>(
					prepareSandbox: (
						context: AgentWorkloadSandboxHostContext,
					) => T | Promise<T>,
				): Promise<T> {
					let currentPrincipal: AgentWorkloadPrincipal;
					try {
						currentPrincipal = await options.resolver.validate(authority);
					} catch (error) {
						try {
							await options.audit?.(
								sandboxPreparationEvent(
									principal,
									"denied",
									"authority_invalidated",
								),
							);
						} catch {
							// Preserve the resolver's secret-safe authority error.
						}
						throw error;
					}
					if (!matchesAgentWorkloadSandboxPolicy(currentPrincipal, policy)) {
						try {
							await options.audit?.(
								sandboxPreparationEvent(
									currentPrincipal,
									"denied",
									"policy_mismatch",
								),
							);
						} catch {
							// Preserve one secret-safe denial.
						}
						throw new AgentWorkloadSandboxDeniedError();
					}
					try {
						await options.audit?.(
							sandboxPreparationEvent(
								currentPrincipal,
								"allowed",
								"sandbox_preparation_authorized",
							),
						);
					} catch {
						throw new AgentWorkloadSandboxDeniedError();
					}
					return prepareSandbox({
						principal: currentPrincipal,
						context,
						guest,
					});
				},
				async create<T>(
					createSandbox: (
						context: AgentWorkloadSandboxHostContext,
					) => T | Promise<T>,
				): Promise<T> {
					let currentPrincipal: AgentWorkloadPrincipal;
					try {
						currentPrincipal = await options.resolver.validate(authority);
					} catch (error) {
						try {
							await options.audit?.(
								sandboxCreationEvent(
									principal,
									"denied",
									"authority_invalidated",
								),
							);
						} catch {
							// Preserve the resolver's secret-safe authority error.
						}
						throw error;
					}
					if (!matchesAgentWorkloadSandboxPolicy(currentPrincipal, policy)) {
						try {
							await options.audit?.(
								sandboxCreationEvent(
									currentPrincipal,
									"denied",
									"policy_mismatch",
								),
							);
						} catch {
							// Preserve one secret-safe denial.
						}
						throw new AgentWorkloadSandboxDeniedError();
					}
					try {
						await options.audit?.(
							sandboxCreationEvent(
								currentPrincipal,
								"allowed",
								"sandbox_creation_authorized",
							),
						);
					} catch {
						throw new AgentWorkloadSandboxDeniedError();
					}
					return createSandbox({
						principal: currentPrincipal,
						context,
						guest,
					});
				},
				async useCapability<T>(
					request: AgentWorkloadSandboxCapabilityRequest,
					use: (context: AgentWorkloadSandboxHostContext) => T | Promise<T>,
				): Promise<T> {
					let currentPrincipal: AgentWorkloadPrincipal;
					try {
						currentPrincipal = await options.resolver.validate(authority);
					} catch (error) {
						try {
							await options.audit?.(
								authorityInvalidatedEvent(principal, request),
							);
						} catch {
							// Preserve the resolver's secret-safe authority error.
						}
						throw error;
					}
					if (
						!matchesAgentWorkloadSandboxPolicy(currentPrincipal, policy) ||
						!allowsAgentWorkloadSandboxCapability(policy, request)
					) {
						try {
							await options.audit?.(
								capabilityDenialEvent(currentPrincipal, request),
							);
						} catch {
							// Preserve one secret-safe denial even if the audit sink is down.
						}
						throw new AgentWorkloadSandboxDeniedError();
					}
					try {
						await options.audit?.(
							capabilityAuthorizedEvent(currentPrincipal, request),
						);
					} catch {
						throw new AgentWorkloadSandboxDeniedError();
					}
					return use({
						principal: currentPrincipal,
						context,
						guest,
					});
				},
			});
		},
	};
}
