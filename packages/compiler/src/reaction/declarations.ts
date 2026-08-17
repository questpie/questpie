import { renderCodecType } from "../runtime/client";
import type { NormalizedResource } from "../types";

function reactions(resources: readonly NormalizedResource[]) {
	return resources.filter((resource) => resource.kind === "reaction");
}

export function renderReactionDispatch(
	resources: readonly NormalizedResource[],
): string {
	return reactions(resources)
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}(input: ${renderCodecType(resource.contract.input)}): Promise<void>;`,
		)
		.join("\n\t\t");
}

/**
 * BETA-08 executes the Reaction, so the generated Definition carries the
 * authored handler, its run-as recipe, its retry program, and the literal
 * effect names its handler may reach for.
 */
export function renderReactionDeclarations(
	resources: readonly NormalizedResource[],
	structuralQueryRuns: string,
): string {
	const members = reactions(resources);
	const definitions = members
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: Readonly<{ input: ${renderCodecType(resource.contract.input)}; output: ${renderCodecType(resource.contract.output)}; }>;`,
		)
		.join("\n\t");
	const effects = members
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}: ${
					(resource.contract.effects as readonly string[]).length === 0
						? "never"
						: (resource.contract.effects as readonly string[])
								.map((name) => JSON.stringify(name))
								.join(" | ")
				};`,
		)
		.join("\n\t");
	return `export interface GeneratedReactionData {
	${structuralQueryRuns}
}

export interface GeneratedReactions {
	${definitions}
}

export interface GeneratedReactionEffects {
	${effects}
}

export type ReactionEffectScope = Readonly<{
	effectId: string;
	attempt: number;
	signal: AbortSignal;
}>;

export interface ReactionEffectHandle {
	invoke<Receipt extends string>(invocation: Readonly<{
		input: unknown;
		perform: (scope: ReactionEffectScope) => Promise<Receipt>;
		recover?: (scope: ReactionEffectScope) => Promise<Receipt | null>;
	}>): Promise<Receipt>;
}

export type ReactionRun<Name extends keyof GeneratedReactions> = Readonly<{
	readonly id: string;
	readonly dispatchId: string;
	effect(name: GeneratedReactionEffects[Name & keyof GeneratedReactionEffects]): ReactionEffectHandle;
}>;

export type ReactionAttempt = Readonly<{
	number: number;
	heartbeat(): Promise<void>;
}>;

/**
 * ADR-0013 gives the Reaction Context read-only Policy-aware data, generated
 * nested Mutations, and generated Queries. It has no raw Collection write, so
 * \`data\` exposes exactly the structural Query runner the attempt is given.
 */
export type ReactionContext<Name extends keyof GeneratedReactions> = Omit<RootExecution, "services"> & Readonly<{
	data: Readonly<GeneratedReactionData>;
	queries: GeneratedQueryOperations;
	mutations: GeneratedMutationOperations;
	run: ReactionRun<Name>;
	attempt: ReactionAttempt;
}>;

export type ReactionDefinition<Name extends keyof GeneratedReactions, Errors extends OperationErrorMap> = Readonly<{
	readonly kind: "reaction";
	readonly identity: \`reaction:\${Name & string}\`;
	readonly name: Name;
	readonly input: Codec<GeneratedReactions[Name]["input"]>;
	readonly output: Codec<GeneratedReactions[Name]["output"]>;
	readonly runAs: DurableRunAsDefinition;
	readonly retry: DurableRetryDefinition;
	readonly effects: readonly GeneratedReactionEffects[Name & keyof GeneratedReactionEffects][];
	readonly errors: Errors;
	readonly handler: (input: Readonly<{
		input: GeneratedReactions[Name]["input"];
		ctx: ReactionContext<Name>;
		errors: OperationErrorFactories<Errors>;
	}>) => GeneratedReactions[Name]["output"] | Promise<GeneratedReactions[Name]["output"]>;
}>;

export type ReactionFactory = <const Name extends keyof GeneratedReactions, const Errors extends OperationErrorMap>(
	definition: Readonly<{
		name: Name;
		input: Codec<GeneratedReactions[Name]["input"]>;
		output: Codec<GeneratedReactions[Name]["output"]>;
		runAs: DurableRunAsDefinition;
		retry: DurableRetryDefinition;
		effects?: readonly GeneratedReactionEffects[Name & keyof GeneratedReactionEffects][];
		errors?: Errors;
		handler(input: Readonly<{
			input: GeneratedReactions[Name]["input"];
			ctx: ReactionContext<Name>;
			errors: OperationErrorFactories<Errors>;
		}>): GeneratedReactions[Name]["output"] | Promise<GeneratedReactions[Name]["output"]>;
	}>,
) => ReactionDefinition<Name, Errors>;

export const defineReaction: ReactionFactory = ((definition) => Object.freeze({
	...definition,
	kind: "reaction" as const,
	identity: \`reaction:\${definition.name}\` as const,
})) as ReactionFactory;`;
}

export function renderDurableDeclarations(): string {
	return `export type DurableRunState = "cancelled" | "delayed" | "failed" | "ready" | "running" | "succeeded";

export type DurableActor = Readonly<{ kind: "anonymous" | "service" | "user"; id: string }>;

export type DurableWorkerOutcome = Readonly<{
	runId: string;
	resource: string;
	attemptNumber: number;
	outcome: "cancelled" | "failed" | "fenced" | "refusedIncompatible" | "retryScheduled" | "skipped" | "succeeded";
	failureCode: string | null;
}>;

export type DurableWorkerTrace = Readonly<{
	workerId: string;
	admitted: number;
	cancelled: number;
	claimed: number;
	refusedIncompatible: number;
	outcomes: readonly DurableWorkerOutcome[];
}>;

export type DurableRunView = Readonly<{
	runId: string;
	dispatchId: string;
	resource: string;
	state: DurableRunState;
	attemptCount: number;
	currentAttemptId: string | null;
	cancellationRequested: boolean;
	deadLetter: boolean;
	failureCode: string | null;
	resultBytes: Uint8Array | null;
	availableAt: Date;
	terminalAt: Date | null;
}>;

export type DurableRunEventView = Readonly<{
	sequence: number;
	kind: string;
	attemptId: string | null;
	leaseTokenDigest: string | null;
	errorCode: string | null;
}>;

export type DurableEffectView = Readonly<{
	effectName: string;
	effectId: string;
	status: "acknowledged" | "ambiguous" | "pending" | "succeeded";
	receipt: string | null;
}>;

export type DurableMaintenanceOutcome = Readonly<{
	commandId: string;
	command: "acknowledgeAmbiguity" | "cancelRun" | "retryRun";
	outcome: "applied" | "rejected";
	rejectionCode: string | null;
	stateBefore: DurableRunState;
	stateAfter: DurableRunState;
}>;

export type DurableMaintenanceAuditEntry = Readonly<{
	commandId: string;
	command: "acknowledgeAmbiguity" | "cancelRun" | "retryRun";
	outcome: "applied" | "rejected";
	rejectionCode: string | null;
	actor: DurableActor;
	stateBefore: string;
	stateAfter: string;
}>;

export type DurableWorkerOptions = Readonly<{
	workerId?: string;
	claimBatch?: number;
	leaseMilliseconds?: number;
	heartbeatMilliseconds?: number;
	attemptDeadlineMilliseconds?: number;
	resultBytesLimit?: number;
}>;

export interface DurableWorkerHandle {
	readonly workerId: string;
	poll(): Promise<DurableWorkerTrace>;
	beginDrain(): void;
	readonly draining: boolean;
}

/** The server-side durable surface. No generic control plane reaches a browser client. */
export interface GeneratedDurable {
	worker(options?: DurableWorkerOptions): DurableWorkerHandle;
	poll(options?: DurableWorkerOptions): Promise<DurableWorkerTrace>;
	inspect(runId: string): Promise<DurableRunView | null>;
	events(runId: string): Promise<readonly DurableRunEventView[]>;
	effects(runId: string): Promise<readonly DurableEffectView[]>;
	audit(runId: string): Promise<readonly DurableMaintenanceAuditEntry[]>;
	cancelRun(input: Readonly<{ runId: string; reason: string; actor: DurableActor }>): Promise<DurableMaintenanceOutcome>;
	retryRun(input: Readonly<{ runId: string; actor: DurableActor }>): Promise<DurableMaintenanceOutcome>;
	acknowledgeAmbiguity(input: Readonly<{ runId: string; effectName: string; actor: DurableActor }>): Promise<DurableMaintenanceOutcome>;
}`;
}
