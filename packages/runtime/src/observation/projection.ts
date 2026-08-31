import type {
	EnvelopeStartV2,
	NeutralTraceContextV1,
	ObservationStartV1,
} from "./contract";

export function projectTraceContext(context: NeutralTraceContextV1 | null) {
	return context === null
		? undefined
		: {
				flags: context.flags,
				spanId: [...context.spanId],
				traceId: [...context.traceId],
			};
}

/** Removes adapter-only execution controls from the canonical Envelope. */
export function projectEnvelopeStart(
	input: ObservationStartV1,
): EnvelopeStartV2 {
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
