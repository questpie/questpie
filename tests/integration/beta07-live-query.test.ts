import { expect, test } from "bun:test";

import {
	projectRealtimeWireContract,
	renderClientContract,
} from "../../packages/compiler/src/runtime";
import type { NormalizedResource } from "../../packages/compiler/src/types";

const input = {
	kind: "object",
	properties: {
		after: { codec: { kind: "text" }, kind: "nullable" },
		channelId: { kind: "uuid" },
		first: { kind: "integer" },
	},
} as const;
const output = {
	kind: "object",
	properties: {
		nodes: {
			kind: "array",
			items: {
				kind: "object",
				properties: {
					body: { kind: "text" },
					createdAt: { kind: "timestamp" },
					id: { kind: "uuid" },
				},
			},
		},
	},
} as const;

function resource(
	kind: "mutation" | "query",
	name: string,
): NormalizedResource {
	return {
		identity: `${kind}:${name}`,
		kind,
		name,
		contract: {
			exposure: "network",
			input,
			output,
			declaredErrors: {},
		},
		contributions: [],
		origin: {
			logicalPath: "src/operations.ts",
			exportName: name.replaceAll(".", "_"),
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: {},
	};
}

const resources = [
	resource("query", "messages.page"),
	resource("query", "reports.unsafeRaw"),
	resource("mutation", "message.publish"),
];
const operationWireDigest = "2".repeat(64);
const clientContractDigest = "1".repeat(64);

test("freezes the sibling realtime wire without changing Operation Wire v2", () => {
	const operationWireBefore = Object.freeze({
		format: "questpie.operation-wire",
		version: 2,
		digest: operationWireDigest,
	});
	const realtime = projectRealtimeWireContract({
		application: "application:collaboration",
		clientContractDigest,
		operationWireDigest,
		resources,
		watchableQueries: ["query:messages.page"],
	});

	expect(realtime).toEqual({
		format: "questpie.realtime-wire",
		version: 1,
		application: "application:collaboration",
		path: "/_questpie/realtime",
		commandMediaType:
			"application/vnd.questpie.realtime+json;version=1",
		streamMediaType: "text/event-stream",
		protocol: { name: "questpie.realtime", version: 1 },
		operationWireDigest,
		clientContractDigest,
		watchableQueries: [
			{
				identity: "query:messages.page",
				input,
				output,
			},
		],
		commands: {
			open: [
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
			],
			ack: [
				"application",
				"bindingId",
				"clientContractDigest",
				"command",
				"protocol",
				"realtimeWireDigest",
				"resumeToken",
				"scopeId",
			],
			close: [
				"application",
				"bindingId",
				"clientContractDigest",
				"command",
				"protocol",
				"realtimeWireDigest",
				"scopeId",
			],
		},
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
		deliveryKinds: ["initial", "reset", "update"],
		resetReasons: [
			"authority-changed",
			"deployment-changed",
			"resume-unavailable",
		],
		failureCodes: [
			"AUTHORIZATION_FAILED",
			"OUTPUT_INVALID",
			"RESOURCE_LIMIT",
			"TRANSPORT_FAILED",
			"VERSION_INCOMPATIBLE",
		],
		limits: {
			activeWatchesPerPrincipal: 64,
			bufferedBytesPerClient: 2_097_152,
			dependencyTokensPerPlan: 256,
			fanoutPerBatch: 1_024,
			ledgerLagMilliseconds: 30_000,
			resultBytes: 1_048_576,
			retainedTokenAgeMilliseconds: 86_400_000,
			retainedTokensPerPrincipal: 128,
		},
		resumeTokenVisibility: "generatedClientOnly",
		acknowledgement: "afterCompleteResultAccepted",
		digest: expect.stringMatching(/^[0-9a-f]{64}$/),
	});
	expect(operationWireBefore).toEqual({
		format: "questpie.operation-wire",
		version: 2,
		digest: operationWireDigest,
	});
});

test("adds watch only to the same compiler-proven Query method", () => {
	const source = renderClientContract(resources, {
		application: "application:collaboration",
		clientContractDigest,
		wireDigest: operationWireDigest,
		path: "/_questpie/operation",
		mediaType: "application/vnd.questpie.operation+json;version=1",
		realtime: projectRealtimeWireContract({
			application: "application:collaboration",
			clientContractDigest,
			operationWireDigest,
			resources,
			watchableQueries: ["query:messages.page"],
		}),
	});
	const declarations = source.slice(0, source.indexOf("export class"));

	expect(declarations).toContain(
		'"messages.page": WatchableQueryMethod<',
	);
	expect(declarations).toContain(
		'"reports.unsafeRaw"(operationInput:',
	);
	expect(declarations).not.toContain('"reports.unsafeRaw": WatchableQueryMethod<');
	expect(declarations).not.toContain('"message.publish": WatchableQueryMethod<');
	expect(declarations).not.toContain("resumeToken");
	expect(source).toContain("Object.assign(");
});
