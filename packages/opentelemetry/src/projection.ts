import { SpanKind, type Attributes } from "@opentelemetry/api";
import type { QuestpieObservationRuntimeMetadataV1 } from "questpie/internal/observability";

import { SIGNAL_PROJECTION_ARTIFACT } from "./generated/signal-projection.gen";

export type NeutralContext = Readonly<{
	format: "questpie.trace-context";
	version: 1;
	traceId: Uint8Array;
	spanId: Uint8Array;
	flags: number;
}>;
export type TracePlan = Readonly<{
	kind: "active-parent" | "remote-parent" | "root" | "root-with-links";
	extracted?: Readonly<{ context: NeutralContext; tracestate: string | null }>;
	links?: readonly NeutralContext[];
}>;
export type Start = Readonly<Record<string, unknown>> &
	Readonly<{ kind: string; trace: TracePlan }>;
export type Event = Readonly<Record<string, unknown>> &
	Readonly<{ kind: string }>;
export type End = Readonly<Record<string, unknown>> &
	Readonly<{ kind: string; outcome: string }>;

export const OPERATION_HISTOGRAM_BOUNDARIES =
	SIGNAL_PROJECTION_ARTIFACT.operationHistogramBoundariesSeconds;
export const DURABLE_HISTOGRAM_BOUNDARIES =
	SIGNAL_PROJECTION_ARTIFACT.durableHistogramBoundariesSeconds;
export const ADAPTER_METRIC_DEFINITIONS = SIGNAL_PROJECTION_ARTIFACT.metrics;

const SPAN_KIND = {
	CLIENT: SpanKind.CLIENT,
	CONSUMER: SpanKind.CONSUMER,
	INTERNAL: SpanKind.INTERNAL,
	PRODUCER: SpanKind.PRODUCER,
	SERVER: SpanKind.SERVER,
} satisfies Record<
	(typeof SIGNAL_PROJECTION_ARTIFACT.spanGraph)[number]["kind"],
	SpanKind
>;
const FETCH_SPAN_INDEX = {
	generated_operation: 0,
	unmatched: 2,
} satisfies Record<"generated_operation" | "unmatched", number>;
const SCOPE_SPAN_INDEX = {
	route: 1,
	execution: 3,
	query: 4,
	mutation: 5,
	action: 6,
	transaction: 7,
	postgresql: 8,
	"job.accept": 9,
	"reaction.accept": 10,
	"job.attempt": 11,
	"reaction.attempt": 12,
	"action.effect": 13,
} satisfies Record<
	| "route"
	| "execution"
	| "query"
	| "mutation"
	| "action"
	| "transaction"
	| "postgresql"
	| "job.accept"
	| "reaction.accept"
	| "job.attempt"
	| "reaction.attempt"
	| "action.effect",
	number
>;

function renderSpanName(template: string, input: Start): string {
	return template
		.replace("{METHOD}", String(input.method))
		.replace("{matched route template}", String(input.routeTemplate))
		.replace("{UPPERCASE SQL verb}", String(input.databaseOperation))
		.replace("{Resource identity}", String(input.resourceIdentity));
}

export function spanDefinition(input: Start): Readonly<{
	name: string;
	kind: SpanKind;
}> | null {
	if (input.kind === "runtime") return null;
	const index =
		input.kind === "fetch"
			? FETCH_SPAN_INDEX[input.requestKind as keyof typeof FETCH_SPAN_INDEX]
			: SCOPE_SPAN_INDEX[input.kind as keyof typeof SCOPE_SPAN_INDEX];
	const row = SIGNAL_PROJECTION_ARTIFACT.spanGraph[index];
	if (row === undefined)
		throw new TypeError("Unsupported QUESTPIE observation scope");
	return { name: renderSpanName(row.name, input), kind: SPAN_KIND[row.kind] };
}

type AttributeName =
	keyof typeof SIGNAL_PROJECTION_ARTIFACT.spanAttributeScopes;
type AttributeSource = Readonly<Record<string, unknown>>;
type AttributeValue = string | number | undefined;

export type SpanAttributeFacts = Readonly<{
	end?: End;
	event?: Event;
	metadata: QuestpieObservationRuntimeMetadataV1;
	operationalIds: "omit" | "spans";
	scope: Start["kind"];
	start?: Start;
}>;

function sourceValue(facts: SpanAttributeFacts, field: string): unknown {
	return (
		(facts.event as AttributeSource | undefined)?.[field] ??
		(facts.end as AttributeSource | undefined)?.[field] ??
		(facts.start as AttributeSource | undefined)?.[field]
	);
}

function stringValue(
	facts: SpanAttributeFacts,
	field: string,
): string | undefined {
	const value = sourceValue(facts, field);
	return typeof value === "string" ? value : undefined;
}

function numberValue(
	facts: SpanAttributeFacts,
	field: string,
): number | undefined {
	const value = sourceValue(facts, field);
	return typeof value === "number" ? value : undefined;
}

function operationalString(
	facts: SpanAttributeFacts,
	field: string,
): string | undefined {
	return facts.operationalIds === "spans"
		? stringValue(facts, field)
		: undefined;
}

const ATTRIBUTE_VALUE = {
	"db.operation.name": (facts) => stringValue(facts, "databaseOperation"),
	"db.system.name": (facts) =>
		facts.start?.kind === "postgresql" ? "postgresql" : undefined,
	"http.request.method": (facts) => stringValue(facts, "method"),
	"http.response.status_code": (facts) =>
		numberValue(facts, "httpResponseStatusCode"),
	"http.route": (facts) => stringValue(facts, "routeTemplate"),
	"questpie.attempt.id": (facts) => operationalString(facts, "attemptId"),
	"questpie.attempt.number": (facts) => numberValue(facts, "attemptNumber"),
	"questpie.dispatch.id": (facts) => operationalString(facts, "dispatchId"),
	"questpie.effect.id": (facts) => operationalString(facts, "effectId"),
	"questpie.error.code": (facts) => stringValue(facts, "errorCode"),
	"questpie.execution.entry": (facts) => stringValue(facts, "entry"),
	"questpie.operation.kind": (facts) =>
		facts.start?.kind === "query" ||
		facts.start?.kind === "mutation" ||
		facts.start?.kind === "action"
			? facts.start.kind
			: undefined,
	"questpie.outcome": (facts) => stringValue(facts, "outcome"),
	"questpie.resource": (facts) => stringValue(facts, "resourceIdentity"),
	"questpie.retry.delay_ms": (facts) =>
		numberValue(facts, "retryDelayMilliseconds"),
	"questpie.run.id": (facts) => operationalString(facts, "runId"),
	"questpie.runtime.instance.id": (facts) =>
		facts.start !== undefined && facts.operationalIds === "spans"
			? facts.metadata.runtimeInstanceId
			: undefined,
	"questpie.statement.identity": (facts) =>
		stringValue(facts, "statementIdentity"),
	"questpie.transaction.id": (facts) =>
		operationalString(facts, "transactionId"),
	"url.scheme": (facts) => stringValue(facts, "scheme"),
} satisfies Record<
	AttributeName,
	(facts: SpanAttributeFacts) => AttributeValue
>;

export function projectSpanAttributes(facts: SpanAttributeFacts): Attributes {
	const attributes: Record<string, string | number> = {};
	for (const name of Object.keys(ATTRIBUTE_VALUE) as AttributeName[]) {
		if (
			!(
				SIGNAL_PROJECTION_ARTIFACT.spanAttributeScopes[
					name
				] as readonly string[]
			).includes(facts.scope)
		)
			continue;
		const value = ATTRIBUTE_VALUE[name](facts);
		if (value !== undefined) attributes[name] = value;
	}
	return attributes;
}
