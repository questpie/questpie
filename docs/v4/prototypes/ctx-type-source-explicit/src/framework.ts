export interface Codec<out TValue> {
	readonly __value?: TValue;
}

export type CodecMap = Readonly<Record<string, Codec<unknown>>>;

type InferCodec<TCodec> = TCodec extends Codec<infer TValue> ? TValue : never;

export type InferInput<TInput extends CodecMap> = {
	-readonly [TKey in keyof TInput]: InferCodec<TInput[TKey]>;
};

export const operation = {
	uuid: (): Codec<string> => ({}),
	text: (): Codec<string> => ({}),
};

export interface DefinitionContexts {
	readonly query: object;
	readonly mutation: object;
	readonly reaction: object;
	readonly job: object;
	readonly action: object;
	readonly route: object;
}

export interface AppForDefinitions {
	readonly definitions: DefinitionContexts;
}

export interface Definition<
	out TKind extends string,
	out TName extends string,
	out TInput,
	out TOutput,
> {
	readonly kind: TKind;
	readonly name: TName;
	readonly __input?: TInput;
	readonly __output?: TOutput;
}

type MaybePromise<TValue> = TValue | Promise<TValue>;

type OperationArgs<TContext, TInput extends CodecMap> = {
	readonly input: InferInput<TInput>;
	readonly ctx: TContext;
};

type DurableArgs<TContext, TInput extends CodecMap> = OperationArgs<
	TContext,
	TInput
> & {
	readonly run: {
		effect(name: string): string;
	};
	readonly attempt: {
		readonly number: number;
	};
};

type RouteArgs<TContext> = {
	readonly request: Request;
	readonly ctx: TContext;
};

export type InputOf<TDefinition> =
	TDefinition extends Definition<string, string, infer TInput, unknown>
		? TInput
		: never;

export type OutputOf<TDefinition> =
	TDefinition extends Definition<string, string, unknown, infer TOutput>
		? TOutput
		: never;

/**
 * A pure type binder. The returned factories do not capture an application
 * value and carry no runtime composition or discovery state.
 */
export function bindDefinitions<TApp extends AppForDefinitions>() {
	return {
		query: <
			const TName extends string,
			const TInput extends CodecMap,
			TOutput,
		>(definition: {
			readonly name: TName;
			readonly input: TInput;
			readonly handler: (
				args: OperationArgs<TApp["definitions"]["query"], TInput>,
			) => MaybePromise<TOutput>;
		}): Definition<"query", TName, InferInput<TInput>, Awaited<TOutput>> =>
			definition as never,

		mutation: <
			const TName extends string,
			const TInput extends CodecMap,
			TOutput,
		>(definition: {
			readonly name: TName;
			readonly input: TInput;
			readonly handler: (
				args: OperationArgs<TApp["definitions"]["mutation"], TInput>,
			) => MaybePromise<TOutput>;
		}): Definition<"mutation", TName, InferInput<TInput>, Awaited<TOutput>> =>
			definition as never,

		reaction: <
			const TName extends string,
			const TInput extends CodecMap,
			TOutput,
		>(definition: {
			readonly name: TName;
			readonly input: TInput;
			readonly handler: (
				args: DurableArgs<TApp["definitions"]["reaction"], TInput>,
			) => MaybePromise<TOutput>;
		}): Definition<"reaction", TName, InferInput<TInput>, Awaited<TOutput>> =>
			definition as never,

		job: <
			const TName extends string,
			const TInput extends CodecMap,
			TOutput,
		>(definition: {
			readonly name: TName;
			readonly input: TInput;
			readonly handler: (
				args: DurableArgs<TApp["definitions"]["job"], TInput>,
			) => MaybePromise<TOutput>;
		}): Definition<"job", TName, InferInput<TInput>, Awaited<TOutput>> =>
			definition as never,

		action: <
			const TName extends string,
			const TInput extends CodecMap,
			TOutput,
		>(definition: {
			readonly name: TName;
			readonly input: TInput;
			readonly handler: (
				args: OperationArgs<TApp["definitions"]["action"], TInput>,
			) => MaybePromise<TOutput>;
		}): Definition<"action", TName, InferInput<TInput>, Awaited<TOutput>> =>
			definition as never,

		route: <const TName extends string>(definition: {
			readonly name: TName;
			readonly handler: (
				args: RouteArgs<TApp["definitions"]["route"]>,
			) => MaybePromise<Response>;
		}): Definition<"route", TName, Request, Response> => definition as never,
	};
}
