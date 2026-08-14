import type { Codec, CodecValue } from "./core";

type OperationCall<Input, Output, Options = never> = [Options] extends [never]
	? (input: Input) => Promise<Output>
	: (input: Input, options: Options) => Promise<Output>;

export interface GeneratedActions {
	readonly a: Readonly<{
		readonly toString: Readonly<{
			b: OperationCall<Readonly<{ id: string }>, Readonly<{ ok: true }>>;
		}>;
	}>;
	readonly delivery: Readonly<{
		sendMessage: OperationCall<
			Readonly<{ message: Readonly<{ id: string; body: string }> }>,
			Readonly<{ providerMessageId: string }>,
			Readonly<{ idempotencyKey: string }>
		>;
	}>;
	readonly constructor: Readonly<{
		inspect: OperationCall<Readonly<{ id: string }>, Readonly<{ ok: true }>>;
	}>;
	readonly prototype: Readonly<{
		measure: OperationCall<Readonly<{ id: string }>, Readonly<{ ms: number }>>;
	}>;
	readonly then: Readonly<{
		fire: OperationCall<Readonly<{ id: string }>, Readonly<{ ok: true }>>;
	}>;
}

export interface GeneratedMutations {
	readonly messages: Readonly<{
		recordDelivery: OperationCall<
			Readonly<{ messageId: string; providerMessageId: string }>,
			Readonly<{ recorded: true }>
		>;
	}>;
}

interface ExecutionContext {
	readonly signal: AbortSignal;
}

interface ReadContext extends ExecutionContext {
	readonly data: Readonly<{ snapshot: "policy-aware" }>;
}

interface MutationContext extends ReadContext {}

interface ActionContext extends ExecutionContext {
	readonly actions: Readonly<GeneratedActions>;
	readonly mutations: Readonly<GeneratedMutations>;
	readonly services: Readonly<{ boundary: "declared-external-effect" }>;
}

interface ReactionContext extends ReadContext {
	readonly actions: Readonly<GeneratedActions>;
	readonly mutations: Readonly<GeneratedMutations>;
}

interface JobContext extends ReactionContext {}

interface WorkflowContext extends ReactionContext {}

interface RouteContext extends ExecutionContext {
	readonly byteStore: Readonly<{ boundary: "route-only-file-bytes" }>;
}

interface ReactionRun {
	effect(name: "deliver-message"): string;
}

interface Attempt {
	readonly number: number;
}

interface WorkflowStep {
	mutation(
		name: string,
		target: GeneratedMutations["messages"]["recordDelivery"],
		input: Readonly<object>,
	): Promise<Readonly<{ ok: true }>>;
	action(
		name: string,
		target:
			| GeneratedActions["delivery"]["sendMessage"]
			| GeneratedActions["constructor"]["inspect"]
			| GeneratedActions["prototype"]["measure"]
			| GeneratedActions["then"]["fire"]
			| GeneratedActions["a"]["toString"]["b"],
		input: Readonly<object>,
	): Promise<Readonly<{ ok: true }>>;
}

type Definition<Kind extends string, Name extends string> = Readonly<{
	kind: Kind;
	name: Name;
}>;

type HandlerInput<
	InputCodec extends Codec<unknown>,
	Context,
	Extras extends object,
> = Readonly<
	{
		input: CodecValue<InputCodec>;
		ctx: Context;
	} & Extras
>;

type Factory<Kind extends string, Context, Extras extends object = object> = <
	const Name extends string,
	InputCodec extends Codec<unknown>,
	Output,
>(input: {
	readonly name: Name;
	readonly input: InputCodec;
	handler(
		input: HandlerInput<InputCodec, Context, Extras>,
	): Output | Promise<Output>;
}) => Definition<Kind, Name>;

export declare const defineQuery: Factory<"query", ReadContext>;
export declare const defineMutation: Factory<"mutation", MutationContext>;
export declare const defineAction: Factory<"action", ActionContext>;
export declare const defineReaction: Factory<
	"reaction",
	ReactionContext,
	Readonly<{ run: ReactionRun; attempt: Attempt }>
>;
export declare const defineJob: Factory<
	"job",
	JobContext,
	Readonly<{ attempt: Attempt }>
>;
export declare const defineWorkflow: Factory<
	"workflow",
	WorkflowContext,
	Readonly<{ step: WorkflowStep }>
>;
export declare const defineRoute: Factory<
	"route",
	RouteContext,
	Readonly<{ request: Request }>
>;

export declare const define: Readonly<{
	query: typeof defineQuery;
	mutation: typeof defineMutation;
	action: typeof defineAction;
	reaction: typeof defineReaction;
	job: typeof defineJob;
	workflow: typeof defineWorkflow;
	route: typeof defineRoute;
}>;
