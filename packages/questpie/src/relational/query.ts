import type { DataFieldDescriptor } from "../index";
import { booleanExpression, type BooleanExpression } from "./model";

type FieldIdentity = `collection:${string}/field:${string}`;

type DataField = DataFieldDescriptor<
	FieldIdentity,
	Readonly<{ kind: string }>,
	unknown,
	boolean,
	boolean
>;

type FieldMap = Readonly<Record<string, DataField>>;

interface DataQueryDescriptor {
	readonly name: string;
	readonly identity: `collection:${string}`;
	readonly fields: FieldMap;
	readonly uniqueConstraints: Readonly<
		Record<string, Readonly<{ fields: readonly string[] }>>
	>;
	readonly relations: Readonly<Record<string, unknown>>;
}

interface QueryParameter<
	Value,
	Nullable extends boolean,
	Kind extends "cursor" | "integer" | "text" | "uuid",
> {
	readonly kind: "parameter";
	readonly parameterKind: Kind;
	readonly nullable: Nullable;
	readonly value?: Value;
}

type AnyQueryParameter = QueryParameter<
	unknown,
	boolean,
	"cursor" | "integer" | "text" | "uuid"
>;

type ParameterMap = Readonly<Record<string, AnyQueryParameter>>;

type ParameterValue<Parameter> =
	Parameter extends QueryParameter<
		infer Value,
		infer Nullable,
		"cursor" | "integer" | "text" | "uuid"
	>
		? Value | (Nullable extends true ? null : never)
		: never;

type ParameterValues<Parameters> = {
	-readonly [Key in keyof Parameters]: ParameterValue<Parameters[Key]>;
};

interface OrderTerm<Field extends PropertyKey> {
	readonly kind: "order";
	readonly field: Field;
	readonly direction: "ascending" | "descending";
	readonly nulls: "first" | "last";
}

type NonNull<Value> = Exclude<Value, null | undefined>;

interface QueryField<
	Key extends PropertyKey,
	Value,
	Codec,
	Nullable extends boolean,
> {
	readonly kind: "field";
	readonly field: Key;
	readonly value?: Value | (Nullable extends true ? null : never);
	equal(
		value:
			| NonNull<Value>
			| QueryField<PropertyKey, NonNull<Value>, Codec, boolean>
			| QueryParameter<NonNull<Value>, false, "integer" | "text" | "uuid">,
	): BooleanExpression;
	notEqual(
		value:
			| NonNull<Value>
			| QueryField<PropertyKey, NonNull<Value>, Codec, boolean>
			| QueryParameter<NonNull<Value>, false, "integer" | "text" | "uuid">,
	): BooleanExpression;
	in(values: readonly NonNull<Value>[]): BooleanExpression;
	notIn(values: readonly NonNull<Value>[]): BooleanExpression;
	isNull: Nullable extends true ? () => BooleanExpression : never;
	isNotNull: Nullable extends true ? () => BooleanExpression : never;
	lessThan: Codec extends Readonly<{ kind: "integer" | "timestamp" }>
		? (value: NonNull<Value>) => BooleanExpression
		: never;
	ascending: Codec extends Readonly<{
		kind: "integer" | "text" | "timestamp" | "uuid";
	}>
		? (options: Readonly<{ nulls: "first" | "last" }>) => OrderTerm<Key>
		: never;
	descending: Codec extends Readonly<{
		kind: "integer" | "text" | "timestamp" | "uuid";
	}>
		? (options: Readonly<{ nulls: "first" | "last" }>) => OrderTerm<Key>
		: never;
}

type QueryFields<Fields> = {
	readonly [Key in keyof Fields]: Fields[Key] extends DataFieldDescriptor<
		FieldIdentity,
		infer Codec,
		infer Value,
		infer Nullable,
		boolean
	>
		? QueryField<Key, Value, Codec, Nullable>
		: never;
};

type QueryScope<Descriptor extends DataQueryDescriptor> = Readonly<{
	fields: QueryFields<Descriptor["fields"]>;
}>;

interface SelectedField<Value> {
	readonly kind: "field";
	readonly value?: Value;
}

type OutputSelection = Readonly<Record<string, SelectedField<unknown>>>;

type SelectedOutput<Selection extends OutputSelection> = {
	-readonly [Key in keyof Selection]: Selection[Key] extends SelectedField<
		infer Value
	>
		? Value
		: never;
};

interface ForwardPage<
	First extends QueryParameter<number, false, "integer">,
	After extends QueryParameter<string, true, "cursor">,
> {
	readonly kind: "forwardCursor";
	readonly first: First;
	readonly after: After;
}

interface DataQueryDefinition<Parameters, Node> {
	readonly kind: "dataQuery";
	readonly parameters: Parameters;
	readonly result: Readonly<{
		nodes: Node[];
		pageInfo: Readonly<{
			endCursor: string | null;
			hasNextPage: boolean;
		}>;
	}>;
}

type DescriptorFieldKey<Descriptor extends DataQueryDescriptor> =
	keyof Descriptor["fields"] & string;

export function dataQuery<Descriptor extends DataQueryDescriptor>(): <
	const Parameters extends ParameterMap,
	const Selection extends OutputSelection,
	const Order extends readonly [
		OrderTerm<DescriptorFieldKey<Descriptor>>,
		...OrderTerm<DescriptorFieldKey<Descriptor>>[],
	],
>(
	definition: Readonly<{
		from: Descriptor["name"];
		parameters: Parameters;
		select: (scope: QueryScope<Descriptor>) => Selection;
		where:
			| null
			| ((
					scope: QueryScope<Descriptor> & Readonly<{ parameters: Parameters }>,
			  ) => BooleanExpression);
		orderBy: (scope: QueryScope<Descriptor>) => Order;
		page: (
			scope: Readonly<{ parameters: Parameters }>,
		) => ForwardPage<
			QueryParameter<number, false, "integer">,
			QueryParameter<string, true, "cursor">
		>;
	}>,
) => DataQueryDefinition<
	ParameterValues<Parameters>,
	SelectedOutput<Selection>
> {
	return (definition) =>
		Object.freeze({
			kind: "dataQuery",
			template: definition,
		}) as unknown as DataQueryDefinition<
			ParameterValues<typeof definition.parameters>,
			SelectedOutput<ReturnType<typeof definition.select>>
		>;
}

function parameter<
	Value,
	const Nullable extends boolean,
	const Kind extends "cursor" | "integer" | "text" | "uuid",
>(
	parameterKind: Kind,
	options: Readonly<{ nullable: Nullable }>,
): QueryParameter<Value, Nullable, Kind> {
	return Object.freeze({
		kind: "parameter",
		parameterKind,
		nullable: options.nullable,
	});
}

export const query = Object.freeze({
	and: (
		first: BooleanExpression,
		second: BooleanExpression,
		...rest: readonly BooleanExpression[]
	): BooleanExpression => booleanExpression("and", [first, second, ...rest]),
	or: (
		first: BooleanExpression,
		second: BooleanExpression,
		...rest: readonly BooleanExpression[]
	): BooleanExpression => booleanExpression("or", [first, second, ...rest]),
	not: (expression: BooleanExpression): BooleanExpression =>
		booleanExpression("not", [expression]),
	always: (): BooleanExpression => booleanExpression("always"),
	parameter: Object.freeze({
		uuid: (options: Readonly<{ nullable: false }>) =>
			parameter<string, false, "uuid">("uuid", options),
		text: (options: Readonly<{ nullable: false }>) =>
			parameter<string, false, "text">("text", options),
		integer: (
			options: Readonly<{
				nullable: false;
				minimum: number;
				maximum: number;
			}>,
		) => parameter<number, false, "integer">("integer", options),
		cursor: (options: Readonly<{ nullable: true }>) =>
			parameter<string, true, "cursor">("cursor", options),
	}),
	forwardCursor: <
		First extends QueryParameter<number, false, "integer">,
		After extends QueryParameter<string, true, "cursor">,
	>(
		input: Readonly<{ first: First; after: After }>,
	): ForwardPage<First, After> =>
		Object.freeze({ kind: "forwardCursor", ...input }),
});
