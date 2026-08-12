declare const codecValue: unique symbol;
declare const collectionContract: unique symbol;
declare const policyTarget: unique symbol;

interface CodecBase {
	readonly __codec?: true;
}

export interface Codec<Value> extends CodecBase {
	readonly [codecValue]?: Value;
}

export type CodecValue<ValueCodec> =
	ValueCodec extends Codec<infer Value> ? Value : never;

export type CodecMap = Readonly<Record<string, CodecBase>>;

export type Decoded<Shape extends CodecMap> = {
	readonly [Key in keyof Shape]: CodecValue<Shape[Key]>;
};

export interface CollectionSource<
	Identity extends `collection:${string}`,
	Row extends object,
	Key extends object,
> {
	readonly [collectionContract]: {
		readonly identity: Identity;
		readonly row: Row;
		readonly key: Key;
	};
}

export type AnyCollectionSource = CollectionSource<
	`collection:${string}`,
	object,
	object
>;

type ContractOf<Collection extends AnyCollectionSource> =
	Collection[typeof collectionContract];

type RowOf<Collection extends AnyCollectionSource> =
	ContractOf<Collection>["row"];

type KeyOf<Collection extends AnyCollectionSource> =
	ContractOf<Collection>["key"];

export function collection<
	const Name extends string,
	Row extends object,
	Key extends object,
>(name: Name): CollectionSource<`collection:${Name}`, Row, Key> {
	return { name } as never;
}

export type Selection<Row extends object> = {
	readonly [Key in keyof Row]?: true;
};

export type Selected<Row extends object, Select extends Selection<Row>> = {
	readonly [Key in keyof Select & keyof Row]: Row[Key];
};

export type Principal =
	| { readonly kind: "anonymous" }
	| { readonly kind: "user"; readonly id: string }
	| { readonly kind: "service"; readonly id: string };

export type DirectPrincipal = Exclude<
	Principal,
	{ readonly kind: "anonymous" }
>;

export interface Bootstrap {
	get<
		const Collection extends AnyCollectionSource,
		const Select extends Selection<RowOf<NoInfer<Collection>>>,
	>(
		collection: Collection,
		args: {
			readonly key: KeyOf<NoInfer<Collection>>;
			readonly select: Select;
		},
	): Promise<Selected<RowOf<Collection>, Select> | null>;
}

export interface ContextResolution<
	TenantId extends string = string,
	Values extends Readonly<Record<string, string | number | boolean | null>> =
		Readonly<Record<string, string | number | boolean | null>>,
> {
	readonly tenant: { readonly id: TenantId };
	readonly values: Values;
}

export interface ContextDefinition<
	Name extends string,
	Input extends Readonly<Record<string, unknown>>,
	Resolved extends ContextResolution,
> {
	readonly kind: "context";
	readonly name: Name;
	readonly __input?: Input;
	readonly __resolved?: Resolved;
}

export function defineContext<
	const Name extends string,
	const InputShape extends CodecMap,
	Resolved extends ContextResolution,
>(definition: {
	readonly name: Name;
	readonly input: InputShape;
	readonly resolve: (args: {
		readonly input: Decoded<InputShape>;
		readonly principal: Principal;
		readonly bootstrap: Bootstrap;
	}) => Resolved | Promise<Resolved>;
}): ContextDefinition<Name, Decoded<InputShape>, Awaited<Resolved>> {
	return definition as never;
}

export const context = {
	uuid(): Codec<string> {
		return {};
	},
	text(_options?: { readonly maximumLength?: number }): Codec<string> {
		return {};
	},
	integer(): Codec<number> {
		return {};
	},
	tenant<const Id extends string>(value: { readonly id: Id }) {
		return value;
	},
	error: {
		unauthenticated(): Error {
			return new Error("unauthenticated");
		},
		notFound(_resource: string): Error {
			return new Error("notFound");
		},
	},
};

export interface BooleanExpression {
	readonly kind: "booleanExpression";
}

type NonNull<Value> = Exclude<Value, null | undefined>;

export interface Operand<Value> {
	equal(value: NonNull<Value> | Operand<NonNull<Value>>): BooleanExpression;
	notEqual(value: NonNull<Value> | Operand<NonNull<Value>>): BooleanExpression;
	in(values: readonly NonNull<Value>[]): BooleanExpression;
	isNull(): BooleanExpression;
}

export type RowOperands<Row extends object> = {
	readonly [Key in keyof Row]: Operand<Row[Key]>;
};

export interface PrincipalOperand {
	readonly id: Operand<string>;
	readonly kind: Operand<Principal["kind"]>;
}

export interface TenantOperand {
	readonly id: Operand<string>;
}

export interface AuthorityOperand {
	isSystem(): BooleanExpression;
	isOrdinary(): BooleanExpression;
}

interface ExecutionOperands {
	readonly principal: PrincipalOperand;
	readonly tenant: TenantOperand;
	readonly authority: AuthorityOperand;
}

type ReadScope<Row extends object> = ExecutionOperands & {
	readonly row: RowOperands<Row>;
};

type CurrentScope<Row extends object> = ExecutionOperands & {
	readonly current: RowOperands<Row>;
};

type CandidateScope<Row extends object> = ExecutionOperands & {
	readonly candidate: RowOperands<Row>;
};

type UpdateCandidateScope<Row extends object> = ExecutionOperands & {
	readonly current: RowOperands<Row>;
	readonly candidate: RowOperands<Row>;
};

type FieldDecisionMap<Row extends object> = Partial<{
	readonly [Key in keyof Row]: BooleanExpression;
}>;

type PolicyRowRule<Row extends object, Target extends `collection:${string}`> =
	| ((scope: ReadScope<Row>) => BooleanExpression)
	| PolicyRowPredicate<Target>;

export interface PolicyBody<
	Row extends object,
	Name extends string,
	Target extends `collection:${string}`,
> {
	readonly name: Name;
	readonly read?: {
		readonly admit: BooleanExpression;
		readonly rows: PolicyRowRule<Row, Target>;
	};
	readonly create?: {
		readonly admit: BooleanExpression;
		readonly candidate: (scope: CandidateScope<Row>) => BooleanExpression;
	};
	readonly update?: {
		readonly admit: BooleanExpression;
		readonly rows: (scope: CurrentScope<Row>) => BooleanExpression;
		readonly candidate: (scope: UpdateCandidateScope<Row>) => BooleanExpression;
	};
	readonly delete?: {
		readonly admit: BooleanExpression;
		readonly rows: (scope: CurrentScope<Row>) => BooleanExpression;
	};
	readonly fields?: {
		readonly output?: (scope: ReadScope<Row>) => FieldDecisionMap<Row>;
		readonly create?: (scope: CandidateScope<Row>) => FieldDecisionMap<Row>;
		readonly update?: (scope: CurrentScope<Row>) => FieldDecisionMap<Row>;
	};
}

export interface PolicyDefinition<
	Identity extends `policy:${string}`,
	Target extends `collection:${string}`,
> {
	readonly kind: "policy";
	readonly identity: Identity;
	readonly [policyTarget]: Target;
}

export function definePolicy<
	const Collection extends AnyCollectionSource,
	const Name extends string,
>(
	collection: Collection,
	body: PolicyBody<
		RowOf<NoInfer<Collection>>,
		Name,
		ContractOf<NoInfer<Collection>>["identity"]
	>,
): PolicyDefinition<`policy:${Name}`, ContractOf<Collection>["identity"]> {
	return { collection, body } as never;
}

export interface PolicyRowPredicate<Target extends `collection:${string}`> {
	readonly [policyTarget]: Target;
}

export const policy = {
	authenticated(): BooleanExpression {
		return { kind: "booleanExpression" };
	},
	public(): BooleanExpression {
		return { kind: "booleanExpression" };
	},
	exists<const Collection extends AnyCollectionSource>(
		collection: Collection,
		predicate: (
			scope: ReadScope<RowOf<NoInfer<Collection>>>,
		) => BooleanExpression,
	): BooleanExpression {
		void collection;
		void predicate;
		return { kind: "booleanExpression" };
	},
	rows<const Collection extends AnyCollectionSource>(
		collection: Collection,
		predicate: (
			scope: ReadScope<RowOf<NoInfer<Collection>>>,
		) => BooleanExpression,
	): PolicyRowPredicate<ContractOf<Collection>["identity"]> {
		return { collection, predicate } as never;
	},
};

export const query = {
	and(
		first: BooleanExpression,
		second: BooleanExpression,
		...rest: readonly BooleanExpression[]
	): BooleanExpression {
		void first;
		void second;
		void rest;
		return { kind: "booleanExpression" };
	},
	or(
		first: BooleanExpression,
		second: BooleanExpression,
		...rest: readonly BooleanExpression[]
	): BooleanExpression {
		void first;
		void second;
		void rest;
		return { kind: "booleanExpression" };
	},
	not(expression: BooleanExpression): BooleanExpression {
		void expression;
		return { kind: "booleanExpression" };
	},
};
