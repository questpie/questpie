import type { Codec, CodecValue } from "../codec";
import type {
	FieldReference,
	InverseRelationDefinition,
	RelationDefinition,
} from "../collection-contract";
import type { DataFieldDescriptor } from "../field-contract";
import type { FieldDefinition } from "../field-contract";
import type { FieldNode } from "../shape";
import { booleanExpression, type BooleanExpression } from "./model";

type FieldIdentity = `collection:${string}/field:${string}`;

type DataField = DataFieldDescriptor<
	FieldIdentity,
	Readonly<{ kind: string }>,
	unknown,
	boolean,
	boolean,
	boolean,
	boolean,
	boolean
>;

type FieldMap = Readonly<Record<string, DataField | FieldNode>>;

interface DataQueryDescriptor {
	readonly name: string;
	readonly identity: `collection:${string}`;
	readonly fields: FieldMap;
	readonly uniqueConstraints: Readonly<
		Record<string, Readonly<{ fields: readonly string[] }>>
	>;
	readonly relations: Readonly<Record<string, DataQueryRelationDescriptor>>;
}

interface DataQueryRelationDescriptor {
	readonly kind: "toOne" | "toMany";
	readonly identity: `collection:${string}/relation:${string}`;
	readonly target: Readonly<{
		name: string;
		identity: `collection:${string}`;
		fields: FieldMap;
	}>;
}

interface QueryParameter<
	Value,
	Nullable extends boolean,
	Kind extends "cursor" | "integer" | "list" | "text" | "uuid",
> {
	readonly kind: "parameter";
	readonly parameterKind: Kind;
	readonly nullable: Nullable;
	readonly codec?: Readonly<Record<string, unknown>>;
	readonly itemCodec?: Readonly<Record<string, unknown>>;
	readonly value?: Value;
}

type AnyQueryParameter = QueryParameter<
	unknown,
	boolean,
	"cursor" | "integer" | "list" | "text" | "uuid"
>;

type ParameterMap = Readonly<Record<string, AnyQueryParameter>>;

type ParameterValue<Parameter> =
	Parameter extends QueryParameter<
		infer Value,
		infer Nullable,
		"cursor" | "integer" | "list" | "text" | "uuid"
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
	in(
		values:
			| readonly NonNull<Value>[]
			| QueryParameter<readonly NonNull<Value>[], boolean, "list">,
	): BooleanExpression;
	notIn(
		values:
			| readonly NonNull<Value>[]
			| QueryParameter<readonly NonNull<Value>[], boolean, "list">,
	): BooleanExpression;
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
		boolean,
		boolean,
		boolean,
		boolean
	>
		? QueryField<Key, Value, Codec, Nullable>
		: Fields[Key] extends FieldDefinition<
					infer Value,
					infer Nullable,
					infer _Default,
					infer Scalar
			  >
			? QueryField<
					Key,
					Scalar extends "timestamp" ? Date : Value,
					Readonly<{ kind: Scalar }>,
					Nullable
				>
			: never;
};

type QueryScope<Descriptor extends DataQueryDescriptor> = Readonly<{
	fields: QueryFields<Descriptor["fields"]>;
}>;

interface SelectedField<Value> {
	readonly kind: "field";
	readonly value?: Value;
}

interface SelectedToOne<Selection extends OutputSelection> {
	readonly kind: "toOne";
	readonly selection: Selection;
}

type OutputSelection = Readonly<
	Record<string, SelectedField<unknown> | SelectedToOne<OutputSelection>>
>;

type SelectedOutput<Selection extends OutputSelection> = {
	-readonly [Key in keyof Selection]: Selection[Key] extends SelectedField<
		infer Value
	>
		? Value
		: Selection[Key] extends SelectedToOne<infer Nested>
			? SelectedOutput<Nested> | null
			: never;
};

type QueryRelations<Relations> = {
	readonly [Key in keyof Relations]: Relations[Key] extends infer Relation extends
		DataQueryRelationDescriptor
		? Relation["kind"] extends "toOne"
			? Readonly<{
					select<const Selection extends OutputSelection>(
						selection: (scope: {
							readonly fields: QueryFields<Relation["target"]["fields"]>;
						}) => Selection,
					): SelectedToOne<Selection>;
				}>
			: never
		: never;
};

type SelectionScope<Descriptor extends DataQueryDescriptor> =
	QueryScope<Descriptor> &
		Readonly<{ relations: QueryRelations<Descriptor["relations"]> }>;

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

type CodecParameterMap = Readonly<Record<string, Codec<unknown>>>;
type CodecParameterValues<Parameters extends CodecParameterMap> = {
	readonly [Key in keyof Parameters]: CodecValue<Parameters[Key]>;
};

type CodecParameterOperand<Parameter, Nullable extends boolean = false> =
	Parameter extends Readonly<{ kind: "nullable"; codec: infer Inner }>
		? CodecParameterOperand<Inner, true>
		: Parameter extends Readonly<{
					kind: "array";
					value?: readonly (infer Item)[];
			  }>
			? QueryParameter<readonly Item[], Nullable, "list">
			: Parameter extends Readonly<{ kind: "integer" }>
				? QueryParameter<number, Nullable, "integer">
				: Parameter extends Readonly<{ kind: "cursor" }>
					? QueryParameter<string, Nullable, "cursor">
					: Parameter extends Readonly<{ kind: "text" }>
						? QueryParameter<string, Nullable, "text">
						: Parameter extends Readonly<{ kind: "uuid" }>
							? QueryParameter<string, Nullable, "uuid">
							: never;

type CodecParameterOperands<Parameters extends CodecParameterMap> = {
	readonly [Key in keyof Parameters]: CodecParameterOperand<Parameters[Key]>;
};

type CollectionRelations = Readonly<
	Record<string, RelationDefinition | InverseRelationDefinition>
>;

type LiteralKeys<Value> = {
	[Key in keyof Value]: string extends Key ? never : Key;
}[keyof Value];

type ObjectSelection<Fields, Relations extends CollectionRelations> = Readonly<{
	[Key in keyof Fields]?: Fields[Key] extends
		| DataFieldDescriptor<
				FieldIdentity,
				Readonly<{ kind: string }>,
				unknown,
				boolean,
				boolean,
				boolean,
				boolean,
				boolean
		  >
		| FieldDefinition
		? true
		: never;
}> &
	Readonly<{
		[Key in LiteralKeys<Relations>]?: Relations[Key] extends RelationDefinition<
			string & `collection:${string}`,
			readonly FieldReference[],
			readonly FieldReference[],
			infer Target
		>
			? Target extends Readonly<{
					fields: infer TargetFields extends FieldMap;
					relations: infer TargetRelations extends CollectionRelations;
				}>
				? Readonly<{
						select: ObjectSelection<TargetFields, TargetRelations>;
					}>
				: never
			: never;
	}>;

type ScalarSelection<Fields> = Readonly<{
	[Key in keyof Fields]?: true;
}>;

type SelectedScalars<Fields, Selection extends ScalarSelection<Fields>> = {
	-readonly [Key in keyof Selection &
		keyof Fields]: Fields[Key] extends DataFieldDescriptor<
		FieldIdentity,
		Readonly<{ kind: string }>,
		infer Value,
		infer Nullable,
		boolean,
		boolean,
		boolean,
		boolean
	>
		? Value | (Nullable extends true ? null : never)
		: Fields[Key] extends FieldDefinition<
					infer AuthoredValue,
					infer AuthoredNullable,
					infer _Default,
					infer Scalar
			  >
			?
					| (Scalar extends "timestamp" ? Date : AuthoredValue)
					| (AuthoredNullable extends true ? null : never)
			: never;
};

type SelectedObject<
	Fields,
	Relations extends CollectionRelations,
	Selection,
> = {
	-readonly [Key in keyof Selection]: Key extends keyof Fields
		? SelectedScalars<
				Fields,
				Pick<Selection, Key> & ScalarSelection<Fields>
			>[Key]
		: Key extends keyof Relations
			? Relations[Key] extends RelationDefinition<
					string & `collection:${string}`,
					readonly FieldReference[],
					readonly FieldReference[],
					infer Target
				>
				? Target extends Readonly<{
						fields: infer TargetFields extends FieldMap;
						relations: infer TargetRelations extends CollectionRelations;
					}>
					? Selection[Key] extends Readonly<{ select: infer Nested }>
						? SelectedObject<TargetFields, TargetRelations, Nested> | null
						: never
					: never
				: never
			: never;
};

export interface CollectionListAuthoring<
	Fields extends FieldMap,
	Relations extends CollectionRelations,
> {
	<
		const Parameters extends CodecParameterMap,
		const Selection extends ObjectSelection<Fields, Relations>,
	>(
		definition: Readonly<{
			parameters: Parameters;
			where: (
				scope: Readonly<{
					row: QueryFields<Fields>;
					parameters: CodecParameterOperands<Parameters>;
				}>,
			) => BooleanExpression;
			orderBy:
				| Readonly<
						Record<
							keyof Fields & string,
							| "asc"
							| "desc"
							| Readonly<{
									direction: "asc" | "desc";
									nulls: "first" | "last";
							  }>
						>
				  >
				| Readonly<
						Partial<
							Record<
								keyof Fields & string,
								| "asc"
								| "desc"
								| Readonly<{
										direction: "asc" | "desc";
										nulls: "first" | "last";
								  }>
							>
						>
				  >;
			select: Selection;
			page: (
				scope: Readonly<{ parameters: CodecParameterOperands<Parameters> }>,
			) => Readonly<{
				first: QueryParameter<number, boolean, "integer">;
				after: QueryParameter<string, boolean, "cursor">;
			}>;
		}>,
	): DataQueryDefinition<
		CodecParameterValues<Parameters>,
		SelectedObject<Fields, Relations, Selection>
	>;
}

export function collectionList<
	Fields extends FieldMap,
	Relations extends CollectionRelations,
>(
	collection: Readonly<{ name: string; fields: Fields; relations: Relations }>,
): CollectionListAuthoring<Fields, Relations> {
	return ((definition: Readonly<Record<string, unknown>>) => {
		const codecs = codecRecord(definition.parameters);
		const parameters = Object.fromEntries(
			Object.entries(codecs).map(([name, descriptor]) => [
				name,
				queryParameterFromCodec(descriptor),
			]),
		);
		const selection = codecRecord(definition.select);
		const order = codecRecord(definition.orderBy);
		const where = definition.where as (
			scope: Readonly<Record<string, unknown>>,
		) => BooleanExpression;
		const page = definition.page as (
			scope: Readonly<Record<string, unknown>>,
		) => Readonly<{ first: unknown; after: unknown }>;
		return Object.freeze({
			kind: "dataQuery",
			owner: "operation",
			template: Object.freeze({
				from: collection.name,
				parameters: Object.freeze(parameters),
				select: ({
					fields,
					relations,
				}: Readonly<{ fields: CodecRecord; relations: CodecRecord }>) =>
					materializeObjectSelection(selection, fields, relations),
				where: ({
					fields,
					parameters: operands,
				}: Readonly<{
					fields: CodecRecord;
					parameters: CodecRecord;
				}>) => where({ row: fields, parameters: operands }),
				orderBy: ({ fields }: Readonly<{ fields: CodecRecord }>) =>
					Object.entries(order).map(([key, rawTerm]) => {
						const field = codecRecord(fields[key]);
						const term =
							typeof rawTerm === "string"
								? { direction: rawTerm, nulls: "last" }
								: codecRecord(rawTerm);
						const method =
							term.direction === "asc" ? "ascending" : "descending";
						return (field[method] as (options: unknown) => unknown)({
							nulls: term.nulls,
						});
					}),
				page: ({
					parameters: operands,
				}: Readonly<{
					parameters: CodecRecord;
				}>) =>
					Object.freeze({
						kind: "forwardCursor",
						...page({ parameters: operands }),
					}),
			}),
		});
	}) as unknown as CollectionListAuthoring<Fields, Relations>;
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
		select: (scope: SelectionScope<Descriptor>) => Selection;
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

type CodecRecord = Readonly<Record<string, unknown>>;

function codecRecord(value: unknown): CodecRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("Query parameter must be a codec");
	return value as CodecRecord;
}

function materializeObjectSelection(
	selection: CodecRecord,
	fields: CodecRecord,
	relations: CodecRecord,
): CodecRecord {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(selection).map(([key, selected]) => {
				if (selected === true) return [key, fields[key]];
				const relation = codecRecord(relations[key]);
				const nested = codecRecord(codecRecord(selected).select);
				return [
					key,
					(
						relation.select as (
							callback: (
								scope: Readonly<{
									fields: CodecRecord;
									relations: CodecRecord;
								}>,
							) => CodecRecord,
						) => unknown
					)((scope) =>
						materializeObjectSelection(nested, scope.fields, scope.relations),
					),
				];
			}),
		),
	);
}

function queryParameterFromCodec(value: unknown): AnyQueryParameter {
	let descriptor = codecRecord(value);
	let nullable = false;
	if (descriptor.kind === "nullable") {
		nullable = true;
		descriptor = codecRecord(descriptor.codec);
	}
	if (descriptor.kind === "cursor")
		return Object.freeze({
			kind: "parameter",
			parameterKind: "cursor",
			nullable,
			codec: descriptor,
		});
	if (descriptor.kind === "array") {
		const item = codecRecord(descriptor.items);
		if (
			!Number.isSafeInteger(descriptor.maximum) ||
			Number(descriptor.maximum) < 1
		)
			throw new TypeError("Query list parameter requires a positive maximum");
		return Object.freeze({
			kind: "parameter",
			parameterKind: "list",
			nullable,
			itemKind: item.kind,
			itemCodec: item,
			maximumItems: descriptor.maximum,
		});
	}
	if (
		descriptor.kind !== "integer" &&
		descriptor.kind !== "text" &&
		descriptor.kind !== "uuid"
	)
		throw new TypeError(
			`unsupported Query parameter codec ${String(descriptor.kind)}`,
		);
	return Object.freeze({
		kind: "parameter",
		parameterKind: descriptor.kind,
		nullable,
		codec: descriptor,
		...(descriptor.minimum === undefined
			? {}
			: { minimum: descriptor.minimum }),
		...(descriptor.maximum === undefined
			? {}
			: { maximum: descriptor.maximum }),
	});
}

function parameter<
	Value,
	const Nullable extends boolean,
	const Kind extends "cursor" | "integer" | "list" | "text" | "uuid",
>(
	parameterKind: Kind,
	options: Readonly<{ nullable: Nullable }> & Readonly<Record<string, unknown>>,
): QueryParameter<Value, Nullable, Kind> {
	return Object.freeze({
		kind: "parameter",
		parameterKind,
		...options,
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
