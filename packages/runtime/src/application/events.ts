export type ExecutionEventV1 = Readonly<{
	envelope: Readonly<{
		format: "questpie.execution-envelope";
		version: 1;
		eventId: string;
		occurredAt: string;
		sequence: number;
		application: string;
		deploymentDigest: string;
		executionId: string | null;
		traceId: null;
		correlationId: string;
		causationId: null;
		actor: Readonly<{
			principalRef: string | null;
			tenantRef: null;
			authority: "ordinary";
		}>;
		links: readonly Readonly<{
			kind: "artifact" | "operation" | "operationCall";
			id: string;
		}>[];
	}>;
	durability: "telemetry";
	event:
		| Readonly<{
				family: "runtime";
				kind: "drainStarted" | "drainTimedOut" | "ready" | "stopped";
		  }>
		| Readonly<{
				family: "operation";
				kind: "accepted" | "failed" | "result";
				operation: string;
		  }>;
}>;

type EventBody = ExecutionEventV1["event"];

export function createEventEmitter(
	input: Readonly<{
		application: string;
		deploymentDigest: string;
		sink?: (event: ExecutionEventV1) => void;
		now?: () => Date;
	}>,
) {
	let sequence = 0;
	return (
		event: EventBody,
		facts: Readonly<{
			executionId?: string;
			correlationId?: string;
			principalRef?: string;
			links?: ExecutionEventV1["envelope"]["links"];
		}> = {},
	): void => {
		sequence += 1;
		const compare = (left: string, right: string) =>
			left < right ? -1 : left > right ? 1 : 0;
		const links = [...(facts.links ?? [])].sort((left, right) => {
			const kind = compare(left.kind, right.kind);
			return kind === 0 ? compare(left.id, right.id) : kind;
		});
		const emitted = Object.freeze({
			envelope: Object.freeze({
				format: "questpie.execution-envelope" as const,
				version: 1 as const,
				eventId: `event:${sequence}`,
				occurredAt: (input.now?.() ?? new Date()).toISOString(),
				sequence,
				application: input.application,
				deploymentDigest: input.deploymentDigest,
				executionId: facts.executionId ?? null,
				traceId: null,
				correlationId: facts.correlationId ?? `runtime:${sequence}`,
				causationId: null,
				actor: Object.freeze({
					principalRef: facts.principalRef ?? null,
					tenantRef: null,
					authority: "ordinary" as const,
				}),
				links: Object.freeze(links),
			}),
			durability: "telemetry" as const,
			event,
		});
		try {
			input.sink?.(emitted);
		} catch {
			// Telemetry is never application or lifecycle authority.
		}
	};
}
