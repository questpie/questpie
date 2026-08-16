import { decodeRuntimeCodecDescriptor, type RuntimeCodec } from "../../codec";
import {
	exactRuntimeArtifactKeys as exact,
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as artifactDigest,
	runtimeArtifactDigestValue as digestValue,
	runtimeArtifactRecord as record,
	runtimeArtifactString as string,
} from "../artifact-protocol";

export type DecodedRealtimeQueryV1 = Readonly<{
	identity: string;
	input: RuntimeCodec;
	output: RuntimeCodec;
}>;

export type DecodedRealtimeWireContractV1 = Readonly<{
	format: "questpie.realtime-wire";
	version: 1;
	application: string;
	path: "/_questpie/realtime";
	commandMediaType: "application/vnd.questpie.realtime+json;version=1";
	streamMediaType: "text/event-stream";
	protocol: Readonly<{ name: "questpie.realtime"; version: 1 }>;
	operationWireDigest: string;
	clientContractDigest: string;
	digest: string;
	watchableQueries: ReadonlyMap<string, DecodedRealtimeQueryV1>;
	limits: Readonly<{
		activeWatchesPerPrincipal: 64;
		bufferedBytesPerClient: 2_097_152;
		dependencyTokensPerPlan: 256;
		fanoutPerBatch: 1_024;
		ledgerLagMilliseconds: 30_000;
		resultBytes: 1_048_576;
		retainedTokenAgeMilliseconds: 86_400_000;
		retainedTokensPerPrincipal: 128;
	}>;
}>;

const ROOT_KEYS = [
	"format",
	"version",
	"application",
	"path",
	"commandMediaType",
	"streamMediaType",
	"protocol",
	"operationWireDigest",
	"clientContractDigest",
	"watchableQueries",
	"commands",
	"frames",
	"deliveryKinds",
	"resetReasons",
	"failureCodes",
	"limits",
	"resumeTokenVisibility",
	"acknowledgement",
	"digest",
] as const;

function exactArray(
	value: unknown,
	expected: readonly string[],
	label: string,
) {
	if (
		!Array.isArray(value) ||
		JSON.stringify(value) !== JSON.stringify(expected)
	)
		fail(`${label} is invalid`);
}

export function decodeRealtimeWireContract(
	value: unknown,
): DecodedRealtimeWireContractV1 {
	const wire = record(value, "realtime wire");
	exact(wire, ROOT_KEYS, "realtime wire");
	if (
		wire.format !== "questpie.realtime-wire" ||
		wire.version !== 1 ||
		wire.path !== "/_questpie/realtime" ||
		wire.commandMediaType !==
			"application/vnd.questpie.realtime+json;version=1" ||
		wire.streamMediaType !== "text/event-stream" ||
		wire.resumeTokenVisibility !== "generatedClientOnly" ||
		wire.acknowledgement !== "afterCompleteResultAccepted"
	)
		fail("realtime wire is invalid");
	const protocol = record(wire.protocol, "realtime protocol");
	exact(protocol, ["name", "version"], "realtime protocol");
	if (protocol.name !== "questpie.realtime" || protocol.version !== 1)
		fail("realtime protocol is invalid");
	const commands = record(wire.commands, "realtime commands");
	exact(commands, ["open", "ack", "close"], "realtime commands");
	exactArray(
		commands.open,
		[
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
		"realtime open keys",
	);
	exactArray(
		commands.ack,
		[
			"application",
			"bindingId",
			"clientContractDigest",
			"command",
			"protocol",
			"realtimeWireDigest",
			"resumeToken",
			"scopeId",
		],
		"realtime acknowledgement keys",
	);
	exactArray(
		commands.close,
		[
			"application",
			"bindingId",
			"clientContractDigest",
			"command",
			"protocol",
			"realtimeWireDigest",
			"scopeId",
		],
		"realtime close keys",
	);
	const frames = record(wire.frames, "realtime frames");
	exact(frames, ["ready", "delivery", "failure", "closed"], "realtime frames");
	exactArray(frames.ready, ["kind", "protocol", "scopeId"], "ready frame");
	exactArray(
		frames.delivery,
		[
			"bindingId",
			"delivery",
			"kind",
			"payload",
			"protocol",
			"query",
			"resetReason",
			"resumeToken",
		],
		"delivery frame",
	);
	exactArray(
		frames.failure,
		["bindingId", "error", "kind", "protocol", "query"],
		"failure frame",
	);
	exactArray(
		frames.closed,
		["kind", "protocol", "reason", "retryable", "scopeId"],
		"closed frame",
	);
	exactArray(
		wire.deliveryKinds,
		["initial", "reset", "update"],
		"delivery kinds",
	);
	exactArray(
		wire.resetReasons,
		["authority-changed", "deployment-changed", "resume-unavailable"],
		"reset reasons",
	);
	exactArray(
		wire.failureCodes,
		[
			"AUTHORIZATION_FAILED",
			"OUTPUT_INVALID",
			"RESOURCE_LIMIT",
			"TRANSPORT_FAILED",
			"VERSION_INCOMPATIBLE",
		],
		"realtime failure codes",
	);
	const limits = record(wire.limits, "realtime limits");
	exact(
		limits,
		[
			"activeWatchesPerPrincipal",
			"bufferedBytesPerClient",
			"dependencyTokensPerPlan",
			"fanoutPerBatch",
			"ledgerLagMilliseconds",
			"resultBytes",
			"retainedTokenAgeMilliseconds",
			"retainedTokensPerPrincipal",
		],
		"realtime limits",
	);
	const expectedLimits = {
		activeWatchesPerPrincipal: 64,
		bufferedBytesPerClient: 2_097_152,
		dependencyTokensPerPlan: 256,
		fanoutPerBatch: 1_024,
		ledgerLagMilliseconds: 30_000,
		resultBytes: 1_048_576,
		retainedTokenAgeMilliseconds: 86_400_000,
		retainedTokensPerPrincipal: 128,
	} as const;
	for (const [key, expected] of Object.entries(expectedLimits))
		if (limits[key] !== expected) fail(`realtime limit ${key} is invalid`);
	if (!Array.isArray(wire.watchableQueries))
		fail("watchable Queries must be an array");
	const queries = wire.watchableQueries.map((raw, index) => {
		const query = record(raw, `watchable Query ${index}`);
		exact(query, ["identity", "input", "output"], `watchable Query ${index}`);
		return Object.freeze({
			identity: string(query.identity, `watchable Query ${index} identity`),
			input: decodeRuntimeCodecDescriptor(
				query.input,
				`$realtime.watchableQueries[${index}].input`,
			),
			output: decodeRuntimeCodecDescriptor(
				query.output,
				`$realtime.watchableQueries[${index}].output`,
			),
		});
	});
	const sortedQueries = [...queries].sort((left, right) =>
		left.identity < right.identity
			? -1
			: left.identity > right.identity
				? 1
				: 0,
	);
	if (
		new Set(queries.map(({ identity }) => identity)).size !== queries.length ||
		queries.some(
			(query, index) => query.identity !== sortedQueries[index]?.identity,
		)
	)
		fail("watchable Queries must be unique and sorted");
	const digest = digestValue(wire.digest, "realtime wire digest");
	const { digest: _digest, ...unsigned } = wire;
	if (artifactDigest("questpie-realtime-wire-v1", unsigned) !== digest)
		fail("realtime wire digest does not match");
	return Object.freeze({
		format: "questpie.realtime-wire",
		version: 1,
		application: string(wire.application, "realtime application"),
		path: "/_questpie/realtime",
		commandMediaType: "application/vnd.questpie.realtime+json;version=1",
		streamMediaType: "text/event-stream",
		protocol: Object.freeze({ name: "questpie.realtime", version: 1 }),
		operationWireDigest: digestValue(
			wire.operationWireDigest,
			"realtime operation wire digest",
		),
		clientContractDigest: digestValue(
			wire.clientContractDigest,
			"realtime client contract digest",
		),
		digest,
		watchableQueries: new Map(queries.map((query) => [query.identity, query])),
		limits: expectedLimits,
	});
}
