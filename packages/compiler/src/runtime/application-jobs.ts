import { compareAscii } from "../canonical";
import { renderServerOperationValue } from "../server-operation-map";
import type { NormalizedResource } from "../types";

export function renderDirectJobOperations(
	resources: readonly NormalizedResource[],
): string {
	return renderServerOperationValue(
		"Job",
		resources
			.filter((resource) => resource.kind === "job")
			.sort((left, right) => compareAscii(left.name, right.name))
			.map((resource) => ({
				name: resource.name,
				origin: resource.origin,
				value: `Object.freeze({ accept: (jobInput, options) => acceptJob(${JSON.stringify(resource.identity)}, jobInput, options) })`,
			})),
	);
}

/** Renders the one explicit PostgreSQL acceptance owner shared by server Executions. */
export function renderDirectJobAcceptance(
	input: Readonly<{
		application: string;
		contextDefinition: string;
		directJobOperations: string;
	}>,
): string {
	return `createDirectJobs = (scope, execution, contextInput) => {
			const observation = executionObservationOf(scope);
			const acceptJob = async (identity, jobInput, options) => {
				if (!mutationArtifacts)
					throw new TypeError("Job acceptance artifacts are not linked");
				const job = mutationArtifacts.jobs.byIdentity.get(identity);
				if (!job) throw new TypeError("Job acceptance target is unavailable");
				const causationId = "explicit:" + crypto.randomUUID();
				const acceptedAt = new Date();
				return database.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					control: { signal: execution.signal },
					use: (transaction) => createJobAcceptance({
						application: ${JSON.stringify(input.application)},
						tenantId: execution.tenant.id,
						principal: execution.principal,
						contextInput,
						contextInputCodec: ${input.contextDefinition}.input,
						runtimeBuildDigest: loaded.artifacts.runtimeBuild.digest,
						acceptedAt,
						...(observation ? { observation: observation.execution } : {}),
						signal: execution.signal,
						causation: Object.freeze({ kind: "explicit", id: causationId, correlationId: causationId }),
						transaction: createPostgresJobAcceptanceTransaction({
							transaction,
							statements: mutationArtifacts.transactionStatements,
							application: ${JSON.stringify(input.application)},
							sourceOperation: "execution:jobs.accept",
							callId: causationId,
							...(observation ? { observation: Object.freeze({ execution: observation.execution, principalKind: execution.principal.kind, signal: execution.signal }) } : {}),
						}),
					}).accept(job, jobInput, options),
				});
			};
			return ${input.directJobOperations};
		};`;
}
