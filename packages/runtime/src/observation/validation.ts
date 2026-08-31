import type {
	DurableFailureCode,
	IngressTracePlanV1,
	NeutralTraceContextV1,
	ObservationEndV1,
	ObservationEventKind,
	ObservationEventV1,
	ObservationStartV1,
	ScopeKind,
} from "./contract";
import { END_OUTCOMES, EVENT_OUTCOMES, EVENT_SCOPES } from "./grammar";

const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const ENCODER = new TextEncoder();

export function isUuidV4(value: unknown): value is string {
	return typeof value === "string" && UUID_V4.test(value);
}
function isXid8(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[1-9][0-9]{0,19}$/u.test(value) &&
		BigInt(value) <= MAX_UINT64
	);
}
function boundedIdentity(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const bytes = ENCODER.encode(value).byteLength;
	return bytes >= 1 && bytes <= 256;
}
export function isValidTraceContext(
	value: unknown,
): value is NeutralTraceContextV1 {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const context = value as NeutralTraceContextV1;
	return (
		exactKeys(
			context,
			["format", "version", "traceId", "spanId", "flags"],
			["format", "version", "traceId", "spanId", "flags"],
		) &&
		context.format === "questpie.trace-context" &&
		context.version === 1 &&
		context.traceId instanceof Uint8Array &&
		context.traceId.length === 16 &&
		context.traceId.some((byte) => byte !== 0) &&
		context.spanId instanceof Uint8Array &&
		context.spanId.length === 8 &&
		context.spanId.some((byte) => byte !== 0) &&
		Number.isInteger(context.flags) &&
		context.flags >= 0 &&
		context.flags <= 255
	);
}
export function freezeTraceContext(
	value: NeutralTraceContextV1,
): NeutralTraceContextV1 {
	return Object.freeze({
		format: "questpie.trace-context",
		version: 1,
		traceId: Uint8Array.from(value.traceId),
		spanId: Uint8Array.from(value.spanId),
		flags: value.flags,
	});
}
export function isValidTracestate(value: unknown): value is string | null {
	return (
		value === null ||
		(typeof value === "string" &&
			ENCODER.encode(value).byteLength <= 512 &&
			/^[\x20-\x7e]+$/u.test(value))
	);
}
function exactKeys(
	value: object,
	allowed: readonly string[],
	required: readonly string[],
): boolean {
	const allow = new Set(allowed);
	return (
		Reflect.ownKeys(value).every(
			(key) => typeof key === "string" && allow.has(key),
		) && required.every((key) => Object.hasOwn(value, key))
	);
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validTracePlan(
	value: unknown,
	allowedKinds: readonly string[],
): boolean {
	if (
		!isRecord(value) ||
		typeof value.kind !== "string" ||
		!allowedKinds.includes(value.kind)
	)
		return false;
	switch (value.kind) {
		case "active-parent":
		case "root":
			return exactKeys(value, ["kind"], ["kind"]);
		case "remote-parent": {
			if (
				!exactKeys(value, ["kind", "extracted"], ["kind", "extracted"]) ||
				!isRecord(value.extracted)
			)
				return false;
			return (
				exactKeys(
					value.extracted,
					["context", "tracestate"],
					["context", "tracestate"],
				) &&
				isValidTraceContext(value.extracted.context) &&
				isValidTracestate(value.extracted.tracestate)
			);
		}
		case "root-with-links":
			return (
				exactKeys(value, ["kind", "links"], ["kind", "links"]) &&
				Array.isArray(value.links) &&
				value.links.length === 1 &&
				value.links.every(isValidTraceContext)
			);
		default:
			return false;
	}
}

export function decodeIngressTracePlan(
	value: unknown,
): IngressTracePlanV1 | null {
	if (!validTracePlan(value, ["remote-parent", "root-with-links"])) return null;
	const plan = value as IngressTracePlanV1;
	if (plan.kind === "remote-parent")
		return Object.freeze({
			extracted: Object.freeze({
				context: freezeTraceContext(plan.extracted.context),
				tracestate: plan.extracted.tracestate,
			}),
			kind: "remote-parent",
		});
	return Object.freeze({
		kind: "root-with-links",
		links: Object.freeze([freezeTraceContext(plan.links[0])]) as readonly [
			NeutralTraceContextV1,
		],
	});
}

type Shape = Readonly<{
	allowed: readonly string[];
	required: readonly string[];
}>;
const shape = (
	required: readonly string[],
	optional: readonly string[] = [],
): Shape => ({ required, allowed: [...required, ...optional] });
const operation = shape([
	"entry",
	"kind",
	"principalKind",
	"resourceIdentity",
	"trace",
]);
const accept = shape(
	["kind", "principalKind", "resourceIdentity", "trace"],
	["dispatchId", "runId"],
);
const attempt = shape(
	["attemptNumber", "kind", "principalKind", "resourceIdentity", "trace"],
	["attemptId", "dispatchId", "runId"],
);
const START_SHAPES: Readonly<Record<ScopeKind, Shape>> = {
	runtime: shape(["kind", "principalKind", "trace"]),
	fetch: shape([
		"kind",
		"requestKind",
		"method",
		"principalKind",
		"scheme",
		"suppressHttp",
		"trace",
	]),
	route: shape([
		"kind",
		"method",
		"principalKind",
		"routeTemplate",
		"scheme",
		"suppressHttp",
		"trace",
	]),
	execution: shape(["entry", "kind", "principalKind", "trace"]),
	query: operation,
	mutation: operation,
	action: operation,
	transaction: shape(["kind", "principalKind", "trace"], ["transactionId"]),
	postgresql: shape([
		"databaseOperation",
		"kind",
		"principalKind",
		"statementIdentity",
		"suppressPostgres",
		"trace",
	]),
	"job.accept": accept,
	"reaction.accept": accept,
	"job.attempt": attempt,
	"reaction.attempt": attempt,
	"action.effect": shape(
		["kind", "principalKind", "resourceIdentity", "trace"],
		["effectId"],
	),
};
const ENTRIES = new Set([
	"direct",
	"fetch",
	"watch_initial",
	"watch_recompute",
	"worker",
]);
const PRINCIPALS = new Set(["anonymous", "service", "user"]);
const METHODS = new Set([
	"CONNECT",
	"DELETE",
	"GET",
	"HEAD",
	"OPTIONS",
	"PATCH",
	"POST",
	"PUT",
	"TRACE",
	"_OTHER",
]);
const DB_OPERATIONS = new Set(["SELECT", "INSERT", "UPDATE", "DELETE", "CALL"]);

export function validateObservationStart(input: ObservationStartV1): void {
	if (
		!isRecord(input) ||
		typeof input.kind !== "string" ||
		!(input.kind in START_SHAPES)
	)
		throw new TypeError("observation start kind is invalid");
	const value = input as unknown as Readonly<Record<string, unknown>>;
	const kind = input.kind as ScopeKind;
	const member = START_SHAPES[kind];
	if (!exactKeys(input, member.allowed, member.required))
		throw new TypeError("observation start shape is invalid");
	if (
		(kind === "runtime" && input.principalKind !== "service") ||
		((kind === "fetch" || kind === "route") && input.principalKind !== null) ||
		(!["runtime", "fetch", "route"].includes(kind) &&
			!PRINCIPALS.has(input.principalKind as string))
	)
		throw new TypeError("observation principal kind is invalid");
	if ("entry" in input && !ENTRIES.has(input.entry))
		throw new TypeError("observation entry is invalid");
	if ("method" in input && !METHODS.has(input.method))
		throw new TypeError("observation method is invalid");
	if ("scheme" in input && input.scheme !== "http" && input.scheme !== "https")
		throw new TypeError("observation scheme is invalid");
	if (
		kind === "fetch" &&
		value.requestKind !== "generated_operation" &&
		value.requestKind !== "unmatched"
	)
		throw new TypeError("observation request kind is invalid");
	if (
		kind === "postgresql" &&
		(!DB_OPERATIONS.has(value.databaseOperation as string) ||
			value.suppressPostgres !== true ||
			!boundedIdentity(value.statementIdentity))
	)
		throw new TypeError("observation PostgreSQL start is invalid");
	if ((kind === "fetch" || kind === "route") && value.suppressHttp !== true)
		throw new TypeError("observation HTTP suppression is invalid");
	if ("resourceIdentity" in input && !boundedIdentity(input.resourceIdentity))
		throw new TypeError("observation Resource identity is invalid");
	if (kind === "route" && !boundedIdentity(value.routeTemplate))
		throw new TypeError("observation route template is invalid");
	if (
		kind === "transaction" &&
		value.transactionId !== undefined &&
		!isXid8(value.transactionId)
	)
		throw new TypeError("observation transaction identity is invalid");
	if (
		(kind === "job.attempt" || kind === "reaction.attempt") &&
		(!Number.isInteger(value.attemptNumber) ||
			(value.attemptNumber as number) < 1 ||
			(value.attemptNumber as number) > 8)
	)
		throw new TypeError("observation attempt number is invalid");
	for (const key of ["dispatchId", "runId", "attemptId", "effectId"] as const)
		if (value[key] !== undefined && !isUuidV4(value[key]))
			throw new TypeError(`observation ${key} is invalid`);
	const allowedTrace =
		kind === "runtime"
			? ["root"]
			: kind === "fetch" || kind === "route"
				? ["active-parent", "remote-parent", "root", "root-with-links"]
				: kind === "execution"
					? ["active-parent", "root"]
					: kind === "job.attempt" || kind === "reaction.attempt"
						? ["root", "root-with-links"]
						: ["active-parent"];
	if (!validTracePlan(input.trace, allowedTrace))
		throw new TypeError("observation start trace plan is invalid");
}

const EVENT_KEYS: Readonly<Record<ObservationEventKind, Shape>> = {
	"context.completed": shape(["kind"]),
	"receipt.replayed": shape(["kind"]),
	"transaction.committed": shape(["kind"], ["transactionId"]),
	"operation.post_commit_ambiguous": shape(["kind"], ["transactionId"]),
	"durable.accepted": shape(["kind"], ["dispatchId", "runId"]),
	"execution.cancelled": shape(["kind"]),
	"execution.deadline_exceeded": shape(["kind"]),
	"durable.fenced": shape(["kind"], ["attemptId"]),
	"durable.retry_scheduled": shape([
		"kind",
		"attemptNumber",
		"retryDelayMilliseconds",
	]),
	"durable.terminal": shape(["kind", "outcome"], ["errorCode"]),
	"action.ambiguous": shape(["kind"], ["effectId"]),
};
const FAILURE_CODES = new Set<DurableFailureCode>([
	"EFFECT_AMBIGUOUS",
	"EFFECT_CONFLICT",
	"HANDLER_FAILED",
	"REACTION_ERROR",
	"RESOURCE_LIMIT",
	"RETRY_EXHAUSTED",
	"RUN_AS_DENIED",
	"VALIDATION_FAILED",
]);
export function validateObservationEvent(
	scope: ScopeKind,
	input: ObservationEventV1,
): void {
	if (
		!isRecord(input) ||
		!(input.kind in EVENT_SCOPES) ||
		!EVENT_SCOPES[input.kind].includes(scope)
	)
		throw new TypeError("observation event is invalid for its scope");
	const value = input as unknown as Readonly<Record<string, unknown>>;
	const member = EVENT_KEYS[input.kind];
	if (!exactKeys(input, member.allowed, member.required))
		throw new TypeError("observation event shape is invalid");
	if (
		"transactionId" in input &&
		input.transactionId !== undefined &&
		!isXid8(input.transactionId)
	)
		throw new TypeError("observation event transaction is invalid");
	for (const key of ["dispatchId", "runId", "attemptId", "effectId"] as const)
		if (value[key] !== undefined && !isUuidV4(value[key]))
			throw new TypeError("observation event identity is invalid");
	if (
		"attemptNumber" in input &&
		(!Number.isInteger(input.attemptNumber) ||
			input.attemptNumber < 1 ||
			input.attemptNumber > 8)
	)
		throw new TypeError("observation event attempt is invalid");
	if (
		"retryDelayMilliseconds" in input &&
		(!Number.isInteger(input.retryDelayMilliseconds) ||
			input.retryDelayMilliseconds < 0 ||
			input.retryDelayMilliseconds > 900_000)
	)
		throw new TypeError("observation retry delay is invalid");
	if (
		input.kind === "durable.terminal" &&
		(!EVENT_OUTCOMES["durable.terminal"].includes(input.outcome) ||
			(input.errorCode !== undefined && !FAILURE_CODES.has(input.errorCode)))
	)
		throw new TypeError("observation terminal event is invalid");
}

export function validateObservationEnd(
	scope: ScopeKind,
	input: ObservationEndV1,
): void {
	if (
		!isRecord(input) ||
		typeof input.kind !== "string" ||
		!(input.kind in END_OUTCOMES)
	)
		throw new TypeError("observation end kind is invalid");
	const http = input.kind === "fetch" || input.kind === "route";
	if (
		!exactKeys(
			input,
			http
				? ["errorCode", "httpResponseStatusCode", "kind", "outcome"]
				: ["errorCode", "kind", "outcome"],
			http
				? ["httpResponseStatusCode", "kind", "outcome"]
				: ["kind", "outcome"],
		)
	)
		throw new TypeError("observation end shape is invalid");
	if (input.kind !== scope || !END_OUTCOMES[scope].includes(input.outcome))
		throw new TypeError("observation end is invalid for its scope");
	if (http) {
		if (input.httpResponseStatusCode === null) {
			if (
				input.outcome !== "framework_error" &&
				input.outcome !== "cancelled" &&
				input.outcome !== "deadline"
			)
				throw new TypeError("observation HTTP status is invalid");
		} else if (
			!Number.isInteger(input.httpResponseStatusCode) ||
			input.httpResponseStatusCode < 100 ||
			input.httpResponseStatusCode > 599
		)
			throw new TypeError("observation HTTP status is invalid");
	}
	if (input.errorCode !== undefined && !boundedIdentity(input.errorCode))
		throw new TypeError("observation end error code is invalid");
}
