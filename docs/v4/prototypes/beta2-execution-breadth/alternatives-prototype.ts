// PROTOTYPE — three coherent Job/Workflow authoring shapes compared side by side.

type Awaitable<Value> = Value | Promise<Value>;
type Codec<Value> = Readonly<{ parse(input: unknown): Value }>;
type ValueOf<ValueCodec extends Codec<unknown>> =
	ValueCodec extends Codec<infer Value> ? Value : never;
type Signals = Readonly<Record<string, Codec<unknown>>>;

type Step<SignalMap extends Signals> = Readonly<{
	mutation(name: string): Promise<void>;
	action(name: string): Promise<void>;
	waitForSignal<const Name extends keyof SignalMap & string>(
		stepName: string,
		options: Readonly<{ signal: Name }>,
	): Promise<ValueOf<SignalMap[Name]>>;
}>;

type CommonDefinition<Name extends string, Input, Output> = Readonly<{
	name: Name;
	version: number;
	input: Codec<Input>;
	output?: Codec<Output>;
}>;

// A — one Resource, factory, Definition shape, and handler shape.
declare function defineUnifiedJob<
	const Name extends string,
	Input,
	Output,
	const SignalMap extends Signals = Readonly<Record<never, never>>,
>(
	definition: CommonDefinition<Name, Input, Output> &
		Readonly<{
			signals?: SignalMap;
			handler(input: Readonly<{ step: Step<SignalMap> }>): Awaitable<Output>;
		}>,
): Readonly<{ kind: "job"; name: Name }>;

// B — the incumbent uses two Resources, factories, and handler shapes even
// though both lower to the same run/attempt/lease worker.
declare function defineSeparateJob<Name extends string, Input, Output>(
	definition: CommonDefinition<Name, Input, Output> &
		Readonly<{
			handler(input: Readonly<{ attempt: unknown }>): Awaitable<Output>;
		}>,
): Readonly<{ kind: "job"; name: Name }>;

declare function defineSeparateWorkflow<
	Name extends string,
	Input,
	Output,
	SignalMap extends Signals,
>(
	definition: CommonDefinition<Name, Input, Output> &
		Readonly<{
			signals: SignalMap;
			handler(input: Readonly<{ step: Step<SignalMap> }>): Awaitable<Output>;
		}>,
): Readonly<{ kind: "workflow"; name: Name }>;

// C — one Resource/factory, but an explicit mode creates two Definition and
// handler shapes. The union correctly rejects mixed combinations; that safety
// is real, but every promotion from ordinary to checkpointed work changes mode
// and handler shape.
type OrdinaryMode<Name extends string, Input, Output> = CommonDefinition<
	Name,
	Input,
	Output
> &
	Readonly<{
		mode: "ordinary";
		signals?: never;
		handler(input: Readonly<{ attempt: unknown }>): Awaitable<Output>;
	}>;

type CheckpointedMode<
	Name extends string,
	Input,
	Output,
	SignalMap extends Signals,
> = CommonDefinition<Name, Input, Output> &
	Readonly<{
		mode: "checkpointed";
		signals: SignalMap;
		handler(input: Readonly<{ step: Step<SignalMap> }>): Awaitable<Output>;
	}>;

declare function defineModeJob<
	Name extends string,
	Input,
	Output,
	SignalMap extends Signals,
>(
	definition:
		| OrdinaryMode<Name, Input, Output>
		| CheckpointedMode<Name, Input, Output, SignalMap>,
): Readonly<{ kind: "job"; name: Name }>;

declare const input: Codec<Readonly<{ articleId: string }>>;
declare const approval: Codec<Readonly<{ approvedBy: string }>>;

defineUnifiedJob({
	name: "unified",
	version: 1,
	input,
	signals: { approval },
	async handler({ step }) {
		await step.mutation("request-review");
		return step.waitForSignal("approval-gate", { signal: "approval" });
	},
});

defineSeparateJob({
	name: "ordinary",
	version: 1,
	input,
	async handler() {
		return { accepted: true };
	},
});

defineSeparateWorkflow({
	name: "workflow",
	version: 1,
	input,
	signals: { approval },
	async handler({ step }) {
		return step.waitForSignal("approval-gate", { signal: "approval" });
	},
});

defineModeJob({
	name: "mode-ordinary",
	version: 1,
	mode: "ordinary",
	input,
	async handler() {
		return { accepted: true };
	},
});

defineModeJob({
	name: "mode-checkpointed",
	version: 1,
	mode: "checkpointed",
	input,
	signals: { approval },
	async handler({ step }) {
		return step.waitForSignal("approval-gate", { signal: "approval" });
	},
});

// @ts-expect-error An ordinary mode rejects signals; promotion changes the Definition shape.
defineModeJob({
	name: "invalid-mode",
	version: 1,
	mode: "ordinary",
	input,
	signals: { approval },
	async handler() {
		return { accepted: false };
	},
});

export const comparison = {
	unified: {
		resourceKinds: 1,
		factories: 1,
		definitionShapes: 1,
		handlerShapes: 1,
		promotionEdits: "start using the closed step helper",
	},
	separateWorkflow: {
		resourceKinds: 2,
		factories: 2,
		definitionShapes: 2,
		handlerShapes: 2,
		promotionEdits:
			"replace Resource, factory, generated projection, and handler",
	},
	modeBuilder: {
		resourceKinds: 1,
		factories: 1,
		definitionShapes: 2,
		handlerShapes: 2,
		promotionEdits: "change discriminant and handler shape",
	},
} as const;
