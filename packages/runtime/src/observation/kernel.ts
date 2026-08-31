import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { canonicalJsonLine } from "../canonical-json";
import type {
	ActiveObservation,
	ExecutionEventV2,
	ExecutionIdentityV2,
	NeutralTraceContextV1,
	ObservationEndV1,
	ObservationEventV1,
	ObservationKernel,
	ObservationKernelOptions,
	ObservationScope,
	ObservationScopeAdapterV1,
	ObservationStartV1,
} from "./contract";
import { projectEnvelopeStart, projectTraceContext } from "./projection";
import {
	freezeTraceContext,
	isUuidV4,
	isValidTraceContext,
	isValidTracestate,
	validateObservationEnd,
	validateObservationEvent,
	validateObservationStart,
} from "./validation";

const MAX_UINT64 = 18_446_744_073_709_551_615n;
const DECODER = new TextDecoder();

function freezeEnvelope<Value>(value: Value): Value {
	if (typeof value !== "object" || value === null || Object.isFrozen(value))
		return value;
	for (const nested of Object.values(value)) freezeEnvelope(nested);
	return Object.freeze(value);
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be a positive safe integer`);
	return value;
}
function inertScope(): ObservationScope {
	return Object.freeze({
		context: null,
		run: async <Result>(use: () => Result | Promise<Result>) => await use(),
		event: () => undefined,
		end: () => undefined,
	});
}
export function createObservationKernel(
	options: ObservationKernelOptions,
): ObservationKernel {
	const runtimeInstanceId = (options.createRuntimeInstanceId ?? randomUUID)();
	if (!isUuidV4(runtimeInstanceId))
		throw new TypeError(
			"Runtime observation requires a non-zero UUIDv4 instance id",
		);
	if (
		options.adapter !== undefined &&
		(options.adapter.format !== "questpie.runtime-observability" ||
			options.adapter.version !== 1)
	)
		throw new TypeError("Runtime observation adapter is incompatible");
	const maximumSequence = options.maximumSequence ?? MAX_UINT64;
	if (maximumSequence < 1n || maximumSequence > MAX_UINT64)
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
	const active = new AsyncLocalStorage<ActiveObservation>();
	const envelopeCounts = new Map<string, number>();
	const issued = new WeakSet<ExecutionIdentityV2>();
	const endedExecutions = new WeakSet<ExecutionIdentityV2>();
	let executionSequence = 0n;
	let eventSequence = 0n;
	let disabled = false;
	let eventSinkEnabled = true;
	let lineSinkEnabled = true;

	const diagnostic = (
		code: Parameters<NonNullable<ObservationKernelOptions["onDiagnostic"]>>[0],
	) => {
		try {
			options.onDiagnostic?.(code);
		} catch {
			/* Observation cannot affect work. */
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
			executionId: `${runtimeInstanceId}:execution:${executionSequence}`,
			executionSequence: String(executionSequence),
		});
		issued.add(identity);
		return identity;
	};
	const allocateEvent = () => {
		if (disabled || eventSequence >= maximumSequence) {
			exhaust();
			return null;
		}
		eventSequence += 1n;
		return {
			eventId: `${runtimeInstanceId}:event:${eventSequence}`,
			eventSequence: String(eventSequence),
		};
	};
	const validateExecution = (execution: ExecutionIdentityV2 | null) => {
		if (execution === null) return;
		if (
			!issued.has(execution) ||
			!/^[1-9][0-9]*$/u.test(execution.executionSequence) ||
			execution.executionId !==
				`${runtimeInstanceId}:execution:${execution.executionSequence}`
		)
			throw new TypeError(
				"nested observation scope requires a local Execution identity",
			);
	};
	const emit = (event: ExecutionEventV2) => {
		if (
			event.executionId !== null &&
			(envelopeCounts.get(event.executionId) ?? 0) >= maximumEvents
		) {
			diagnostic("envelope_limit");
			return;
		}
		const frozen = freezeEnvelope(event);
		const bytes = canonicalJsonLine(frozen);
		if (bytes.byteLength > maximumLineBytes) {
			diagnostic("envelope_limit");
			return;
		}
		if (event.executionId !== null)
			envelopeCounts.set(
				event.executionId,
				(envelopeCounts.get(event.executionId) ?? 0) + 1,
			);
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
				options.emitCanonicalLine(DECODER.decode(bytes));
			} catch {
				lineSinkEnabled = false;
				diagnostic("event_callback_fault");
			}
		}
	};

	const beginScope = (
		execution: ExecutionIdentityV2 | null,
		input: ObservationStartV1,
		allowExecution = false,
	): ObservationScope => {
		validateExecution(execution);
		if (input.kind === "execution" && !allowExecution)
			throw new TypeError("root Execution must begin through beginExecution");
		validateObservationStart(input);
		const withoutExecution =
			input.kind === "runtime" ||
			input.kind === "fetch" ||
			input.kind === "route";
		if (withoutExecution !== (execution === null))
			throw new TypeError(
				"observation scope has an invalid Execution identity owner",
			);
		if (execution !== null && endedExecutions.has(execution))
			return inertScope();
		const startIdentity = allocateEvent();
		if (startIdentity === null) return inertScope();

		let adapterScope: ObservationScopeAdapterV1 | null = null;
		let context: NeutralTraceContextV1 | null = null;
		if (adapter !== null) {
			let candidate: ObservationScopeAdapterV1 | null = null;
			try {
				candidate = adapter.begin({ ...input, execution });
			} catch {
				diagnostic("adapter_begin_fault");
			}
			if (candidate !== null) {
				try {
					const candidateContext = candidate.context;
					if (
						candidateContext !== null &&
						!isValidTraceContext(candidateContext)
					)
						throw new TypeError("adapter context is invalid");
					adapterScope = candidate;
					context =
						candidateContext === null
							? null
							: freezeTraceContext(candidateContext);
				} catch {
					diagnostic("adapter_context_invalid");
				}
			}
		}
		const base = (identity: { eventId: string; eventSequence: string }) => ({
			applicationIdentity: options.applicationIdentity,
			authorityClass: "ordinary" as const,
			...identity,
			executionId: execution?.executionId ?? null,
			executionSequence: execution?.executionSequence ?? null,
			occurredAt: (options.wallClock?.() ?? new Date()).toISOString(),
			principalKind: input.principalKind,
			...("resourceIdentity" in input
				? { resourceIdentity: input.resourceIdentity }
				: {}),
			runtimeBuildDigest: options.runtimeBuildDigest,
			runtimeInstanceId,
			scopeKind: input.kind,
			...(context === null
				? {}
				: { traceContext: projectTraceContext(context) }),
			version: 2 as const,
		});
		emit({
			...base(startIdentity),
			kind: "scope.started",
			start: projectEnvelopeStart(input),
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
				if (adapterScope === null) return await active.run(state, use);
				let entries = 0;
				let entryOpen = true;
				let callbackPromise: Promise<Result> | null = null;
				const guardedUse = () => {
					if (!entryOpen || entries > 0) {
						diagnostic("adapter_reentry");
						throw new Error("adapter callback re-entry");
					}
					entries += 1;
					callbackPromise = active.run(state, async () => await use());
					return callbackPromise;
				};
				let adapterFailed = false;
				try {
					await adapterScope.run(guardedUse);
				} catch {
					adapterFailed = true;
					if (entries === 0) {
						diagnostic("adapter_pre_entry_fault");
						return await active.run({ ...state, context: null }, use);
					}
				} finally {
					entryOpen = false;
				}
				if (callbackPromise === null) {
					diagnostic("adapter_pre_entry_fault");
					return await active.run({ ...state, context: null }, use);
				}
				const result = await callbackPromise;
				if (adapterFailed) diagnostic("adapter_post_entry_fault");
				return result;
			},
			event(eventInput: ObservationEventV1) {
				if (ended) return;
				validateObservationEvent(input.kind, eventInput);
				const identity = allocateEvent();
				if (
					identity !== null &&
					(execution === null || !endedExecutions.has(execution))
				)
					emit({
						...base(identity),
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
			end(endInput: ObservationEndV1) {
				if (ended) return;
				validateObservationEnd(input.kind, endInput);
				ended = true;
				const identity = allocateEvent();
				if (
					identity !== null &&
					(execution === null || !endedExecutions.has(execution))
				)
					emit({ ...base(identity), end: endInput, kind: "scope.ended" });
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
			return runtimeInstanceId;
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
			const inner = beginScope(identity, input, true);
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
		beginScope: (execution, input) => beginScope(execution, input),
		current: () => active.getStore() ?? null,
		durableTraceContext: (scope) =>
			adapter === null || scope.context === null
				? null
				: freezeTraceContext(scope.context),
	} satisfies ObservationKernel);
}
