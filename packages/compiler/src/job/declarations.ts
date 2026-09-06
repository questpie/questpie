import { renderCodecType } from "../runtime/client";
import { renderServerOperationType } from "../server-operation-map";
import type { NormalizedResource } from "../types";

function jobs(resources: readonly NormalizedResource[]) {
	return resources.filter((resource) => resource.kind === "job");
}

export function renderJobAcceptances(
	resources: readonly NormalizedResource[],
): string {
	return renderServerOperationType(
		"Job",
		jobs(resources).map((resource) => ({
			name: resource.name,
			origin: resource.origin,
			value: `Readonly<{ accept(input: ${renderCodecType(resource.contract.input)}, options: JobAcceptanceOptions): Promise<JobRunReceipt<${JSON.stringify(resource.name)}>>; }>`,
		})),
	);
}

export function renderJobDeclarations(
	resources: readonly NormalizedResource[],
): string {
	const definitions = jobs(resources)
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: Readonly<{ input: ${renderCodecType(resource.contract.input)}; output: ${renderCodecType(resource.contract.output)}; }>;`,
		)
		.join("\n\t");
	const acceptances = renderJobAcceptances(resources);
	const references = renderServerOperationType(
		"Mutation",
		resources
			.filter((resource) => resource.kind === "mutation")
			.map((resource) => ({
				name: resource.name,
				origin: resource.origin,
				value: `MutationCheckpointReference<${JSON.stringify(resource.name)}>`,
			})),
	);
	return `export interface GeneratedJobs {
\t${definitions}
}

export type GeneratedJobAcceptances = ${acceptances};

export interface JobAcceptanceOptions {
\treadonly idempotencyKey: string;
\treadonly notBefore?: Date;
}

export type JobRunReceipt<Name extends keyof GeneratedJobs> = Readonly<{ readonly runId: string; readonly resource: \`job:\${Name & string}\` }>;

declare const mutationCheckpointReference: unique symbol;

export type MutationCheckpointReference<Name extends keyof GeneratedMutations> = Readonly<{
\treadonly identity: \`mutation:\${Name & string}\`;
\treadonly [mutationCheckpointReference]: Name;
}>;

export type MutationCheckpointError<Reference extends MutationCheckpointReference<keyof GeneratedMutations>> = GeneratedMutations[Reference[typeof mutationCheckpointReference]]["declaredError"];

export type GeneratedJobMutationReferences = ${references};

export type JobContext = Omit<RootExecution, "services"> & Readonly<{
\tmutations: GeneratedJobMutationReferences;
\trun: Readonly<{ id: string; step: Readonly<{
\t\tmutation<const Name extends keyof GeneratedMutations>(name: string, reference: MutationCheckpointReference<Name>, input: GeneratedMutations[NoInfer<Name>]["input"]): Promise<GeneratedMutations[Name]["output"]>;
\t}> }>;
\tattempt: Readonly<{ number: number; heartbeat(): Promise<void> }>;
}>;

export type JobDefinition<Name extends keyof GeneratedJobs, Errors extends OperationErrorMap> = Readonly<{
\treadonly kind: "job";
\treadonly identity: \`job:\${Name & string}\`;
\treadonly name: Name;
\treadonly version: number;
\treadonly input: Codec<GeneratedJobs[Name]["input"]>;
\treadonly output: Codec<GeneratedJobs[Name]["output"]>;
\treadonly runAs: DurableRunAsDefinition;
\treadonly retry: DurableRetryDefinition;
\treadonly errors: Errors;
\treadonly signals: Readonly<Record<never, never>>;
\treadonly schedule: JobSchedule<Name> | null;
\treadonly handler: (input: Readonly<{ input: GeneratedJobs[Name]["input"]; ctx: JobContext; errors: OperationErrorFactories<Errors> }>) => GeneratedJobs[Name]["output"] | Promise<GeneratedJobs[Name]["output"]>;
}>;

export type JobSchedule<Name extends keyof GeneratedJobs> = Readonly<{
\tcron: string;
\texecution: Readonly<{ principal: Principal; context: AppContextInput }>;
\tinput: GeneratedJobs[Name]["input"];
}>;

export type JobFactory = <const Name extends keyof GeneratedJobs, const Errors extends OperationErrorMap>(definition: Readonly<{
\tname: Name;
\tversion?: number;
\tinput: Codec<GeneratedJobs[Name]["input"]>;
\toutput: Codec<GeneratedJobs[Name]["output"]>;
\trunAs: DurableRunAsDefinition;
\tretry: DurableRetryDefinition;
\terrors?: Errors;
\tsignals?: Readonly<Record<never, never>>;
\tschedule?: JobSchedule<Name> | null;
\thandler(input: Readonly<{ input: GeneratedJobs[Name]["input"]; ctx: JobContext; errors: OperationErrorFactories<Errors> }>): GeneratedJobs[Name]["output"] | Promise<GeneratedJobs[Name]["output"]>;
}> ) => JobDefinition<Name, Errors>;

export const defineJob: JobFactory = ((definition) => Object.freeze({
\t...definition,
\tversion: definition.version ?? 1,
\terrors: definition.errors ?? Object.freeze({}),
\tsignals: definition.signals ?? Object.freeze({}),
\tschedule: definition.schedule ?? null,
\tkind: "job" as const,
\tidentity: \`job:\${definition.name}\` as const,
})) as JobFactory;`;
}
