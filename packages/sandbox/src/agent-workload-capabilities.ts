import type { AgentWorkloadSandboxPolicy } from "./agent-workload-policy.js";

export type AgentWorkloadSandboxCapabilityRequest =
	| {
			readonly kind: "filesystem";
			readonly operation: "read" | "write";
			readonly resource: string;
	  }
	| {
			readonly kind: "network";
			readonly operation: "fetch" | "import";
			readonly resource: string;
	  }
	| {
			readonly kind: "secret";
			readonly operation: "read";
			readonly resource: string;
	  }
	| {
			readonly kind: "tool";
			readonly operation: "call";
			readonly resource: string;
	  }
	| {
			readonly kind: "effect";
			readonly operation: "commit";
			readonly resource: string;
	  };

function isSafeRelativeGuestPath(resource: string): boolean {
	return (
		resource.length > 0 &&
		!resource.startsWith("/") &&
		!resource.includes("\\") &&
		!resource.includes("\0") &&
		resource
			.split("/")
			.every((part) => part !== "" && part !== "." && part !== "..")
	);
}

function matchesGuestPath(pattern: string, resource: string): boolean {
	if (!isSafeRelativeGuestPath(resource)) return false;
	if (pattern.endsWith("/**")) {
		const prefix = pattern.slice(0, -3);
		return prefix.length > 0 && resource.startsWith(`${prefix}/`);
	}
	return resource === pattern;
}

export function allowsAgentWorkloadSandboxCapability(
	policy: AgentWorkloadSandboxPolicy,
	request: AgentWorkloadSandboxCapabilityRequest,
): boolean {
	switch (request.kind) {
		case "filesystem":
			return policy.filesystem[request.operation].some((pattern) =>
				matchesGuestPath(pattern, request.resource),
			);
		case "network":
			return policy.network[request.operation].some(
				(host) => host.toLowerCase() === request.resource.toLowerCase(),
			);
		case "secret":
			return policy.secrets.includes(request.resource);
		case "tool":
			return policy.tools.includes(request.resource);
		case "effect":
			return policy.effects.includes(request.resource);
	}
}
