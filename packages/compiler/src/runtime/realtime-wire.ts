import { compareAscii, digest } from "../canonical";
import type { NormalizedResource } from "../types";

export interface RealtimeWireContractV1 {
	readonly format: "questpie.realtime-wire";
	readonly version: 1;
	readonly application: string;
	readonly path: "/_questpie/realtime";
	readonly commandMediaType: "application/vnd.questpie.realtime+json;version=1";
	readonly streamMediaType: "text/event-stream";
	readonly protocol: Readonly<{ name: "questpie.realtime"; version: 1 }>;
	readonly operationWireDigest: string;
	readonly clientContractDigest: string;
	readonly watchableQueries: readonly Readonly<{
		identity: string;
		input: unknown;
		output: unknown;
	}>[];
	readonly commands: Readonly<{
		open: readonly string[];
		ack: readonly string[];
		close: readonly string[];
	}>;
	readonly frames: Readonly<{
		ready: readonly string[];
		delivery: readonly string[];
		failure: readonly string[];
		closed: readonly string[];
	}>;
	readonly deliveryKinds: readonly ["initial", "reset", "update"];
	readonly resetReasons: readonly [
		"authority-changed",
		"deployment-changed",
		"resume-unavailable",
	];
	readonly failureCodes: readonly [
		"AUTHORIZATION_FAILED",
		"OUTPUT_INVALID",
		"RESOURCE_LIMIT",
		"TRANSPORT_FAILED",
		"VERSION_INCOMPATIBLE",
	];
	readonly limits: Readonly<{
		activeWatchesPerPrincipal: 64;
		bufferedBytesPerClient: 2_097_152;
		dependencyTokensPerPlan: 256;
		fanoutPerBatch: 1_024;
		ledgerLagMilliseconds: 30_000;
		resultBytes: 1_048_576;
		retainedTokenAgeMilliseconds: 86_400_000;
		retainedTokensPerPrincipal: 128;
	}>;
	readonly resumeTokenVisibility: "generatedClientOnly";
	readonly acknowledgement: "afterCompleteResultAccepted";
	readonly digest: string;
}

const OPEN_KEYS = [
	"application",
	"bindingId",
	"clientContractDigest",
	"command",
	"context",
	"input",
	"protocol",
	"query",
	"realtimeWireDigest",
	"resumeToken",
	"scopeId",
] as const;
const ACK_KEYS = [
	"application",
	"bindingId",
	"clientContractDigest",
	"command",
	"protocol",
	"realtimeWireDigest",
	"resumeToken",
	"scopeId",
] as const;
const CLOSE_KEYS = [
	"application",
	"bindingId",
	"clientContractDigest",
	"command",
	"protocol",
	"realtimeWireDigest",
	"scopeId",
] as const;

export function projectRealtimeWireContract(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		operationWireDigest: string;
		resources: readonly NormalizedResource[];
		watchableQueries: readonly string[];
	}>,
): RealtimeWireContractV1 {
	const networkQueries = new Map(
		input.resources
			.filter(
				(resource) =>
					resource.kind === "query" && resource.contract.exposure === "network",
			)
			.map((resource) => [resource.identity, resource]),
	);
	const identities = [...new Set(input.watchableQueries)].sort(compareAscii);
	if (identities.length !== input.watchableQueries.length)
		throw new TypeError("duplicate watchable Query identity");
	const watchableQueries = identities.map((identity) => {
		const resource = networkQueries.get(identity);
		if (!resource)
			throw new TypeError(
				`watchable Query is not network-exposed: ${identity}`,
			);
		return {
			identity,
			input: resource.contract.input,
			output: resource.contract.output,
		};
	});
	const withoutDigest = {
		format: "questpie.realtime-wire" as const,
		version: 1 as const,
		application: input.application,
		path: "/_questpie/realtime" as const,
		commandMediaType:
			"application/vnd.questpie.realtime+json;version=1" as const,
		streamMediaType: "text/event-stream" as const,
		protocol: { name: "questpie.realtime" as const, version: 1 as const },
		operationWireDigest: input.operationWireDigest,
		clientContractDigest: input.clientContractDigest,
		watchableQueries,
		commands: { open: OPEN_KEYS, ack: ACK_KEYS, close: CLOSE_KEYS },
		frames: {
			ready: ["kind", "protocol", "scopeId"],
			delivery: [
				"bindingId",
				"delivery",
				"kind",
				"payload",
				"protocol",
				"query",
				"resetReason",
				"resumeToken",
			],
			failure: ["bindingId", "error", "kind", "protocol", "query"],
			closed: ["kind", "protocol", "reason", "retryable", "scopeId"],
		},
		deliveryKinds: ["initial", "reset", "update"] as const,
		resetReasons: [
			"authority-changed",
			"deployment-changed",
			"resume-unavailable",
		] as const,
		failureCodes: [
			"AUTHORIZATION_FAILED",
			"OUTPUT_INVALID",
			"RESOURCE_LIMIT",
			"TRANSPORT_FAILED",
			"VERSION_INCOMPATIBLE",
		] as const,
		limits: {
			activeWatchesPerPrincipal: 64 as const,
			bufferedBytesPerClient: 2_097_152 as const,
			dependencyTokensPerPlan: 256 as const,
			fanoutPerBatch: 1_024 as const,
			ledgerLagMilliseconds: 30_000 as const,
			resultBytes: 1_048_576 as const,
			retainedTokenAgeMilliseconds: 86_400_000 as const,
			retainedTokensPerPrincipal: 128 as const,
		},
		resumeTokenVisibility: "generatedClientOnly" as const,
		acknowledgement: "afterCompleteResultAccepted" as const,
	};
	return {
		...withoutDigest,
		digest: digest("questpie-realtime-wire-v1", withoutDigest),
	};
}
