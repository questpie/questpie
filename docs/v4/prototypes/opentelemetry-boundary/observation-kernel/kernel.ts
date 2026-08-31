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
type ExecutionStartV1 = Readonly<{
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
	transactionId?: string;
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
export type ObservationEventV1 =
	| Readonly<{ kind: "context.completed" | "receipt.replayed" }>
	| Readonly<{ kind: "transaction.committed"; transactionId?: string }>
	| Readonly<{
			kind: "operation.post_commit_ambiguous";
			transactionId?: string;
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
export type ObservationEndV1 =
	| Readonly<{
			errorCode?: string;
			httpResponseStatusCode: number;
			kind: "fetch" | "route";
			outcome: ObservationOutcome;
	  }>
	| Readonly<{
			errorCode?: string;
			kind: Exclude<ScopeKind, "fetch" | "route">;
			outcome: ObservationOutcome;
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
export type ExecutionEventV2 =
	| (EnvelopeCommonV2 & Readonly<{ kind: "scope.started" }>)
	| (EnvelopeCommonV2 &
			Readonly<{
				kind: "scope.event";
				observationEvent: ObservationEventV1;
			}>)
	| (EnvelopeCommonV2 &
			Readonly<{ kind: "scope.ended"; outcome: ObservationOutcome }>);

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
	beginExecution(input: ObservationStartV1): ObservationExecution | null;
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
		return Object.freeze({
			executionId: `${instanceId}:execution:${executionSequence}`,
			executionSequence: String(executionSequence),
		});
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
		if (adapter !== null) {
			try {
				adapterScope = adapter.begin({ ...input, execution });
			} catch {
				diagnostic("adapter_begin_fault");
			}
		}
		let context: NeutralTraceContextV1 | null = null;
		if (adapterScope !== null) {
			if (adapterScope.context === null) context = null;
			else if (isValidTraceContext(adapterScope.context))
				context = freezeTraceContext(adapterScope.context);
			else {
				diagnostic("adapter_context_invalid");
				adapterScope = null;
			}
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
		emit({ ...base(startedIdentity), kind: "scope.started" });
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
				let callbackPromise: Promise<Result> | null = null;
				const guardedUse = () => {
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
				if (endInput.kind !== input.kind)
					throw new TypeError("observation end kind must match its scope");
				ended = true;
				const eventIdentity = allocateEvent();
				if (
					eventIdentity !== null &&
					(execution === null || !endedExecutions.has(execution))
				)
					emit({
						...base(eventIdentity),
						kind: "scope.ended",
						outcome: endInput.outcome,
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
): Response {
	if (response.body === null) {
		scope.end({
			httpResponseStatusCode: response.status,
			kind,
			outcome: "ok",
		});
		return response;
	}
	const reader = response.body.getReader();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const result = await reader.read();
				if (result.done) {
					controller.close();
					scope.end({
						httpResponseStatusCode: response.status,
						kind,
						outcome: "ok",
					});
					return;
				}
				controller.enqueue(result.value);
			} catch (error) {
				scope.end({
					httpResponseStatusCode: response.status,
					kind,
					outcome: "framework_error",
				});
				controller.error(error);
			}
		},
		async cancel(reason) {
			try {
				await reader.cancel(reason);
			} finally {
				scope.end({
					httpResponseStatusCode: response.status,
					kind,
					outcome: "cancelled",
				});
			}
		},
	});
	return new Response(body, {
		headers: response.headers,
		status: response.status,
		statusText: response.statusText,
	});
}
