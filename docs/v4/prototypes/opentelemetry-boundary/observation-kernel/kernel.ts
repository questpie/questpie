import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { canonicalJsonLine } from "../../../../../packages/runtime/src/canonical-json";

export type PrincipalKind = "anonymous" | "service" | "user";
export type ExecutionEntry =
	| "direct"
	| "fetch"
	| "watch_initial"
	| "watch_recompute"
	| "worker";
export type DatabaseOperation =
	| "SELECT"
	| "INSERT"
	| "UPDATE"
	| "DELETE"
	| "CALL";
export type HttpMethod =
	| "CONNECT"
	| "DELETE"
	| "GET"
	| "HEAD"
	| "OPTIONS"
	| "PATCH"
	| "POST"
	| "PUT"
	| "TRACE"
	| "_OTHER";
export type ScopeKind =
	| "runtime"
	| "fetch"
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
	| "action.effect";
export type ObservationEventKind =
	| "context.completed"
	| "receipt.replayed"
	| "transaction.committed"
	| "operation.post_commit_ambiguous"
	| "durable.accepted"
	| "execution.cancelled"
	| "execution.deadline_exceeded"
	| "durable.fenced"
	| "durable.retry_scheduled"
	| "durable.terminal"
	| "action.ambiguous";
export type ObservationOutcome =
	| "ok"
	| "declared_error"
	| "framework_error"
	| "cancelled"
	| "deadline"
	| "ambiguous"
	| "fenced"
	| "retry";
export type ObservationDiagnostic =
	| "adapter_begin_fault"
	| "adapter_context_invalid"
	| "adapter_end_fault"
	| "adapter_event_fault"
	| "adapter_post_entry_fault"
	| "adapter_pre_entry_fault"
	| "adapter_reentry"
	| "counter_exhausted"
	| "envelope_limit"
	| "event_callback_fault";

export type NeutralTraceContextV1 = Readonly<{
	format: "questpie.trace-context";
	version: 1;
	traceId: Uint8Array;
	spanId: Uint8Array;
	flags: number;
}>;
export type ExecutionIdentityV2 = Readonly<{
	executionId: string;
	executionSequence: string;
}>;
export type ExtractedTraceContextV1 = Readonly<{
	context: NeutralTraceContextV1;
	tracestate: string | null;
}>;
export type ObservationTracePlanV1 =
	| Readonly<{ kind: "active-parent" }>
	| Readonly<{ kind: "remote-parent"; extracted: ExtractedTraceContextV1 }>
	| Readonly<{ kind: "root" }>
	| Readonly<{
			kind: "root-with-links";
			links: readonly NeutralTraceContextV1[];
	  }>;
type RuntimeStartV1 = Readonly<{
	kind: "runtime";
	principalKind: "service";
	trace: Readonly<{ kind: "root" }>;
}>;
type HttpStartV1 = Readonly<{
	kind: "fetch";
	requestKind: "generated_operation" | "unmatched";
	method: HttpMethod;
	principalKind: null;
	scheme: "http" | "https";
	suppressHttp: true;
	trace: ObservationTracePlanV1;
}>;
type RouteStartV1 = Readonly<{
	kind: "route";
	method: HttpMethod;
	principalKind: null;
	routeTemplate: string;
	scheme: "http" | "https";
	suppressHttp: true;
	trace: ObservationTracePlanV1;
}>;
export type ExecutionStartV1 = Readonly<{
	entry: ExecutionEntry;
	kind: "execution";
	principalKind: PrincipalKind;
	trace: ObservationTracePlanV1;
}>;
type OperationStartV1 = Readonly<{
	entry: ExecutionEntry;
	kind: "query" | "mutation" | "action";
	principalKind: PrincipalKind;
	resourceIdentity: string;
	trace: Readonly<{ kind: "active-parent" }>;
}>;
type TransactionStartV1 = Readonly<{
	kind: "transaction";
	principalKind: PrincipalKind;
	trace: Readonly<{ kind: "active-parent" }>;
	transactionId?: PostgresTransactionIdentity;
}>;
type PostgresStartV1 = Readonly<{
	databaseOperation: DatabaseOperation;
	kind: "postgresql";
	principalKind: PrincipalKind;
	statementIdentity: string;
	suppressPostgres: true;
	trace: Readonly<{ kind: "active-parent" }>;
}>;
type AcceptStartV1 = Readonly<{
	dispatchId?: string;
	kind: "job.accept" | "reaction.accept";
	principalKind: PrincipalKind;
	resourceIdentity: string;
	runId?: string;
	trace: Readonly<{ kind: "active-parent" }>;
}>;
type AttemptStartV1 = Readonly<{
	attemptId?: string;
	attemptNumber: number;
	dispatchId?: string;
	kind: "job.attempt" | "reaction.attempt";
	principalKind: PrincipalKind;
	resourceIdentity: string;
	runId?: string;
	trace: Readonly<{
		kind: "root-with-links";
		links: readonly NeutralTraceContextV1[];
	}>;
}>;
type EffectStartV1 = Readonly<{
	effectId?: string;
	kind: "action.effect";
	principalKind: PrincipalKind;
	resourceIdentity: string;
	trace: Readonly<{ kind: "active-parent" }>;
}>;
export type ObservationStartV1 =
	| RuntimeStartV1
	| HttpStartV1
	| RouteStartV1
	| ExecutionStartV1
	| OperationStartV1
	| TransactionStartV1
	| PostgresStartV1
	| AcceptStartV1
	| AttemptStartV1
	| EffectStartV1;
export type PostgresTransactionIdentity = string;
export type ObservationEventV1 =
	| Readonly<{ kind: "context.completed" | "receipt.replayed" }>
	| Readonly<{
			kind: "transaction.committed";
			transactionId?: PostgresTransactionIdentity;
	  }>
	| Readonly<{
			kind: "operation.post_commit_ambiguous";
			transactionId?: PostgresTransactionIdentity;
	  }>
	| Readonly<{
			dispatchId?: string;
			kind: "durable.accepted";
			runId?: string;
	  }>
	| Readonly<{
			kind: "execution.cancelled" | "execution.deadline_exceeded";
	  }>
	| Readonly<{ attemptId?: string; kind: "durable.fenced" }>
	| Readonly<{
			attemptNumber: number;
			kind: "durable.retry_scheduled";
			retryDelayMilliseconds: number;
	  }>
	| Readonly<{
			errorCode?: string;
			kind: "durable.terminal";
			outcome: ObservationOutcome;
	  }>
	| Readonly<{ effectId?: string; kind: "action.ambiguous" }>;
type OrdinaryEndOutcome =
	| "ok"
	| "declared_error"
	| "framework_error"
	| "cancelled"
	| "deadline";
export type ObservationEndV1 =
	| Readonly<{
			errorCode?: string;
			httpResponseStatusCode: number;
			kind: "fetch" | "route";
			outcome: Exclude<OrdinaryEndOutcome, "declared_error">;
	  }>
	| Readonly<{
			errorCode?: string;
			kind: "runtime" | "transaction" | "postgresql";
			outcome: "ok" | "framework_error" | "cancelled" | "deadline";
	  }>
	| Readonly<{
			errorCode?: string;
			kind: "execution" | "query";
			outcome: OrdinaryEndOutcome;
	  }>
	| Readonly<{
			errorCode?: string;
			kind: "mutation" | "action" | "action.effect";
			outcome: OrdinaryEndOutcome | "ambiguous";
	  }>
	| Readonly<{
			errorCode?: string;
			kind: "job.accept" | "reaction.accept";
			outcome: OrdinaryEndOutcome;
	  }>
	| Readonly<{
			errorCode?: string;
			kind: "job.attempt" | "reaction.attempt";
			outcome: OrdinaryEndOutcome | "fenced" | "retry";
	  }>;

export interface ObservationScopeAdapterV1 {
	readonly context: NeutralTraceContextV1 | null;
	run<Result>(use: () => Result | Promise<Result>): Promise<Result>;
	event(input: ObservationEventV1): void;
	end(input: ObservationEndV1): void;
}
export interface ObservationAdapterV1 {
	readonly format: "questpie.runtime-observability";
	readonly version: 1;
	extract(
		input: Readonly<{
			traceparent: string | null;
			tracestate: string | null;
		}>,
	): ExtractedTraceContextV1 | null;
	begin(
		input: ObservationStartV1 &
			Readonly<{ execution: ExecutionIdentityV2 | null }>,
	): ObservationScopeAdapterV1;
}

type EnvelopeCommonV2 = Readonly<{
	applicationIdentity: string;
	authorityClass: "ordinary";
	eventId: string;
	eventSequence: string;
	executionId: string | null;
	executionSequence: string | null;
	occurredAt: string;
	principalKind: PrincipalKind | null;
	resourceIdentity?: string;
	runtimeBuildDigest: string;
	runtimeInstanceId: string;
	scopeKind: ScopeKind;
	traceContext?: Readonly<{
		flags: number;
		spanId: readonly number[];
		traceId: readonly number[];
	}>;
	version: 2;
}>;
export type EnvelopeStartV2 =
	| Readonly<{ kind: "runtime" }>
	| Readonly<{
			kind: "fetch";
			method: HttpMethod;
			requestKind: "generated_operation" | "unmatched";
			scheme: "http" | "https";
	  }>
	| Readonly<{
			kind: "route";
			method: HttpMethod;
			routeTemplate: string;
			scheme: "http" | "https";
	  }>
	| Readonly<{ entry: ExecutionEntry; kind: "execution" }>
	| Readonly<{
			entry: ExecutionEntry;
			kind: "query" | "mutation" | "action";
	  }>
	| Readonly<{
			kind: "transaction";
			transactionId?: PostgresTransactionIdentity;
	  }>
	| Readonly<{
			databaseOperation: DatabaseOperation;
			kind: "postgresql";
			statementIdentity: string;
	  }>
	| Readonly<{
			dispatchId?: string;
			kind: "job.accept" | "reaction.accept";
			runId?: string;
	  }>
	| Readonly<{
			attemptId?: string;
			attemptNumber: number;
			dispatchId?: string;
			kind: "job.attempt" | "reaction.attempt";
			runId?: string;
	  }>
	| Readonly<{ effectId?: string; kind: "action.effect" }>;
export type ExecutionEventV2 =
	| (EnvelopeCommonV2 &
			Readonly<{ kind: "scope.started"; start: EnvelopeStartV2 }>)
	| (EnvelopeCommonV2 &
			Readonly<{
				kind: "scope.event";
				observationEvent: ObservationEventV1;
			}>)
	| (EnvelopeCommonV2 &
			Readonly<{ end: ObservationEndV1; kind: "scope.ended" }>);

type ActiveObservation = Readonly<{
	context: NeutralTraceContextV1 | null;
	suppressHttp: boolean;
	suppressPostgres: boolean;
}>;
export interface ObservationScope {
	readonly context: NeutralTraceContextV1 | null;
	run<Result>(use: () => Result | Promise<Result>): Promise<Result>;
	event(input: ObservationEventV1): void;
	end(input: ObservationEndV1): void;
}
export type ObservationKernelOptions = Readonly<{
	applicationIdentity: string;
	runtimeBuildDigest: string;
	adapter?: ObservationAdapterV1;
	events?: (event: ExecutionEventV2) => void;
	emitCanonicalLine?: (line: string) => void;
	onDiagnostic?: (diagnostic: ObservationDiagnostic) => void;
	createRuntimeInstanceId?: () => string;
	wallClock?: () => Date;
	maximumSequence?: bigint;
	maximumEnvelopeEventsPerExecution?: number;
	maximumEnvelopeLineBytes?: number;
}>;
export interface ObservationExecution {
	readonly identity: ExecutionIdentityV2;
	readonly scope: ObservationScope;
}
export interface ObservationKernel {
	readonly runtimeInstanceId: string;
	readonly hasAdapter: boolean;
	readonly hasCloseWork: false;
	readonly disabled: boolean;
	extract(
		input: Readonly<{
			traceparent: string | null;
			tracestate: string | null;
		}>,
	): ExtractedTraceContextV1 | null;
	beginExecution(input: ExecutionStartV1): ObservationExecution | null;
	beginScope(
		execution: ExecutionIdentityV2 | null,
		input: ObservationStartV1,
	): ObservationScope;
	current(): ActiveObservation | null;
	durableTraceContext(scope: ObservationScope): NeutralTraceContextV1 | null;
}

const UUID_V4 =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAXIMUM_UINT64 = 18_446_744_073_709_551_615n;
const UTF8 = new TextDecoder();
const UTF8_ENCODER = new TextEncoder();

function isPostgresTransactionIdentity(value: unknown): value is string {
	if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value))
		return false;
	return BigInt(value) <= MAXIMUM_UINT64;
}

function isUuid(value: unknown): value is string {
	return typeof value === "string" && UUID_V4.test(value);
}

function boundedIdentity(value: unknown): value is string {
	return (
		typeof value === "string" &&
		UTF8_ENCODER.encode(value).byteLength >= 1 &&
		UTF8_ENCODER.encode(value).byteLength <= 256
	);
}

function isValidTraceContext(
	value: NeutralTraceContextV1 | null | undefined,
): value is NeutralTraceContextV1 {
	return (
		value?.format === "questpie.trace-context" &&
		value.version === 1 &&
		value.traceId instanceof Uint8Array &&
		value.traceId.length === 16 &&
		value.traceId.some((byte) => byte !== 0) &&
		value.spanId instanceof Uint8Array &&
		value.spanId.length === 8 &&
		value.spanId.some((byte) => byte !== 0) &&
		Number.isInteger(value.flags) &&
		value.flags >= 0 &&
		value.flags <= 255
	);
}
function freezeTraceContext(
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
function isValidTracestate(value: string | null): boolean {
	return (
		value === null ||
		(new TextEncoder().encode(value).byteLength <= 512 &&
			/^[\x20-\x7e]+$/u.test(value))
	);
}
function traceProjection(context: NeutralTraceContextV1 | null) {
	return context === null
		? undefined
		: {
				flags: context.flags,
				spanId: [...context.spanId],
				traceId: [...context.traceId],
			};
}
function inertScope(): ObservationScope {
	return Object.freeze({
		context: null,
		run: async <Result>(use: () => Result | Promise<Result>) => await use(),
		event: () => undefined,
		end: () => undefined,
	});
}
function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be a positive safe integer`);
	return value;
}

function validateObservationStart(input: ObservationStartV1): void {
	if ("resourceIdentity" in input && !boundedIdentity(input.resourceIdentity))
		throw new TypeError("observation Resource identity is invalid");
	if (input.kind === "route" && !boundedIdentity(input.routeTemplate))
		throw new TypeError("observation route template is invalid");
	if (input.kind === "postgresql" && !boundedIdentity(input.statementIdentity))
		throw new TypeError("observation statement identity is invalid");
	if (
		input.kind === "transaction" &&
		input.transactionId !== undefined &&
		!isPostgresTransactionIdentity(input.transactionId)
	)
		throw new TypeError("observation transaction identity is invalid");
	if (
		(input.kind === "job.attempt" || input.kind === "reaction.attempt") &&
		(!Number.isInteger(input.attemptNumber) ||
			input.attemptNumber < 1 ||
			input.attemptNumber > 8)
	)
		throw new TypeError("observation attempt number is invalid");
	const optionalIds = input as Partial<
		Record<"dispatchId" | "runId" | "attemptId" | "effectId", unknown>
	>;
	for (const key of ["dispatchId", "runId", "attemptId", "effectId"] as const)
		if (optionalIds[key] !== undefined && !isUuid(optionalIds[key]))
			throw new TypeError(`observation ${key} is invalid`);
	if (input.trace.kind === "remote-parent") {
		if (
			!isValidTraceContext(input.trace.extracted.context) ||
			!isValidTracestate(input.trace.extracted.tracestate)
		)
			throw new TypeError("observation remote parent is invalid");
	}
	if (input.trace.kind === "root-with-links") {
		if (
			input.trace.links.length !== 1 ||
			!isValidTraceContext(input.trace.links[0])
		)
			throw new TypeError("observation creation link is invalid");
	}
}

const EVENT_SCOPES: Readonly<
	Record<ObservationEventKind, readonly ScopeKind[]>
> = Object.freeze({
	"context.completed": ["execution"],
	"receipt.replayed": ["mutation"],
	"transaction.committed": ["transaction"],
	"operation.post_commit_ambiguous": ["mutation"],
	"durable.accepted": ["job.accept", "reaction.accept"],
	"execution.cancelled": ["execution"],
	"execution.deadline_exceeded": ["execution"],
	"durable.fenced": ["job.attempt", "reaction.attempt"],
	"durable.retry_scheduled": ["job.attempt", "reaction.attempt"],
	"durable.terminal": ["job.attempt", "reaction.attempt"],
	"action.ambiguous": ["action.effect"],
});

function validateObservationEvent(
	scope: ScopeKind,
	input: ObservationEventV1,
): void {
	if (!EVENT_SCOPES[input.kind].includes(scope))
		throw new TypeError("observation event is invalid for its scope");
	if (
		("transactionId" in input &&
			input.transactionId !== undefined &&
			!isPostgresTransactionIdentity(input.transactionId)) ||
		("attemptNumber" in input &&
			(!Number.isInteger(input.attemptNumber) ||
				input.attemptNumber < 1 ||
				input.attemptNumber > 8)) ||
		("retryDelayMilliseconds" in input &&
			(!Number.isInteger(input.retryDelayMilliseconds) ||
				input.retryDelayMilliseconds < 0 ||
				input.retryDelayMilliseconds > 900_000))
	)
		throw new TypeError("observation event payload is invalid");
}

const END_OUTCOMES: Readonly<Record<ScopeKind, readonly ObservationOutcome[]>> =
	Object.freeze({
		runtime: ["ok", "framework_error", "cancelled", "deadline"],
		fetch: ["ok", "framework_error", "cancelled", "deadline"],
		route: ["ok", "framework_error", "cancelled", "deadline"],
		execution: [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
		],
		query: ["ok", "declared_error", "framework_error", "cancelled", "deadline"],
		mutation: [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
			"ambiguous",
		],
		action: [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
			"ambiguous",
		],
		transaction: ["ok", "framework_error", "cancelled", "deadline"],
		postgresql: ["ok", "framework_error", "cancelled", "deadline"],
		"job.accept": [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
		],
		"reaction.accept": [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
		],
		"job.attempt": [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
			"fenced",
			"retry",
		],
		"reaction.attempt": [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
			"fenced",
			"retry",
		],
		"action.effect": [
			"ok",
			"declared_error",
			"framework_error",
			"cancelled",
			"deadline",
			"ambiguous",
		],
	});

function validateObservationEnd(
	scope: ScopeKind,
	input: ObservationEndV1,
): void {
	if (input.kind !== scope || !END_OUTCOMES[scope].includes(input.outcome))
		throw new TypeError("observation end is invalid for its scope");
	if (
		(input.kind === "fetch" || input.kind === "route") &&
		(!Number.isInteger(input.httpResponseStatusCode) ||
			input.httpResponseStatusCode < 100 ||
			input.httpResponseStatusCode > 599)
	)
		throw new TypeError("observation HTTP status is invalid");
	if (input.errorCode !== undefined && !boundedIdentity(input.errorCode))
		throw new TypeError("observation error code is invalid");
}

function envelopeStart(input: ObservationStartV1): EnvelopeStartV2 {
	switch (input.kind) {
		case "runtime":
			return { kind: input.kind };
		case "fetch":
			return {
				kind: input.kind,
				method: input.method,
				requestKind: input.requestKind,
				scheme: input.scheme,
			};
		case "route":
			return {
				kind: input.kind,
				method: input.method,
				routeTemplate: input.routeTemplate,
				scheme: input.scheme,
			};
		case "execution":
		case "query":
		case "mutation":
		case "action":
			return { entry: input.entry, kind: input.kind };
		case "transaction":
			return {
				kind: input.kind,
				...(input.transactionId === undefined
					? {}
					: { transactionId: input.transactionId }),
			};
		case "postgresql":
			return {
				databaseOperation: input.databaseOperation,
				kind: input.kind,
				statementIdentity: input.statementIdentity,
			};
		case "job.accept":
		case "reaction.accept":
			return {
				...(input.dispatchId === undefined
					? {}
					: { dispatchId: input.dispatchId }),
				kind: input.kind,
				...(input.runId === undefined ? {} : { runId: input.runId }),
			};
		case "job.attempt":
		case "reaction.attempt":
			return {
				...(input.attemptId === undefined
					? {}
					: { attemptId: input.attemptId }),
				attemptNumber: input.attemptNumber,
				...(input.dispatchId === undefined
					? {}
					: { dispatchId: input.dispatchId }),
				kind: input.kind,
				...(input.runId === undefined ? {} : { runId: input.runId }),
			};
		case "action.effect":
			return {
				...(input.effectId === undefined ? {} : { effectId: input.effectId }),
				kind: input.kind,
			};
		default:
			return input satisfies never;
	}
}

export function createObservationKernel(
	options: ObservationKernelOptions,
): ObservationKernel {
	const instanceId = (options.createRuntimeInstanceId ?? randomUUID)();
	if (!UUID_V4.test(instanceId))
		throw new TypeError(
			"Runtime observation requires a non-zero UUIDv4 instance id",
		);
	if (
		options.adapter !== undefined &&
		(options.adapter.format !== "questpie.runtime-observability" ||
			options.adapter.version !== 1)
	)
		throw new TypeError("Runtime observation adapter is incompatible");
	const maximumSequence = options.maximumSequence ?? MAXIMUM_UINT64;
	if (maximumSequence < 1n || maximumSequence > MAXIMUM_UINT64)
		throw new RangeError(
			"maximumSequence must be an unsigned 64-bit positive value",
		);
	const maximumEvents = positiveInteger(
		options.maximumEnvelopeEventsPerExecution ?? 2_048,
		"maximumEnvelopeEventsPerExecution",
	);
	const maximumLineBytes = positiveInteger(
		options.maximumEnvelopeLineBytes ?? 65_536,
		"maximumEnvelopeLineBytes",
	);
	const adapter = options.adapter ?? null;
	const activeObservation = new AsyncLocalStorage<ActiveObservation>();
	const envelopeCounts = new Map<string, number>();
	const issuedExecutions = new WeakSet<ExecutionIdentityV2>();
	const endedExecutions = new WeakSet<ExecutionIdentityV2>();
	let executionSequence = 0n;
	let eventSequence = 0n;
	let disabled = false;
	let eventSinkEnabled = true;
	let lineSinkEnabled = true;

	const diagnostic = (code: ObservationDiagnostic) => {
		try {
			options.onDiagnostic?.(code);
		} catch {
			// Diagnostics are observation only.
		}
	};
	const exhaust = () => {
		if (!disabled) diagnostic("counter_exhausted");
		disabled = true;
	};
	const allocateExecution = (): ExecutionIdentityV2 | null => {
		if (disabled || executionSequence >= maximumSequence) {
			exhaust();
			return null;
		}
		executionSequence += 1n;
		const identity = Object.freeze({
			executionId: `${instanceId}:execution:${executionSequence}`,
			executionSequence: String(executionSequence),
		});
		issuedExecutions.add(identity);
		return identity;
	};
	const allocateEvent = () => {
		if (disabled || eventSequence >= maximumSequence) {
			exhaust();
			return null;
		}
		eventSequence += 1n;
		return {
			eventId: `${instanceId}:event:${eventSequence}`,
			eventSequence: String(eventSequence),
		};
	};
	const validateExecution = (execution: ExecutionIdentityV2 | null) => {
		if (execution === null) return;
		if (
			!issuedExecutions.has(execution) ||
			!/^(?:0|[1-9][0-9]*)$/u.test(execution.executionSequence) ||
			execution.executionId !==
				`${instanceId}:execution:${execution.executionSequence}`
		)
			throw new TypeError(
				"nested observation scope requires a local Execution identity",
			);
	};
	const emit = (event: ExecutionEventV2) => {
		const identity = event.executionId;
		if (identity !== null) {
			const count = envelopeCounts.get(identity) ?? 0;
			if (count >= maximumEvents) {
				diagnostic("envelope_limit");
				return;
			}
		}
		const bytes = canonicalJsonLine(event);
		if (bytes.byteLength > maximumLineBytes) {
			diagnostic("envelope_limit");
			return;
		}
		if (identity !== null)
			envelopeCounts.set(identity, (envelopeCounts.get(identity) ?? 0) + 1);
		const frozen = Object.freeze(event);
		if (eventSinkEnabled && options.events !== undefined) {
			try {
				options.events(frozen);
			} catch {
				eventSinkEnabled = false;
				diagnostic("event_callback_fault");
			}
		}
		if (lineSinkEnabled && options.emitCanonicalLine !== undefined) {
			try {
				options.emitCanonicalLine(UTF8.decode(bytes));
			} catch {
				lineSinkEnabled = false;
				diagnostic("event_callback_fault");
			}
		}
	};

	const beginScope = (
		execution: ExecutionIdentityV2 | null,
		input: ObservationStartV1,
	): ObservationScope => {
		validateExecution(execution);
		validateObservationStart(input);
		const ownsNoExecution =
			input.kind === "runtime" ||
			input.kind === "fetch" ||
			input.kind === "route";
		if (ownsNoExecution !== (execution === null))
			throw new TypeError(
				"observation scope has an invalid Execution identity owner",
			);
		if (execution !== null && endedExecutions.has(execution))
			return inertScope();
		const startedIdentity = allocateEvent();
		if (startedIdentity === null) return inertScope();
		let adapterScope: ObservationScopeAdapterV1 | null = null;
		let adapterContext: NeutralTraceContextV1 | null = null;
		if (adapter !== null) {
			let candidate: ObservationScopeAdapterV1 | null = null;
			try {
				candidate = adapter.begin({ ...input, execution });
			} catch {
				diagnostic("adapter_begin_fault");
			}
			try {
				if (candidate === null) throw new TypeError("adapter begin failed");
				const candidateContext = candidate.context;
				if (candidateContext !== null && !isValidTraceContext(candidateContext))
					throw new TypeError("adapter context is invalid");
				adapterScope = candidate;
				adapterContext = candidateContext;
			} catch {
				if (candidate !== null) diagnostic("adapter_context_invalid");
			}
		}
		let context: NeutralTraceContextV1 | null = null;
		if (adapterScope !== null) {
			context =
				adapterContext === null ? null : freezeTraceContext(adapterContext);
		}
		const base = (eventIdentity: {
			eventId: string;
			eventSequence: string;
		}): EnvelopeCommonV2 => ({
			applicationIdentity: options.applicationIdentity,
			authorityClass: "ordinary",
			...eventIdentity,
			executionId: execution?.executionId ?? null,
			executionSequence: execution?.executionSequence ?? null,
			occurredAt: (options.wallClock?.() ?? new Date()).toISOString(),
			principalKind: input.principalKind,
			...(!("resourceIdentity" in input)
				? {}
				: { resourceIdentity: input.resourceIdentity }),
			runtimeBuildDigest: options.runtimeBuildDigest,
			runtimeInstanceId: instanceId,
			scopeKind: input.kind,
			...(context === null ? {} : { traceContext: traceProjection(context) }),
			version: 2,
		});
		emit({
			...base(startedIdentity),
			kind: "scope.started",
			start: envelopeStart(input),
		});
		let ended = false;
		let adapterSignalsEnabled = adapterScope !== null;
		const scope: ObservationScope = {
			context,
			async run<Result>(use: () => Result | Promise<Result>) {
				const state: ActiveObservation = {
					context,
					suppressHttp: "suppressHttp" in input && input.suppressHttp === true,
					suppressPostgres:
						"suppressPostgres" in input && input.suppressPostgres === true,
				};
				if (adapterScope === null)
					return await activeObservation.run(state, use);
				let entries = 0;
				let entryOpen = true;
				let callbackPromise: Promise<Result> | null = null;
				const guardedUse = () => {
					if (!entryOpen) {
						diagnostic("adapter_reentry");
						throw new Error("adapter callback after entry closed");
					}
					entries += 1;
					if (entries > 1) {
						diagnostic("adapter_reentry");
						throw new Error("adapter callback re-entry");
					}
					callbackPromise = activeObservation.run(
						state,
						async () => await use(),
					);
					return callbackPromise;
				};
				let adapterFailed = false;
				try {
					await adapterScope.run(guardedUse);
				} catch {
					adapterFailed = true;
					if (entries === 0) {
						diagnostic("adapter_pre_entry_fault");
						return await activeObservation.run(
							{ ...state, context: null },
							use,
						);
					}
				} finally {
					entryOpen = false;
				}
				if (callbackPromise === null) {
					diagnostic("adapter_pre_entry_fault");
					return await activeObservation.run({ ...state, context: null }, use);
				}
				const result = await callbackPromise;
				if (adapterFailed) diagnostic("adapter_post_entry_fault");
				return result;
			},
			event(eventInput) {
				if (ended) return;
				validateObservationEvent(input.kind, eventInput);
				const eventIdentity = allocateEvent();
				if (
					eventIdentity !== null &&
					(execution === null || !endedExecutions.has(execution))
				)
					emit({
						...base(eventIdentity),
						kind: "scope.event",
						observationEvent: eventInput,
					});
				if (!adapterSignalsEnabled || adapterScope === null) return;
				try {
					adapterScope.event(eventInput);
				} catch {
					adapterSignalsEnabled = false;
					diagnostic("adapter_event_fault");
				}
			},
			end(endInput) {
				if (ended) return;
				validateObservationEnd(input.kind, endInput);
				ended = true;
				const eventIdentity = allocateEvent();
				if (
					eventIdentity !== null &&
					(execution === null || !endedExecutions.has(execution))
				)
					emit({
						...base(eventIdentity),
						end: endInput,
						kind: "scope.ended",
					});
				if (!adapterSignalsEnabled || adapterScope === null) return;
				try {
					adapterScope.end(endInput);
				} catch {
					diagnostic("adapter_end_fault");
				}
			},
		};
		return Object.freeze(scope);
	};

	return Object.freeze({
		get runtimeInstanceId() {
			return instanceId;
		},
		get hasAdapter() {
			return adapter !== null;
		},
		hasCloseWork: false,
		get disabled() {
			return disabled;
		},
		extract(input) {
			if (adapter === null) return null;
			try {
				const extracted = adapter.extract(input);
				if (extracted === null) return null;
				if (
					!isValidTraceContext(extracted.context) ||
					!isValidTracestate(extracted.tracestate)
				) {
					diagnostic("adapter_context_invalid");
					return null;
				}
				return Object.freeze({
					context: freezeTraceContext(extracted.context),
					tracestate: extracted.tracestate,
				});
			} catch {
				diagnostic("adapter_context_invalid");
				return null;
			}
		},
		beginExecution(input) {
			if ((input as ObservationStartV1).kind !== "execution")
				throw new TypeError("root observation entry must be an Execution");
			const identity = allocateExecution();
			if (identity === null) return null;
			const inner = beginScope(identity, input);
			let ended = false;
			const scope: ObservationScope = Object.freeze({
				context: inner.context,
				run: async <Result>(use: () => Result | Promise<Result>) =>
					await inner.run(use),
				event: (event: ObservationEventV1) => inner.event(event),
				end: (end: ObservationEndV1) => {
					if (ended) return;
					ended = true;
					try {
						inner.end(end);
					} finally {
						endedExecutions.add(identity);
						envelopeCounts.delete(identity.executionId);
					}
				},
			});
			return Object.freeze({ identity, scope });
		},
		beginScope,
		current: () => activeObservation.getStore() ?? null,
		durableTraceContext: (scope) =>
			adapter === null || scope.context === null
				? null
				: freezeTraceContext(scope.context),
	} satisfies ObservationKernel);
}

export function retainScopeThroughResponse(
	scope: ObservationScope,
	response: Response,
	kind: "fetch" | "route" = "fetch",
	signal?: AbortSignal,
): Response {
	if (response.body === null) {
		scope.end({
			httpResponseStatusCode: response.status,
			kind,
			outcome: signal?.aborted === true ? "cancelled" : "ok",
		});
		return response;
	}
	const reader = response.body.getReader();
	let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
	let finalized = false;
	const finalize = (outcome: "ok" | "framework_error" | "cancelled") => {
		if (finalized) return;
		finalized = true;
		if (signal !== undefined) signal.removeEventListener("abort", abort);
		scope.end({
			httpResponseStatusCode: response.status,
			kind,
			outcome,
		});
	};
	const abort = () => {
		finalize("cancelled");
		try {
			controller?.error(signal?.reason);
		} catch {
			// The downstream stream is already terminal.
		}
		void reader.cancel(signal?.reason).catch(() => undefined);
	};
	const body = new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
			if (signal?.aborted === true) abort();
			else signal?.addEventListener("abort", abort, { once: true });
		},
		async pull(controller) {
			if (finalized) return;
			try {
				const result = await reader.read();
				if (finalized) return;
				if (result.done) {
					finalize("ok");
					controller.close();
					return;
				}
				controller.enqueue(result.value);
			} catch (error) {
				finalize("framework_error");
				controller.error(error);
			}
		},
		cancel(reason) {
			finalize("cancelled");
			void reader.cancel(reason).catch(() => undefined);
		},
	});
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}
