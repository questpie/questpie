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
export type DurableFailureCode =
	| "EFFECT_AMBIGUOUS"
	| "EFFECT_CONFLICT"
	| "CHECKPOINT_INVALID"
	| "HANDLER_FAILED"
	| "REACTION_ERROR"
	| "RESOURCE_LIMIT"
	| "RETRY_EXHAUSTED"
	| "RUN_AS_DENIED"
	| "VALIDATION_FAILED";
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
export type IngressTracePlanV1 =
	| Readonly<{ kind: "remote-parent"; extracted: ExtractedTraceContextV1 }>
	| Readonly<{
			kind: "root-with-links";
			links: readonly [NeutralTraceContextV1];
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
type FetchStartV1 = Readonly<{
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
	trace: Readonly<{ kind: "active-parent" }> | Readonly<{ kind: "root" }>;
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
type AttemptStartBaseV1 = Readonly<{
	attemptId?: string;
	attemptNumber: number;
	dispatchId?: string;
	principalKind: PrincipalKind;
	resourceIdentity: string;
	runId?: string;
	trace:
		| Readonly<{ kind: "root" }>
		| Readonly<{
				kind: "root-with-links";
				links: readonly NeutralTraceContextV1[];
		  }>;
}>;
type AttemptStartV1 = AttemptStartBaseV1 &
	(
		| Readonly<{ kind: "job.attempt"; queueDelayMilliseconds: number }>
		| Readonly<{ kind: "reaction.attempt" }>
	);
type EffectStartV1 = Readonly<{
	effectId?: string;
	kind: "action.effect";
	principalKind: PrincipalKind;
	resourceIdentity: string;
	trace: Readonly<{ kind: "active-parent" }>;
}>;
export type ObservationStartV1 =
	| RuntimeStartV1
	| FetchStartV1
	| RouteStartV1
	| ExecutionStartV1
	| OperationStartV1
	| TransactionStartV1
	| PostgresStartV1
	| AcceptStartV1
	| AttemptStartV1
	| EffectStartV1;
export type ExecutionChildStartV1 = Exclude<
	ObservationStartV1,
	Readonly<{ kind: "runtime" | "fetch" | "route" | "execution" }>
>;

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
	| Readonly<{ dispatchId?: string; kind: "durable.accepted"; runId?: string }>
	| Readonly<{ kind: "execution.cancelled" | "execution.deadline_exceeded" }>
	| Readonly<{ attemptId?: string; kind: "durable.fenced" }>
	| Readonly<{
			attemptNumber: number;
			kind: "durable.retry_scheduled";
			retryDelayMilliseconds: number;
	  }>
	| Readonly<{
			errorCode?: DurableFailureCode;
			kind: "durable.terminal";
			outcome: "ok" | "framework_error" | "cancelled";
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
			httpResponseStatusCode: null;
			kind: "fetch" | "route";
			outcome: "framework_error" | "cancelled" | "deadline";
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
		input: Readonly<{ traceparent: string | null; tracestate: string | null }>,
	): IngressTracePlanV1 | null;
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
	| Readonly<{
			entry: ExecutionEntry;
			kind: "execution" | "query" | "mutation" | "action";
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
			Readonly<{ kind: "scope.event"; observationEvent: ObservationEventV1 }>)
	| (EnvelopeCommonV2 &
			Readonly<{ end: ObservationEndV1; kind: "scope.ended" }>);

export type ActiveObservation = Readonly<{
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
	readonly observation: RuntimeExecutionObservation;
	readonly scope: ObservationScope;
}
export interface RuntimeExecutionObservation {
	begin(input: ExecutionChildStartV1): ObservationScope;
}
export interface ObservationKernel {
	readonly runtimeInstanceId: string;
	readonly hasAdapter: boolean;
	readonly hasCloseWork: false;
	readonly disabled: boolean;
	extract(
		input: Readonly<{ traceparent: string | null; tracestate: string | null }>,
	): IngressTracePlanV1 | null;
	beginExecution(input: ExecutionStartV1): ObservationExecution | null;
	beginScope(
		execution: ExecutionIdentityV2 | null,
		input: ObservationStartV1,
	): ObservationScope;
	current(): ActiveObservation | null;
	durableTraceContext(scope: ObservationScope): NeutralTraceContextV1 | null;
}
