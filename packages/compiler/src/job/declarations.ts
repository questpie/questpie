import { renderCodecType } from "../runtime/client";
import type { NormalizedResource } from "../types";

function jobs(resources: readonly NormalizedResource[]) {
	return resources.filter((resource) => resource.kind === "job");
}

export function renderJobDispatch(
	resources: readonly NormalizedResource[],
): string {
	return jobs(resources)
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: Readonly<{ accept(input: ${renderCodecType(resource.contract.input)}, options: JobAcceptanceOptions): Promise<JobRunReceipt<${JSON.stringify(resource.name)}>>; }>;`,
		)
		.join("\n\t\t");
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
	const acceptances = renderJobDispatch(resources);
	return `export interface GeneratedJobs {
\t${definitions}
}

export interface GeneratedJobAcceptances {
\t${acceptances}
}

export interface JobAcceptanceOptions {
\treadonly idempotencyKey: string;
\treadonly notBefore?: Date;
}

export type JobRunReceipt<Name extends keyof GeneratedJobs> = Readonly<{ readonly runId: string; readonly resource: \`job:\${Name & string}\` }>;

export type JobContext = Omit<RootExecution, "services"> & Readonly<{
\trun: Readonly<{ id: string }>;
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
\treadonly schedule: null;
\treadonly handler: (input: Readonly<{ input: GeneratedJobs[Name]["input"]; ctx: JobContext; errors: OperationErrorFactories<Errors> }>) => GeneratedJobs[Name]["output"] | Promise<GeneratedJobs[Name]["output"]>;
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
\tschedule?: null;
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
