import type { CollectionDefinition } from "./collection-contract";
import type { Codec, CodecValue, FieldDefinition } from "./field-contract";
import type { SeedPrimaryKey } from "./seed-types";
import type { FieldNode, InlineShapeDefinition } from "./shape";

type MaybePromise<Value> = Value | Promise<Value>;

type DeepReadonly<Value> = Value extends (...input: never[]) => unknown
	? Value
	: Value extends readonly (infer Item)[]
		? readonly DeepReadonly<Item>[]
		: Value extends object
			? Readonly<{ [Key in keyof Value]: DeepReadonly<Value[Key]> }>
			: Value;

const principalBrand: unique symbol = Symbol("questpie.principal");
const trustedPrincipals = new WeakSet<object>();

export type Principal = Readonly<{
	readonly [principalBrand]: true;
	readonly questpiePrincipal: true;
	readonly kind: "anonymous" | "service" | "user";
	readonly id: string;
}>;

export type Authority = Readonly<{ kind: "ordinary" }>;

function createPrincipal(kind: Principal["kind"], id: string): Principal {
	const value = Object.freeze({
		[principalBrand]: true as const,
		questpiePrincipal: true as const,
		kind,
		id,
	});
	trustedPrincipals.add(value);
	return value;
}

export const principal = Object.freeze({
	anonymous: (): Principal => createPrincipal("anonymous", "anonymous"),
	service: (input: Readonly<{ name: string }>): Principal =>
		createPrincipal("service", input.name),
	user: (input: Readonly<{ id: string }>): Principal =>
		createPrincipal("user", input.id),
	is: (value: unknown): value is Principal =>
		Boolean(value && typeof value === "object" && trustedPrincipals.has(value)),
});

type ContextError<
	Code extends string,
	Resource extends string | undefined,
> = Error &
	Readonly<{
		code: Code;
	}> &
	(Resource extends string
		? Readonly<{ resource: Resource }>
		: Readonly<Record<never, never>>);

function contextError<
	const Code extends "notFound" | "unauthenticated",
	const Resource extends string | undefined,
>(code: Code, resource: Resource): ContextError<Code, Resource> {
	const error = Object.assign(
		new Error(code),
		resource === undefined ? { code } : { code, resource },
	);
	return Object.freeze(error) as unknown as ContextError<Code, Resource>;
}

export const context = Object.freeze({
	tenant: <const Id extends string>(value: Readonly<{ id: Id }>) =>
		Object.freeze({ id: value.id }),
	error: Object.freeze({
		unauthenticated: (): ContextError<"unauthenticated", undefined> =>
			contextError("unauthenticated", undefined),
		notFound: <const Resource extends string>(
			resource: Resource,
		): ContextError<"notFound", Resource> => contextError("notFound", resource),
	}),
});

type BootstrapValue<Node> =
	Node extends FieldDefinition<infer Value, infer Nullable>
		? Value | (Nullable extends true ? null : never)
		: never;

type BootstrapSelection<Fields extends Readonly<Record<string, FieldNode>>> =
	Readonly<{
		[Key in keyof Fields]?: Fields[Key] extends FieldDefinition
			? true
			: Fields[Key] extends InlineShapeDefinition<infer Children>
				? BootstrapSelection<Children>
				: never;
	}>;

type BootstrapSelectedNode<Node, Selection> = Node extends FieldDefinition
	? Selection extends true
		? BootstrapValue<Node>
		: never
	: Node extends InlineShapeDefinition<infer Children>
		? Selection extends BootstrapSelection<Children>
			? BootstrapSelectedRow<Children, Selection>
			: never
		: never;

type BootstrapSelectedRow<
	Fields extends Readonly<Record<string, FieldNode>>,
	Selection extends BootstrapSelection<Fields>,
> = Readonly<{
	[Key in keyof Selection & keyof Fields]: BootstrapSelectedNode<
		Fields[Key],
		Selection[Key]
	>;
}>;

type BootstrapFields<Collection> =
	Collection extends CollectionDefinition<
		string,
		infer Fields,
		infer _Constraints
	>
		? Fields
		: never;

type BootstrapConstraints<Collection> =
	Collection extends CollectionDefinition<
		string,
		infer _Fields,
		infer Constraints
	>
		? Constraints
		: never;

export interface ContextBootstrap {
	get<
		const Collection extends CollectionDefinition,
		const Selection extends BootstrapSelection<BootstrapFields<Collection>>,
	>(
		collection: Collection,
		input: Readonly<{
			key: SeedPrimaryKey<
				BootstrapFields<Collection>,
				BootstrapConstraints<Collection>
			>;
			select: Selection &
				Readonly<
					Record<
						Exclude<keyof Selection, keyof BootstrapFields<Collection>>,
						never
					>
				>;
		}>,
	): Promise<BootstrapSelectedRow<
		BootstrapFields<Collection>,
		Selection
	> | null>;
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
	resolve(
		input: Readonly<{
			input: Input;
			principal: Principal;
			bootstrap: ContextBootstrap;
		}>,
	): MaybePromise<Resolved>;
}

export type ContextInputOf<Definition> =
	Definition extends ContextDefinition<
		infer _Name,
		infer Input,
		infer _Resolved
	>
		? Input
		: never;

export type ContextResolvedOf<Definition> =
	Definition extends ContextDefinition<
		infer _Name,
		infer _Input,
		infer Resolved
	>
		? DeepReadonly<Resolved>
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
			}>,
		) => MaybePromise<Resolved>;
	}>,
): ContextDefinition<Name, CodecValue<InputCodec>, DeepReadonly<Resolved>> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "context",
		}),
		name: input.name,
		input: input.input,
		executableSlots: Object.freeze(["resolve"] as const),
		resolve: input.resolve,
	}) as unknown as ContextDefinition<
		Name,
		CodecValue<InputCodec>,
		DeepReadonly<Resolved>
	>;
}
