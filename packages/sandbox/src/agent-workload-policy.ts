import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import type { AgentWorkloadPrincipal } from "@questpie/ai";

export interface AgentWorkloadSandboxPolicy {
	readonly companyId: string;
	readonly anchorSpaceId: string;
	readonly skillRevisionId: string;
	readonly executionPolicyRevisionId: string;
	readonly execution: {
		readonly sourceSha256: string;
		readonly inputProjectionId: string;
	};
	readonly filesystem: {
		readonly read: readonly string[];
		readonly write: readonly string[];
	};
	readonly network: {
		readonly fetch: readonly string[];
		readonly import: readonly string[];
	};
	readonly secrets: readonly string[];
	readonly tools: readonly string[];
	readonly effects: readonly string[];
	readonly disclosure: {
		readonly mode: "anchor_space";
		readonly anchorSpaceId: string;
	};
}

function freezeStrings(values: readonly string[]): readonly string[] {
	return Object.freeze([...values]);
}

function isExplicitGuestPathPattern(pattern: string): boolean {
	const parts = pattern.split("/");
	if (parts.length === 0 || parts.some((part) => part.length === 0))
		return false;
	const globIndex = parts.indexOf("**");
	if (globIndex !== -1 && globIndex !== parts.length - 1) return false;
	return parts.every((part, index) => {
		if (part === "**") return index === parts.length - 1 && index > 0;
		return (
			part !== "." &&
			part !== ".." &&
			!part.includes("*") &&
			!part.includes("\\") &&
			!part.includes("\0")
		);
	});
}

function assertExplicitDefaultDenyPolicy(
	policy: AgentWorkloadSandboxPolicy,
): void {
	const paths = [...policy.filesystem.read, ...policy.filesystem.write];
	const hosts = [...policy.network.fetch, ...policy.network.import];
	const namedCapabilities = [
		...policy.secrets,
		...policy.tools,
		...policy.effects,
	];
	const unsafe =
		!/^[a-f0-9]{64}$/.test(policy.execution.sourceSha256) ||
		policy.execution.inputProjectionId.length === 0 ||
		policy.execution.inputProjectionId.includes("*") ||
		paths.some((pattern) => !isExplicitGuestPathPattern(pattern)) ||
		hosts.some(
			(host) =>
				host.length === 0 ||
				host.includes("*") ||
				host.includes("/") ||
				/\s/.test(host),
		) ||
		namedCapabilities.some(
			(capability) => capability.length === 0 || capability.includes("*"),
		);
	if (unsafe) {
		throw new Error(
			"Agent workload sandbox policy must remain explicit and default-deny.",
		);
	}
}

export function snapshotAgentWorkloadSandboxPolicy(
	policy: AgentWorkloadSandboxPolicy,
): AgentWorkloadSandboxPolicy {
	assertExplicitDefaultDenyPolicy(policy);
	return Object.freeze({
		companyId: policy.companyId,
		anchorSpaceId: policy.anchorSpaceId,
		skillRevisionId: policy.skillRevisionId,
		executionPolicyRevisionId: policy.executionPolicyRevisionId,
		execution: Object.freeze({ ...policy.execution }),
		filesystem: Object.freeze({
			read: freezeStrings(policy.filesystem.read),
			write: freezeStrings(policy.filesystem.write),
		}),
		network: Object.freeze({
			fetch: freezeStrings(policy.network.fetch),
			import: freezeStrings(policy.network.import),
		}),
		secrets: freezeStrings(policy.secrets),
		tools: freezeStrings(policy.tools),
		effects: freezeStrings(policy.effects),
		disclosure: Object.freeze({ ...policy.disclosure }),
	});
}

export function matchesAgentWorkloadSandboxPolicy(
	principal: AgentWorkloadPrincipal,
	policy: AgentWorkloadSandboxPolicy,
): boolean {
	return (
		policy.companyId === principal.scope.companyId &&
		policy.anchorSpaceId === principal.scope.anchorSpaceId &&
		policy.skillRevisionId === principal.policies.skillRevisionId &&
		policy.executionPolicyRevisionId ===
			principal.policies.executionPolicyRevisionId &&
		policy.disclosure.mode === principal.disclosure.mode &&
		policy.disclosure.anchorSpaceId === principal.disclosure.anchorSpaceId &&
		policy.tools.every((tool) => principal.capabilities.tools.includes(tool)) &&
		policy.effects.every((effect) =>
			principal.capabilities.effects.includes(effect),
		)
	);
}

export function normalizeAgentWorkloadRootBase(workRootBase: string): string {
	if (!isAbsolute(workRootBase)) {
		throw new Error("Agent workload sandbox workRootBase must be absolute.");
	}
	const normalized = resolve(workRootBase);
	if (
		normalized === resolve("/") ||
		normalized === resolve(homedir()) ||
		normalized === resolve(process.cwd())
	) {
		throw new Error(
			"Agent workload sandbox workRootBase must not use root, HOME, or the process cwd.",
		);
	}
	return normalized;
}

function safePathSegment(value: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		throw new Error("Agent workload sandbox identity is not path-safe.");
	}
	return value;
}

export function deriveAgentWorkloadRoot(
	workRootBase: string,
	principal: AgentWorkloadPrincipal,
): string {
	return join(
		workRootBase,
		safePathSegment(principal.scope.companyId),
		safePathSegment(principal.run.workRequestId),
		safePathSegment(principal.run.attemptId),
	);
}
