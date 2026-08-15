import type { Codec, CodecValue } from "./index";

type MaybePromise<Value> = Value | Promise<Value>;

export type Principal = Readonly<{
	readonly questpiePrincipal: true;
	readonly kind: "anonymous" | "service" | "user";
	readonly id: string;
}>;

function createPrincipal(kind: Principal["kind"], id: string): Principal {
	return Object.freeze({ questpiePrincipal: true, kind, id });
}

export const principal = Object.freeze({
	anonymous: (): Principal => createPrincipal("anonymous", "anonymous"),
	service: (input: Readonly<{ name: string }>): Principal =>
		createPrincipal("service", input.name),
	user: (input: Readonly<{ id: string }>): Principal =>
		createPrincipal("user", input.id),
});

export interface ContextBootstrap {
	get(
		collection: unknown,
		input: Readonly<{ key: unknown; select: unknown }>,
	): Promise<unknown | null>;
}

export interface ContextDefinition<
	Name extends string = string,
	Input = unknown,
	Resolved extends Readonly<{
		tenant: Readonly<{ id: string }>;
		values: Readonly<Record<string, unknown>>;
	}> = Readonly<{
		tenant: Readonly<{ id: string }>;
		values: Readonly<Record<string, unknown>>;
	}>,
> {
	readonly __questpie: Readonly<{
		category: "definition";
		resourceKind: "context";
	}>;
	readonly name: Name;
	readonly input: Codec<Input>;
	readonly executableSlots: readonly ["resolve"];
	readonly resolve: (
		input: Readonly<{
			input: Input;
			principal: Principal;
			bootstrap: ContextBootstrap;
			signal: AbortSignal;
		}>,
	) => MaybePromise<Resolved>;
}

export type ContextInputOf<Definition> =
	Definition extends ContextDefinition<string, infer Input> ? Input : never;

export type ContextResolvedOf<Definition> =
	Definition extends ContextDefinition<string, unknown, infer Resolved>
		? Resolved
		: never;

export function defineContext<
	const Name extends string,
	const InputCodec extends Codec<unknown>,
	const Resolved extends Readonly<{
		tenant: Readonly<{ id: string }>;
		values: Readonly<Record<string, unknown>>;
	}>,
>(
	input: Readonly<{
		name: Name;
		input: InputCodec;
		resolve: (
			input: Readonly<{
				input: CodecValue<InputCodec>;
				principal: Principal;
				bootstrap: ContextBootstrap;
				signal: AbortSignal;
			}>,
		) => MaybePromise<Resolved>;
	}>,
): ContextDefinition<Name, CodecValue<InputCodec>, Resolved> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "context",
		}),
		name: input.name,
		input: input.input,
		executableSlots: Object.freeze(["resolve"] as const),
		resolve: input.resolve,
	}) as ContextDefinition<Name, CodecValue<InputCodec>, Resolved>;
}
