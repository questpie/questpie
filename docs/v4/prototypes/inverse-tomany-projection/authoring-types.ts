export type FieldDefinition<
	Value,
	ConditionalOutput extends boolean = false,
> = Readonly<{
	readonly kind: "field";
	readonly value?: Value;
	readonly conditionalOutput?: ConditionalOutput;
}>;

export type FieldMap = Readonly<
	Record<string, FieldDefinition<unknown, boolean>>
>;

export interface CollectionShape {
	readonly fields: FieldMap;
	readonly relations: Readonly<
		Record<string, OwningRelation | InverseRelation>
	>;
}

export type OwningRelation<Target extends CollectionShape = CollectionShape> =
	Readonly<{
		readonly kind: "toOne";
		readonly target: Target;
	}>;

export type InverseRelation<
	InverseOf extends `collection:${string}/relation:${string}` =
		`collection:${string}/relation:${string}`,
> = Readonly<{
	readonly kind: "toMany";
	readonly inverseOf: InverseOf;
}>;

export type RelationMap = Readonly<
	Record<string, OwningRelation | InverseRelation>
>;

export interface BooleanExpression {
	readonly kind: "booleanExpression";
}

export interface QueryField<Value> {
	readonly value?: Value;
	equal(value: Value): BooleanExpression;
}

export type QueryFields<Fields extends FieldMap> = Readonly<{
	[Key in keyof Fields]: QueryField<FieldValue<Fields[Key]>>;
}>;

declare const childListBrand: unique symbol;

export interface ChildListSelection<
	Source extends `collection:${string}`,
	Row,
> {
	readonly kind: "toManyList";
	readonly source: Source;
	readonly result?: readonly Row[];
	readonly [childListBrand]: true;
}

export interface RootListDefinition<Row> {
	readonly kind: "rootList";
	readonly result?: Readonly<{
		readonly nodes: readonly Row[];
		readonly pageInfo: Readonly<{ readonly hasNextPage: boolean }>;
	}>;
}

export interface CollectionDefinition<
	Name extends string,
	Fields extends FieldMap,
	Relations extends RelationMap,
> {
	readonly name: Name;
	readonly fields: Fields;
	readonly relations: Relations;
	readonly list: CollectionListAuthoring<Name, Fields, Relations>;
}

type FieldValue<Field> =
	Field extends Readonly<{ value: infer Value }> ? Value : never;

type Simplify<Value> = { [Key in keyof Value]: Value[Key] };

type LiteralKeys<Value> = {
	[Key in keyof Value]: string extends Key ? never : Key;
}[keyof Value];

type InverseSource<Relation> =
	Relation extends Readonly<{ inverseOf: infer InverseOf }>
		? InverseOf extends `collection:${infer Name}/relation:${string}`
			? `collection:${Name}`
			: never
		: never;

type TargetFields<Relation> =
	Relation extends Readonly<{
		target: Readonly<{ fields: infer Fields extends FieldMap }>;
	}>
		? Fields
		: never;

type TargetRelations<Relation> =
	Relation extends Readonly<{
		target: Readonly<{ relations: infer Relations extends RelationMap }>;
	}>
		? Relations
		: never;

export type ObjectSelection<
	Fields extends FieldMap,
	Relations extends RelationMap,
> = Readonly<{
	[Key in keyof Fields]?: true;
}> &
	Readonly<{
		[Key in LiteralKeys<Relations>]?: Relations[Key] extends Readonly<{
			kind: "toOne";
		}>
			? Readonly<{
					select: ObjectSelection<
						TargetFields<Relations[Key]>,
						TargetRelations<Relations[Key]>
					>;
				}>
			: Relations[Key] extends Readonly<{
						kind: "toMany";
						inverseOf: `collection:${string}/relation:${string}`;
				  }>
				? ChildListSelection<InverseSource<Relations[Key]>, unknown>
				: never;
	}>;

type SelectedScalarProperties<Fields, Selection> = Readonly<{
	-readonly [Key in keyof Selection &
		keyof Fields as Fields[Key] extends Readonly<{
		conditionalOutput: true;
	}>
		? never
		: Key]: FieldValue<Fields[Key]>;
}> &
	Readonly<{
		-readonly [Key in keyof Selection &
			keyof Fields as Fields[Key] extends Readonly<{
			conditionalOutput: true;
		}>
			? Key
			: never]?: FieldValue<Fields[Key]>;
	}>;

type SelectedRelationProperties<
	Fields extends FieldMap,
	Relations extends RelationMap,
	Selection,
> = Readonly<{
	[Key in keyof Selection &
		LiteralKeys<Relations>]: Relations[Key] extends Readonly<{
		kind: "toOne";
	}>
		? NonNullable<Selection[Key]> extends Readonly<{ select: infer Nested }>
			? SelectedObject<
					TargetFields<Relations[Key]>,
					TargetRelations<Relations[Key]>,
					Nested
				> | null
			: never
		: Relations[Key] extends Readonly<{
					kind: "toMany";
					inverseOf: `collection:${string}/relation:${string}`;
			  }>
			? NonNullable<Selection[Key]> extends Readonly<{
					source: InverseSource<Relations[Key]>;
				}>
				? readonly ChildListRow<Selection[Key]>[]
				: never
			: never;
}>;

type ChildListRow<Selection> =
	Selection extends ChildListSelection<`collection:${string}`, infer Row>
		? Row
		: never;

export type SelectedObject<
	Fields extends FieldMap,
	Relations extends RelationMap,
	Selection,
> = Simplify<
	SelectedScalarProperties<Fields, Selection> &
		SelectedRelationProperties<Fields, Relations, Selection>
>;

type OrderedField<Fields extends FieldMap> = Readonly<
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

type UnconditionallyVisibleFields<Fields extends FieldMap> = Readonly<{
	[Key in keyof Fields as Fields[Key] extends Readonly<{
		conditionalOutput: true;
	}>
		? never
		: Key]: Fields[Key];
}>;

type ValidOrderedField<Fields extends FieldMap, Order> = Readonly<
	Record<Exclude<keyof Order, keyof Fields>, never>
>;

type ValidSelection<Fields, Relations, Selection> = Readonly<
	Record<Exclude<keyof Selection, keyof Fields | LiteralKeys<Relations>>, never>
> &
	Readonly<{
		[Key in keyof Selection &
			LiteralKeys<Relations>]: Relations[Key] extends Readonly<{
			kind: "toOne";
		}>
			? NonNullable<Selection[Key]> extends Readonly<{ select: infer Nested }>
				? Readonly<{
						select: Nested &
							ValidSelection<
								TargetFields<Relations[Key]>,
								TargetRelations<Relations[Key]>,
								NoInfer<Nested>
							>;
					}>
				: never
			: Selection[Key];
	}>;

type Enumerate<
	Limit extends number,
	Values extends readonly number[] = readonly [],
> = Values["length"] extends Limit
	? Values[number]
	: Enumerate<Limit, readonly [...Values, Values["length"]]>;

export type ChildListFirst = Exclude<Enumerate<51>, 0>;

export interface CollectionListAuthoring<
	Name extends string,
	Fields extends FieldMap,
	Relations extends RelationMap,
> {
	<
		const Selection extends Readonly<Record<string, unknown>>,
		const Order extends OrderedField<UnconditionallyVisibleFields<Fields>>,
	>(
		definition: Readonly<{
			first: ChildListFirst;
			parameters?: never;
			page?: never;
			where?: (
				scope: Readonly<{ row: QueryFields<Fields> }>,
			) => BooleanExpression;
			orderBy: Order &
				ValidOrderedField<UnconditionallyVisibleFields<Fields>, Order>;
			select: Selection &
				Readonly<Record<keyof Order, true>> &
				ObjectSelection<Fields, Relations> &
				ValidSelection<Fields, Relations, NoInfer<Selection>>;
		}>,
	): ChildListSelection<
		`collection:${Name}`,
		SelectedObject<Fields, Relations, Selection>
	>;

	<const Selection extends Readonly<Record<string, unknown>>>(
		definition: Readonly<{
			first?: never;
			parameters: Readonly<Record<string, unknown>>;
			where: (
				scope: Readonly<{ row: QueryFields<Fields> }>,
			) => BooleanExpression;
			orderBy: OrderedField<Fields>;
			select: Selection &
				ObjectSelection<Fields, Relations> &
				ValidSelection<Fields, Relations, NoInfer<Selection>>;
			page: (
				scope: Readonly<{ parameters: Readonly<Record<string, unknown>> }>,
			) => Readonly<{ first: unknown; after: unknown }>;
		}>,
	): RootListDefinition<SelectedObject<Fields, Relations, Selection>>;
}

export function defineCollection<
	const Name extends string,
	const Fields extends FieldMap,
	const Relations extends RelationMap,
>(definition: Readonly<{ name: Name; fields: Fields; relations: Relations }>) {
	return Object.freeze({
		...definition,
		list: ((list: Readonly<Record<string, unknown>>) => {
			const nested = "first" in list;
			const root = "parameters" in list || "page" in list;
			if (nested && root) throw new TypeError("invalid mixed list form");
			return nested
				? Object.freeze({
						kind: "toManyList",
						source: `collection:${definition.name}`,
						...list,
					})
				: Object.freeze({
						kind: "rootList",
						...list,
					});
		}) as unknown as CollectionListAuthoring<Name, Fields, Relations>,
	});
}
