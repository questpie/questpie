// Throwaway type proof for docs/v4/data-model-and-query-grammar.md.

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? true
		: false;
type Expect<Value extends true> = Value;
type Simplify<Value> = { [Key in keyof Value]: Value[Key] };

type Timestamp = string;
type Timestamptz = string;

type ScalarCodec =
	| { readonly kind: "uuid" }
	| {
			readonly kind: "text";
			readonly minLength: number | null;
			readonly maxLength: number | null;
	  }
	| {
			readonly kind: "integer";
			readonly minimum: number | null;
			readonly maximum: number | null;
	  }
	| { readonly kind: "timestamp"; readonly withTimezone: boolean };
interface DataFieldDescriptor<
	Identity extends string,
	Codec extends ScalarCodec,
	Value,
	Nullable extends boolean,
	HasDefault extends boolean,
> {
	readonly identity: Identity;
	readonly __value: Value;
	readonly codec: Codec;
	readonly __nullable: Nullable;
	readonly __hasDefault: HasDefault;
}

type FieldValue<Definition> =
	Definition extends DataFieldDescriptor<
		string,
		ScalarCodec,
		infer Value,
		infer Nullable,
		boolean
	>
		? Nullable extends true
			? Value | null
			: Value
		: never;
type RequiredInsertKey<Fields> = {
	[Key in keyof Fields]: Fields[Key] extends DataFieldDescriptor<
		string,
		ScalarCodec,
		unknown,
		infer Nullable,
		infer HasDefault
	>
		? Nullable extends false
			? HasDefault extends false
				? Key
				: never
			: never
		: never;
}[keyof Fields];
type OptionalInsertKey<Fields> = Exclude<
	keyof Fields,
	RequiredInsertKey<Fields>
>;
type ReadRow<Fields> = {
	-readonly [Key in keyof Fields]: FieldValue<Fields[Key]>;
};
type InsertRow<Fields> = {
	-readonly [Key in RequiredInsertKey<Fields>]: FieldValue<Fields[Key]>;
} & {
	-readonly [Key in OptionalInsertKey<Fields>]?: FieldValue<Fields[Key]>;
};
type UpdateRow<Fields> = {
	-readonly [Key in keyof Fields]?: FieldValue<Fields[Key]>;
};

interface AppointmentOwnerFields {
	readonly id: DataFieldDescriptor<
		"collection:appointments/field:id",
		{ kind: "uuid" },
		string,
		false,
		true
	>;
	readonly tenantId: DataFieldDescriptor<
		"collection:appointments/field:tenantId",
		{ kind: "uuid" },
		string,
		false,
		false
	>;
	readonly customerName: DataFieldDescriptor<
		"collection:appointments/field:customerName",
		{ kind: "text"; minLength: null; maxLength: 160 },
		string,
		false,
		false
	>;
	readonly startsAt: DataFieldDescriptor<
		"collection:appointments/field:startsAt",
		{ kind: "timestamp"; withTimezone: true },
		Timestamptz,
		false,
		false
	>;
	readonly endsAt: DataFieldDescriptor<
		"collection:appointments/field:endsAt",
		{ kind: "timestamp"; withTimezone: true },
		Timestamptz,
		false,
		false
	>;
	readonly status: DataFieldDescriptor<
		"collection:appointments/field:status",
		{ kind: "text"; minLength: null; maxLength: 24 },
		string,
		false,
		true
	>;
}
interface AuditAugmentation {
	readonly auditNote: DataFieldDescriptor<
		"collection:appointments/field:auditNote",
		{ kind: "text"; minLength: null; maxLength: 500 },
		string,
		true,
		false
	>;
}
interface ExternalAugmentation {
	readonly externalRef: DataFieldDescriptor<
		"collection:appointments/field:externalRef",
		{ kind: "text"; minLength: null; maxLength: 120 },
		string,
		false,
		false
	>;
}
type FoldAugmentations<
	Fields,
	Augmentations extends readonly object[],
> = Augmentations extends readonly [
	infer Head extends object,
	...infer Tail extends readonly object[],
]
	? FoldAugmentations<Simplify<Fields & Head>, Tail>
	: Fields;
type AppointmentFields = FoldAugmentations<
	AppointmentOwnerFields,
	readonly [AuditAugmentation, ExternalAugmentation]
>;

interface TenantFields {
	readonly id: DataFieldDescriptor<
		"collection:tenants/field:id",
		{ kind: "uuid" },
		string,
		false,
		true
	>;
	readonly slug: DataFieldDescriptor<
		"collection:tenants/field:slug",
		{ kind: "text"; minLength: null; maxLength: 80 },
		string,
		false,
		false
	>;
	readonly name: DataFieldDescriptor<
		"collection:tenants/field:name",
		{ kind: "text"; minLength: null; maxLength: 160 },
		string,
		false,
		false
	>;
}
interface CodecWitnessFields {
	readonly localOpening: DataFieldDescriptor<
		"collection:codecWitness/field:localOpening",
		{ kind: "timestamp"; withTimezone: false },
		Timestamp,
		false,
		false
	>;
}

type AppointmentRow = ReadRow<AppointmentFields>;
type AppointmentInsert = InsertRow<AppointmentFields>;
type AppointmentUpdate = UpdateRow<AppointmentFields>;
type _row = Expect<
	Equal<
		AppointmentRow,
		{
			id: string;
			tenantId: string;
			customerName: string;
			startsAt: Timestamptz;
			endsAt: Timestamptz;
			status: string;
			auditNote: string | null;
			externalRef: string;
		}
	>
>;
type _insert = Expect<
	Equal<
		AppointmentInsert,
		{
			tenantId: string;
			customerName: string;
			startsAt: Timestamptz;
			endsAt: Timestamptz;
			externalRef: string;
		} & {
			id?: string;
			status?: string;
			auditNote?: string | null;
		}
	>
>;
type _update = Expect<
	Equal<
		AppointmentUpdate,
		{
			id?: string;
			tenantId?: string;
			customerName?: string;
			startsAt?: Timestamptz;
			endsAt?: Timestamptz;
			status?: string;
			auditNote?: string | null;
			externalRef?: string;
		}
	>
>;
type FieldCodec<Definition> =
	Definition extends DataFieldDescriptor<
		string,
		infer Codec,
		unknown,
		boolean,
		boolean
	>
		? Codec
		: never;
type _timestampWithoutZoneCodec = Expect<
	Equal<
		FieldCodec<CodecWitnessFields["localOpening"]>,
		{ kind: "timestamp"; withTimezone: false }
	>
>;
type _timestampWithZoneCodec = Expect<
	Equal<
		FieldCodec<AppointmentFields["startsAt"]>,
		{ kind: "timestamp"; withTimezone: true }
	>
>;
type _timestampCodecsStayDistinct = Expect<
	Equal<
		FieldCodec<CodecWitnessFields["localOpening"]> extends FieldCodec<
			AppointmentFields["startsAt"]
		>
			? true
			: false,
		false
	>
>;

// Nested-model proof. Inline shapes contain complete column capabilities and
// reconstruct a logical object; JSONB objects contain only embedded values.
interface ColumnValue<Value> {
	readonly __columnValue: Value;
}
interface EmbeddedValue<Value> {
	readonly __embeddedValue: Value;
}
type ColumnValueOf<Definition> =
	Definition extends ColumnValue<infer Value> ? Value : never;
type EmbeddedValueOf<Definition> =
	Definition extends EmbeddedValue<infer Value> ? Value : never;
type InlineMembers = Readonly<Record<string, ColumnValue<unknown>>>;
type EmbeddedProperties = Readonly<Record<string, EmbeddedValue<unknown>>>;
interface InlineShape<Members extends InlineMembers>
	extends ColumnValue<{
		-readonly [Key in keyof Members]: ColumnValueOf<Members[Key]>;
	}> {
	readonly kind: "inline";
	readonly fields: Members;
}
interface EmbeddedObject<Properties extends EmbeddedProperties>
	extends EmbeddedValue<{
		-readonly [Key in keyof Properties]: EmbeddedValueOf<Properties[Key]>;
	}> {
	readonly kind: "object";
	readonly properties: Properties;
}
interface EmbeddedArray<Item extends EmbeddedValue<unknown>>
	extends EmbeddedValue<ReadonlyArray<EmbeddedValueOf<Item>>> {
	readonly kind: "array";
	readonly items: Item;
	readonly maximumItems: number;
}
declare function inlineShape<const Members extends InlineMembers>(input: {
	fields: Members;
}): InlineShape<Members>;
declare function embeddedObject<const Properties extends EmbeddedProperties>(
	input: { properties: Properties },
): EmbeddedObject<Properties>;
declare function embeddedArray<const Item extends EmbeddedValue<unknown>>(input: {
	items: Item;
	maximumItems: number;
}): EmbeddedArray<Item>;
declare const columnText: ColumnValue<string>;
declare const postgisPoint: ColumnValue<{ longitude: number; latitude: number }>;
declare const valueText: EmbeddedValue<string>;
declare const valueBoolean: EmbeddedValue<boolean>;

const inlineAddress = inlineShape({
	fields: { city: columnText, location: postgisPoint },
});
const preferencesObject = embeddedObject({
	properties: { locale: valueText, marketingEmail: valueBoolean },
});
const contactsArray = embeddedArray({
	items: embeddedObject({
		properties: { label: valueText, primary: valueBoolean },
	}),
	maximumItems: 20,
});
type _inlineShape = Expect<
	Equal<
		ColumnValueOf<typeof inlineAddress>,
		{
			city: string;
			location: { longitude: number; latitude: number };
		}
	>
>;
type _embeddedObject = Expect<
	Equal<
		EmbeddedValueOf<typeof preferencesObject>,
		{ locale: string; marketingEmail: boolean }
	>
>;
type _embeddedArray = Expect<
	Equal<
		EmbeddedValueOf<typeof contactsArray>,
		ReadonlyArray<{ label: string; primary: boolean }>
	>
>;
embeddedObject({
	properties: {
		// @ts-expect-error native column capabilities are not JSONB value codecs.
		location: postgisPoint,
	},
});
inlineShape({
	fields: {
		// @ts-expect-error an embedded value is not an independently stored column.
		locale: valueText,
	},
});

interface Literal<Value> {
	readonly kind: "literal";
	readonly value: Value;
}
interface Parameter<Value, Nullable extends boolean> {
	readonly kind: "parameter";
	readonly __value: Value;
	readonly __nullable: Nullable;
}
interface ListParameter<Value, MaximumItems extends number> {
	readonly kind: "listParameter";
	readonly __value: readonly Value[];
	readonly __item: Value;
	readonly __maximumItems: MaximumItems;
	readonly __nullable: false;
}
interface Filter {
	readonly __filter: true;
}
interface OrderTerm<FieldKey extends PropertyKey> {
	readonly __field: FieldKey;
	readonly direction: "asc" | "desc";
	readonly nulls: "first" | "last";
}
type Operand<Value> = Value | Literal<Value> | Parameter<Value, false>;
type SetOperand<Value> =
	| readonly [Value, ...Value[]]
	| ListParameter<Value, number>;
type RangeCodec = { kind: "timestamp"; withTimezone: boolean };
type CursorOrderCodec =
	| { kind: "uuid" }
	| { kind: "text"; minLength: number | null; maxLength: number | null }
	| { kind: "integer"; minimum: number | null; maximum: number | null }
	| RangeCodec;
interface QueryField<
	FieldKey extends PropertyKey,
	Value,
	Codec extends ScalarCodec,
	Nullable extends boolean,
> {
	readonly __kind: "fieldOutput";
	readonly __field: FieldKey;
	readonly __value: Value | (Nullable extends true ? null : never);
	equal(value: Operand<Value>): Filter;
	notEqual(value: Operand<Value>): Filter;
	in(values: SetOperand<Value>): Filter;
	notIn(values: SetOperand<Value>): Filter;
	isNull: Nullable extends true ? () => Filter : never;
	isNotNull: Nullable extends true ? () => Filter : never;
	lessThan: Codec extends RangeCodec
		? (value: Operand<Value>) => Filter
		: never;
	ascending: Codec extends CursorOrderCodec
		? (options: { nulls: "first" | "last" }) => OrderTerm<FieldKey>
		: never;
	descending: Codec extends CursorOrderCodec
		? (options: { nulls: "first" | "last" }) => OrderTerm<FieldKey>
		: never;
}
type FieldMap = Readonly<
	Record<
		string,
		DataFieldDescriptor<string, ScalarCodec, unknown, boolean, boolean>
	>
>;
type QueryFields<Fields> = {
	readonly [Key in keyof Fields]: Fields[Key] extends DataFieldDescriptor<
		infer Identity,
		infer Codec,
		infer Value,
		infer Nullable,
		boolean
	>
		? QueryField<Key, Value, Codec, Nullable> & { readonly identity: Identity }
		: never;
};
interface ToOneOutput<Selection extends OutputSelection> {
	readonly __kind: "toOneOutput";
	readonly __selection: Selection;
}
interface FieldOutputNode<
	FieldKey extends PropertyKey = PropertyKey,
	Value = unknown,
> {
	readonly __kind: "fieldOutput";
	readonly __field: FieldKey;
	readonly __value: Value;
}
type OutputNode = FieldOutputNode | ToOneOutput<OutputSelection>;
type OutputSelection = Readonly<Record<string, OutputNode>>;
type SelectedOutput<Selection extends OutputSelection> = {
	-readonly [Alias in keyof Selection]: Selection[Alias] extends FieldOutputNode<
		PropertyKey,
		infer Value
	>
		? Value
		: Selection[Alias] extends ToOneOutput<infer Nested extends OutputSelection>
			? SelectedOutput<Nested> | null
			: never;
};
type SelectedSourceField<Selection extends OutputSelection> =
	Selection[keyof Selection] extends infer Node
		? Node extends FieldOutputNode<infer FieldKey, unknown>
			? FieldKey
			: never
		: never;
interface RelationExpression<TargetFields> {
	exists(
		predicate: (scope: { fields: QueryFields<TargetFields> }) => Filter,
	): Filter;
	notExists(
		predicate: (scope: { fields: QueryFields<TargetFields> }) => Filter,
	): Filter;
}
interface ToOneQueryRelation<
	TargetFields,
> extends RelationExpression<TargetFields> {
	select<const Selection extends OutputSelection>(
		callback: (scope: { fields: QueryFields<TargetFields> }) => Selection,
	): ToOneOutput<Selection>;
}
type QueryRelations<Relations> = {
	readonly [Key in keyof Relations]: Relations[Key] extends {
		readonly kind: infer Kind;
		readonly target: { readonly fields: infer TargetFields };
	}
		? Kind extends "toOne"
			? ToOneQueryRelation<TargetFields>
			: Kind extends "toMany"
				? RelationExpression<TargetFields>
				: never
		: never;
};
type QueryScope<Descriptor> = Descriptor extends {
	readonly fields: infer Fields;
	readonly relations: infer Relations;
}
	? {
			readonly fields: QueryFields<Fields>;
			readonly relations: QueryRelations<Relations>;
		}
	: never;

interface AppointmentDescriptor {
	readonly name: "appointments";
	readonly identity: "collection:appointments";
	readonly fields: AppointmentFields;
	readonly uniqueConstraints: {
		readonly primary: {
			readonly kind: "primaryKey";
			readonly fields: readonly ["id"];
		};
	};
	readonly relations: {
		readonly tenant: {
			readonly kind: "toOne";
			readonly target: {
				readonly name: "tenants";
				readonly identity: "collection:tenants";
				readonly fields: TenantFields;
			};
		};
	};
}
interface TenantDescriptor {
	readonly name: "tenants";
	readonly identity: "collection:tenants";
	readonly fields: TenantFields;
	readonly uniqueConstraints: {
		readonly primary: {
			readonly kind: "primaryKey";
			readonly fields: readonly ["id"];
		};
		readonly slugUnique: {
			readonly kind: "unique";
			readonly fields: readonly ["slug"];
		};
	};
	readonly relations: {
		readonly appointments: {
			readonly kind: "toMany";
			readonly target: {
				readonly name: "appointments";
				readonly identity: "collection:appointments";
				readonly fields: AppointmentFields;
			};
		};
	};
}

declare const appointmentScope: QueryScope<AppointmentDescriptor>;
declare const tenantScope: QueryScope<TenantDescriptor>;
declare const runtimeStatusList: ListParameter<string, 50>;
declare const wrongScalarListParameter: Parameter<readonly string[], false>;

appointmentScope.relations.tenant.exists(({ fields }) =>
	fields.slug.equal("old-town"),
);
appointmentScope.relations.tenant.notExists(({ fields }) =>
	fields.name.equal("Closed"),
);
tenantScope.relations.appointments.exists(({ fields }) =>
	fields.status.in(["scheduled", "confirmed"]),
);
tenantScope.relations.appointments.notExists(({ fields }) =>
	fields.customerName.equal("Blocked"),
);
appointmentScope.fields.startsAt.lessThan("2026-08-12T09:00:00.000Z");
appointmentScope.fields.status.in(["scheduled"]);
appointmentScope.fields.status.notIn(["cancelled", "completed"]);
appointmentScope.fields.status.in(runtimeStatusList);
appointmentScope.fields.status.notIn(runtimeStatusList);
appointmentScope.fields.auditNote.isNull();
appointmentScope.fields.auditNote.isNotNull();
// @ts-expect-error a scalar parameter containing an array is not a bounded list parameter.
appointmentScope.fields.status.in(wrongScalarListParameter);
// @ts-expect-error an empty membership tuple is invalid.
appointmentScope.fields.status.in([]);
// @ts-expect-error UUID range comparison is outside the public v1 operator matrix.
appointmentScope.fields.id.lessThan("11111111-1111-4111-8111-111111111111");
// @ts-expect-error Text filtering remains equality/set based; ordering is separate.
appointmentScope.fields.status.lessThan("scheduled");
appointmentScope.fields.status.ascending({ nulls: "last" });
appointmentScope.relations.tenant.exists(({ fields }) =>
	// @ts-expect-error a Tenant predicate cannot read an Appointment Field.
	fields.status.equal("scheduled"),
);

type ParameterValue<Definition> =
	Definition extends ListParameter<infer Value, number>
		? readonly Value[]
		: Definition extends Parameter<infer Value, infer Nullable>
		? Nullable extends true
			? Value | null
			: Value
		: never;
type ParameterValues<Definitions> = {
	-readonly [Key in keyof Definitions]: ParameterValue<Definitions[Key]>;
};
type NullableParameterKey<Definitions> = {
	[Key in keyof Definitions]: Definitions[Key] extends Parameter<
		unknown,
		infer Nullable
	>
		? Nullable extends true
			? Key
			: never
		: never;
}[keyof Definitions];
type IsUnion<Value, Whole = Value> = Value extends Whole
	? [Whole] extends [Value]
		? false
		: true
	: never;
type ValidCursorParameterSet<Definitions> = [
	NullableParameterKey<Definitions>,
] extends [never]
	? never
	: true extends IsUnion<NullableParameterKey<Definitions>>
		? never
		: unknown;
interface PageInfo {
	endCursor: string | null;
	hasNextPage: boolean;
}
interface DataQueryContract<Parameters, Node> {
	readonly parameters: Parameters;
	readonly result: { nodes: Node[]; pageInfo: PageInfo };
	bind(parameters: Parameters): void;
}
interface ForwardPage<First, After> {
	readonly kind: "forward";
	readonly first: First;
	readonly after: After;
}
declare const query: {
	and(first: Filter, second: Filter, ...rest: Filter[]): Filter;
	forwardCursor<
		First extends Parameter<number, false>,
		After extends Parameter<string, true>,
	>(input: {
		first: First;
		after: After;
	}): ForwardPage<First, After>;
};
type OrderFieldKeys<Order extends readonly OrderTerm<PropertyKey>[]> = {
	readonly [Index in keyof Order]: Order[Index] extends OrderTerm<infer Key>
		? Key
		: never;
};
type ConstraintFieldUnion<Descriptor> = Descriptor extends {
	readonly uniqueConstraints: infer Constraints;
}
	? Constraints[keyof Constraints] extends {
			readonly fields: infer Fields extends readonly PropertyKey[];
		}
		? Fields
		: never
	: never;
type EndsWith<
	Whole extends readonly PropertyKey[],
	Suffix extends readonly PropertyKey[],
> = Suffix extends readonly []
	? true
	: Whole extends readonly [...infer WholeRest, infer WholeLast]
		? Suffix extends readonly [...infer SuffixRest, infer SuffixLast]
			? Equal<WholeLast, SuffixLast> extends true
				? EndsWith<
						Extract<WholeRest, readonly PropertyKey[]>,
						Extract<SuffixRest, readonly PropertyKey[]>
					>
				: false
			: true
		: false;
type AllFieldsNonNullable<
	Fields,
	Keys extends readonly PropertyKey[],
> = Keys extends readonly [
	infer Head extends keyof Fields,
	...infer Tail extends readonly PropertyKey[],
]
	? Fields[Head] extends DataFieldDescriptor<
			string,
			ScalarCodec,
			unknown,
			false,
			boolean
		>
		? AllFieldsNonNullable<Fields, Tail>
		: false
	: true;
type ConstraintQualifies<
	Descriptor,
	Order extends readonly OrderTerm<PropertyKey>[],
	Suffix extends readonly PropertyKey[],
> = Descriptor extends { readonly fields: infer Fields }
	? EndsWith<OrderFieldKeys<Order>, Suffix> extends true
		? AllFieldsNonNullable<Fields, Suffix>
		: false
	: false;
type ValidTotalOrder<
	Descriptor,
	Order extends readonly OrderTerm<PropertyKey>[],
> = true extends (
	ConstraintFieldUnion<Descriptor> extends infer Suffix
		? Suffix extends readonly PropertyKey[]
			? ConstraintQualifies<Descriptor, Order, Suffix>
			: never
		: never
)
	? Order
	: never;
type DescriptorFieldKeys<Descriptor> = Descriptor extends {
	readonly fields: infer Fields;
}
	? keyof Fields & string
	: never;
type _singlePrimaryOrderIsTotal = Expect<
	Equal<
		ValidTotalOrder<AppointmentDescriptor, readonly [OrderTerm<"id">]>,
		readonly [OrderTerm<"id">]
	>
>;
declare function dataQuery<
	Descriptor extends {
		readonly name: string;
		readonly fields: FieldMap;
		readonly uniqueConstraints: Readonly<
			Record<string, { readonly fields: readonly string[] }>
		>;
		readonly relations: Readonly<Record<string, unknown>>;
	},
>(): <
	const Parameters extends Record<
		string,
		Parameter<unknown, boolean> | ListParameter<unknown, number>
	>,
	const Selection extends OutputSelection,
	const Order extends readonly [
		OrderTerm<DescriptorFieldKeys<Descriptor>>,
		...OrderTerm<DescriptorFieldKeys<Descriptor>>[],
	],
>(definition: {
	readonly from: Descriptor["name"];
	readonly parameters: Parameters & ValidCursorParameterSet<Parameters>;
	readonly select: (scope: QueryScope<Descriptor>) => Selection;
	readonly where:
		| null
		| ((
				scope: QueryScope<Descriptor> & { readonly parameters: Parameters },
		  ) => Filter);
	readonly orderBy: (
		scope: QueryScope<Descriptor>,
	) => ValidTotalOrder<Descriptor, Order> &
		(Exclude<
			Order[number]["__field"],
			SelectedSourceField<Selection>
		> extends never
			? unknown
			: never);
	readonly page: (scope: {
		readonly parameters: Parameters;
	}) => ForwardPage<Parameter<number, false>, Parameter<string, true>>;
}) => DataQueryContract<ParameterValues<Parameters>, SelectedOutput<Selection>>;

const appointmentPage = dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		tenantId: { kind: "parameter" } as Parameter<string, false>,
		statuses: { kind: "listParameter" } as ListParameter<string, 50>,
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: ({ fields, relations }) => ({
		id: fields.id,
		customerLabel: fields.customerName,
		startsAt: fields.startsAt,
		calendarStart: fields.startsAt,
		status: fields.status,
		tenant: relations.tenant.select(({ fields: tenant }) => ({
			slug: tenant.slug,
			name: tenant.name,
		})),
	}),
	where: ({ fields, parameters }) =>
		query.and(
			fields.tenantId.equal(parameters.tenantId),
			fields.status.in(parameters.statuses),
		),
	orderBy: ({ fields }) => [
		fields.startsAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});
type _parameters = Expect<
	Equal<
		typeof appointmentPage.parameters,
		{
			tenantId: string;
			statuses: readonly string[];
			first: number;
			after: string | null;
		}
	>
>;
type _result = Expect<
	Equal<
		typeof appointmentPage.result,
		{
			nodes: Array<{
				id: string;
				customerLabel: string;
				startsAt: Timestamptz;
				calendarStart: Timestamptz;
				status: string;
				tenant: { slug: string; name: string } | null;
			}>;
			pageInfo: PageInfo;
		}
	>
>;
appointmentPage.bind({
	tenantId: "11111111-1111-4111-8111-111111111111",
	statuses: ["confirmed", "scheduled", "confirmed"],
	first: 20,
	after: null,
});
appointmentPage.bind({
	// @ts-expect-error UUID parameters do not accept numbers.
	tenantId: 42,
	statuses: [],
	first: 20,
	after: null,
});

const allAppointments = dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		limit: { kind: "parameter" } as Parameter<number, false>,
		cursor: { kind: "parameter" } as Parameter<string, true>,
	},
	select: ({ fields }) => ({ id: fields.id, startsAt: fields.startsAt }),
	where: null,
	orderBy: ({ fields }) => [
		fields.startsAt.descending({ nulls: "first" }),
		fields.id.descending({ nulls: "first" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.limit,
			after: parameters.cursor,
		}),
});
type _nullWhereResult = Expect<
	Equal<
		(typeof allAppointments.result)["nodes"][number],
		{ id: string; startsAt: Timestamptz }
	>
>;
const selectIdAndStart = ({ fields }: QueryScope<AppointmentDescriptor>) => ({
	id: fields.id,
	startsAt: fields.startsAt,
});
const ascendingAppointmentOrder = ({
	fields,
}: QueryScope<AppointmentDescriptor>) =>
	[
		fields.startsAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	] as const;

dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: ({ fields }) => ({ id: fields.id }),
	where: null,
	// @ts-expect-error every order Field must be selected directly, even under aliases.
	orderBy: ({ fields }) => [
		fields.startsAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({ first: parameters.first, after: parameters.after }),
});

dataQuery<AppointmentDescriptor>()({
	// @ts-expect-error from is the exact generated Collection name.
	from: "tenants",
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: selectIdAndStart,
	where: null,
	orderBy: ascendingAppointmentOrder,
	page: ({ parameters }) =>
		query.forwardCursor({ first: parameters.first, after: parameters.after }),
});

dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	// @ts-expect-error `after` is the one nullable cursor parameter; scalar parameters are non-nullable.
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
		secondCursor: { kind: "parameter" } as Parameter<string, true>,
	},
	select: selectIdAndStart,
	where: null,
	orderBy: ascendingAppointmentOrder,
	page: ({ parameters }) =>
		query.forwardCursor({ first: parameters.first, after: parameters.after }),
});

// @ts-expect-error a data Query definition cannot omit `where`.
dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: selectIdAndStart,
	orderBy: ascendingAppointmentOrder,
	page: ({ parameters }) =>
		query.forwardCursor({ first: parameters.first, after: parameters.after }),
});

// @ts-expect-error a data Query definition cannot omit `page`.
dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: selectIdAndStart,
	where: null,
	orderBy: ascendingAppointmentOrder,
});

interface CompositeKeyDescriptor {
	readonly fields: Pick<
		AppointmentFields,
		"tenantId" | "externalRef" | "auditNote"
	>;
	readonly uniqueConstraints: {
		readonly externalIdentity: {
			readonly fields: readonly ["tenantId", "externalRef"];
		};
		readonly nullableIdentity: {
			readonly fields: readonly ["tenantId", "auditNote"];
		};
	};
}
type _compositeNonNullableSuffixIsTotal = Expect<
	Equal<
		ValidTotalOrder<
			CompositeKeyDescriptor,
			readonly [OrderTerm<"tenantId">, OrderTerm<"externalRef">]
		>,
		readonly [OrderTerm<"tenantId">, OrderTerm<"externalRef">]
	>
>;
type _nullableUniqueSuffixIsRejected = Expect<
	Equal<
		ValidTotalOrder<
			CompositeKeyDescriptor,
			readonly [OrderTerm<"tenantId">, OrderTerm<"auditNote">]
		>,
		never
	>
>;
