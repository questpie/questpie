export interface Codec<Value> {
	readonly __value?: Value;
}

export type CodecValue<ValueCodec> =
	ValueCodec extends Codec<infer Value> ? Value : never;

export type Operation<Input, Output> = (input: Input) => Promise<Output>;

export interface Definition<
	Kind extends string,
	Name extends string,
	Input,
	Output,
> {
	readonly kind: Kind;
	readonly name: Name;
	readonly __input?: Input;
	readonly __output?: Output;
}

export interface ReadCollection<Row, Key> {
	get(args: { key: Key }): Promise<Row | null>;
}

export interface WriteCollection<Row, Key> extends ReadCollection<Row, Key> {
	create(args: { input: Row }): Promise<Row>;
	update(args: { key: Key; patch: Partial<Row> }): Promise<Row | null>;
}

export interface ExecutionFacts {
	readonly principal: { readonly id: string };
	readonly tenant: { readonly id: string };
	readonly signal: AbortSignal;
	readonly deadline: Date;
}

export interface ApplicationContract {
	readonly readData: object;
	readonly writeData: object;
	readonly queries: object;
	readonly mutations: object;
	readonly actions: object;
	readonly dispatch: object;
	readonly jobs: object;
}

type QueryContext<App extends ApplicationContract> = ExecutionFacts & {
	readonly data: App["readData"];
	readonly queries: App["queries"];
};

export type QueryHandler<
	App extends ApplicationContract,
	InputCodec extends Codec<unknown>,
> = (args: {
	readonly input: CodecValue<InputCodec>;
	readonly ctx: QueryContext<App>;
}) => unknown;

type MutationContext<App extends ApplicationContract> = ExecutionFacts & {
	readonly data: App["writeData"];
	readonly queries: App["queries"];
	readonly dispatch: App["dispatch"];
	readonly operationTime: Date;
};

type DurableContext<App extends ApplicationContract> = ExecutionFacts & {
	readonly data: App["readData"];
	readonly queries: App["queries"];
	readonly mutations: App["mutations"];
	readonly actions: App["actions"];
};

type ActionContext<App extends ApplicationContract> = ExecutionFacts & {
	readonly queries: App["queries"];
	readonly mutations: App["mutations"];
};

type RootExecution<App extends ApplicationContract> = {
	readonly queries: App["queries"];
	readonly mutations: App["mutations"];
	readonly actions: App["actions"];
	readonly jobs: App["jobs"];
};

type RouteContext<App extends ApplicationContract> = Pick<
	ExecutionFacts,
	"principal" | "signal" | "deadline"
> & {
	execution<Result>(
		options: {
			principal: { readonly id: string };
			context: { readonly companyId: string };
		},
		callback: (execution: RootExecution<App>) => Promise<Result>,
	): Promise<Result>;
};

type DefinitionOptions<
	App extends ApplicationContract,
	InputCodec extends Codec<unknown>,
	Context,
	Output,
> = {
	readonly name: string;
	readonly input: InputCodec;
	readonly handler: (args: {
		readonly input: CodecValue<InputCodec>;
		readonly ctx: Context;
	}) => Output;
};

export interface QueryFactory<App extends ApplicationContract> {
	<
		const Name extends string,
		InputCodec extends Codec<unknown>,
		Output,
	>(
		definition: Omit<
			DefinitionOptions<App, InputCodec, QueryContext<App>, Output>,
			"name"
		> & { readonly name: Name },
	): Definition<"query", Name, CodecValue<InputCodec>, Awaited<Output>>;
}

export interface MutationFactory<App extends ApplicationContract> {
	<
		const Name extends string,
		InputCodec extends Codec<unknown>,
		Output,
	>(
		definition: Omit<
			DefinitionOptions<App, InputCodec, MutationContext<App>, Output>,
			"name"
		> & { readonly name: Name },
	): Definition<"mutation", Name, CodecValue<InputCodec>, Awaited<Output>>;
}

interface DurableArguments<Context, Input> {
	readonly input: Input;
	readonly ctx: Context;
	readonly run: { effect(name: string): string };
	readonly attempt: { readonly number: number };
}

interface DurableFactory<App extends ApplicationContract, Kind extends string> {
	<
		const Name extends string,
		InputCodec extends Codec<unknown>,
		Output,
	>(definition: {
		readonly name: Name;
		readonly input: InputCodec;
		readonly handler: (
			args: DurableArguments<DurableContext<App>, CodecValue<InputCodec>>,
		) => Output;
	}): Definition<Kind, Name, CodecValue<InputCodec>, Awaited<Output>>;
}

export type ReactionFactory<App extends ApplicationContract> = DurableFactory<
	App,
	"reaction"
>;

export type JobFactory<App extends ApplicationContract> = DurableFactory<
	App,
	"job"
>;

export interface ActionFactory<App extends ApplicationContract> {
	<
		const Name extends string,
		InputCodec extends Codec<unknown>,
		Output,
	>(
		definition: Omit<
			DefinitionOptions<App, InputCodec, ActionContext<App>, Output>,
			"name"
		> & { readonly name: Name },
	): Definition<"action", Name, CodecValue<InputCodec>, Awaited<Output>>;
}

export interface RouteFactory<App extends ApplicationContract> {
	<const Name extends string>(definition: {
		readonly name: Name;
		readonly method: "GET" | "POST";
		readonly path: string;
		readonly handler: (args: {
			readonly request: Request;
			readonly ctx: RouteContext<App>;
		}) => Response | Promise<Response>;
	}): Definition<"route", Name, Request, Response>;
}

const define = ((value: { name: string }) => value) as never;

export const internalDefinitionFactories = {
	defineQuery: define,
	defineMutation: define,
	defineReaction: define,
	defineJob: define,
	defineAction: define,
	defineRoute: define,
};

export const operation = {
	object<const Value extends object>(): Codec<Value> {
		return {};
	},
};
