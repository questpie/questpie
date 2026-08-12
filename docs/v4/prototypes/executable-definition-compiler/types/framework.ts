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

export type Selection<Row> = {
	readonly [Key in keyof Row]?: true;
};

export type Selected<Row, Select extends Selection<Row>> = {
	readonly [Key in keyof Select & keyof Row]: Row[Key];
};

export interface ReadCollection<Row, Key> {
	get<const Select extends Selection<Row>>(args: {
		readonly key: Key;
		readonly select: Select;
	}): Promise<Selected<Row, Select> | null>;
	list<const Select extends Selection<Row>>(args: {
		readonly select: Select;
	}): Promise<ReadonlyArray<Selected<Row, Select>>>;
}

export interface WriteCollection<Row, Key> extends ReadCollection<Row, Key> {
	create<const Select extends Selection<Row>>(args: {
		readonly input: Partial<Row>;
		readonly select: Select;
	}): Promise<Selected<Row, Select>>;
	update<const Select extends Selection<Row>>(args: {
		readonly key: Key;
		readonly patch: Partial<Row>;
		readonly select: Select;
	}): Promise<Selected<Row, Select> | null>;
	delete(args: { readonly key: Key }): Promise<boolean>;
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

export type QueryHandler<App extends ApplicationContract, InputCodec> = (args: {
	readonly input: CodecValue<InputCodec>;
	readonly ctx: QueryContext<App>;
}) => object | null | Promise<object | null>;

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
			readonly principal: { readonly id: string };
			readonly context: { readonly companyId: string };
		},
		callback: (execution: RootExecution<App>) => Promise<Result>,
	): Promise<Result>;
};

type DefinitionOptions<InputCodec, Context, Output> = {
	readonly input: InputCodec;
	readonly handler: (args: {
		readonly input: CodecValue<InputCodec>;
		readonly ctx: Context;
	}) => Output;
};

export interface QueryFactory<App extends ApplicationContract> {
	<const Name extends string, InputCodec, Output>(
		definition: DefinitionOptions<InputCodec, QueryContext<App>, Output> & {
			readonly name: Name;
			readonly network?: boolean;
		},
	): Definition<"query", Name, CodecValue<InputCodec>, Awaited<Output>>;
}

export interface MutationFactory<App extends ApplicationContract> {
	<const Name extends string, InputCodec, Output>(
		definition: DefinitionOptions<InputCodec, MutationContext<App>, Output> & {
			readonly name: Name;
			readonly network?: boolean;
		},
	): Definition<"mutation", Name, CodecValue<InputCodec>, Awaited<Output>>;
}

interface DurableArguments<Context, Input> {
	readonly input: Input;
	readonly ctx: Context;
	readonly run: { effect(name: string): string };
	readonly attempt: { readonly number: number };
}

interface DurableFactory<App extends ApplicationContract, Kind extends string> {
	<const Name extends string, InputCodec, Output>(definition: {
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
	<const Name extends string, InputCodec, Output>(
		definition: DefinitionOptions<InputCodec, ActionContext<App>, Output> & {
			readonly name: Name;
		},
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

const define = ((value: { readonly name: string }) => value) as never;

export const __definitionFactories = Object.freeze({
	defineQuery: define,
	defineMutation: define,
	defineReaction: define,
	defineJob: define,
	defineAction: define,
	defineRoute: define,
});

export const operation = {
	uuid(): Codec<string> {
		return {};
	},
	integer(): Codec<number> {
		return {};
	},
	text(_options?: { readonly maximumLength?: number }): Codec<string> {
		return {};
	},
	object<
		const Shape extends {
			readonly [Key in keyof Shape]:
				| Codec<object>
				| Codec<string>
				| Codec<number>;
		},
	>(
		_shape: Shape,
	): Codec<{ readonly [Key in keyof Shape]: CodecValue<Shape[Key]> }> {
		return {};
	},
};

export const policy = {
	authenticated(): { readonly kind: "authenticated" } {
		return { kind: "authenticated" };
	},
	public(): { readonly kind: "public" } {
		return { kind: "public" };
	},
};
