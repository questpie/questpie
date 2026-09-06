import { digest } from "../canonical";

const emptyJobProjectionDigest = digest("questpie-job-projection-v1", {
	format: "questpie.job-projection",
	version: 1,
	jobs: [],
});

/** Render inside startup's cleanup boundary after verified Runtime readiness. */
export function renderStaticScheduleOwner(
	input: Readonly<{
		application: string;
		contextDefinition: string;
	}>,
): string {
	return `schedules = createPostgresStaticSchedules({
			database,
			artifact: JSON.parse(loaded.artifactFiles["job-schedules.json"]),
			bindings: {
				application: ${JSON.stringify(input.application)},
				compilerRuntimeBuildDigest: loaded.artifacts.runtimeBuild.compilerRuntimeBuildDigest,
				jobProjectionDigest: loaded.artifacts.runtimeBuild.later.jobDigest ?? ${JSON.stringify(emptyJobProjectionDigest)},
			},
			accept: (request) => {
				const job = mutationArtifacts.jobs.byIdentity.get(request.schedule.jobIdentity);
				if (!job) throw new TypeError("Schedule Job executable is unavailable");
				const contextInput = decodeRuntimeCodec(${input.contextDefinition}.input, JSON.parse(request.schedule.contextJson), "$schedule.context");
				const jobInput = decodeRuntimeCodec(job.input, JSON.parse(request.schedule.inputJson), "$schedule.input");
				const causationId = "schedule:" + request.tickId;
				return runtime.execution({
					principal: durablePrincipal(request.schedule.principal),
					context: contextInput,
					signal: request.signal,
				}, ({ execution }) => {
					const observation = executionObservationOf(execution.actionScope);
					return createJobAcceptance({
						application: ${JSON.stringify(input.application)},
						tenantId: execution.tenant.id,
						principal: execution.principal,
						contextInput,
						contextInputCodec: ${input.contextDefinition}.input,
						runtimeBuildDigest: loaded.artifacts.runtimeBuild.digest,
						acceptedAt: request.observedAt,
						signal: execution.signal,
						...(observation ? { observation: observation.execution } : {}),
						causation: Object.freeze({ kind: "explicit", id: causationId, correlationId: causationId }),
						transaction: createPostgresJobAcceptanceTransaction({
							transaction: request.transaction,
							statements: mutationArtifacts.transactionStatements,
							application: ${JSON.stringify(input.application)},
							sourceOperation: "schedule:jobs.accept",
							callId: causationId,
							...(observation ? { observation: Object.freeze({ execution: observation.execution, principalKind: execution.principal.kind, signal: execution.signal }) } : {}),
						}),
					}).accept(job, jobInput, { idempotencyKey: request.tickId });
				});
			},
		});`;
}
