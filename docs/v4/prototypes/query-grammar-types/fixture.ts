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
	| { readonly kind: "timestamp"; readonly withTimezone: boolean };
interface Field<
	Value,
	Codec extends ScalarCodec,
	Nullable extends boolean,
	HasDefault extends boolean,
> {
	readonly __value: Value;
	readonly codec: Codec;
	readonly __nullable: Nullable;
	readonly __hasDefault: HasDefault;
}

type FieldValue<Definition> =
	Definition extends Field<infer Value, ScalarCodec, infer Nullable, boolean>
		? Nullable extends true
			? Value | null
			: Value
		: never;
type RequiredInsertKey<Fields> = {
	[Key in keyof Fields]: Fields[Key] extends Field<
		unknown,
		ScalarCodec,
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
	readonly id: Field<string, { kind: "uuid" }, false, true>;
	readonly tenantId: Field<string, { kind: "uuid" }, false, false>;
	readonly customerName: Field<
		string,
		{ kind: "text"; minLength: null; maxLength: 160 },
		false,
		false
	>;
	readonly startsAt: Field<
		Timestamptz,
		{ kind: "timestamp"; withTimezone: true },
		false,
		false
	>;
	readonly endsAt: Field<
		Timestamptz,
		{ kind: "timestamp"; withTimezone: true },
		false,
		false
	>;
	readonly status: Field<
		string,
		{ kind: "text"; minLength: null; maxLength: 24 },
		false,
		true
	>;
}
interface AuditAugmentation {
	readonly auditNote: Field<
		string,
		{ kind: "text"; minLength: null; maxLength: 500 },
		true,
		false
	>;
}
interface ExternalAugmentation {
	readonly externalRef: Field<
		string,
		{ kind: "text"; minLength: null; maxLength: 120 },
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
	readonly id: Field<string, { kind: "uuid" }, false, true>;
	readonly slug: Field<
		string,
		{ kind: "text"; minLength: null; maxLength: 80 },
		false,
		false
	>;
	readonly name: Field<
		string,
		{ kind: "text"; minLength: null; maxLength: 160 },
		false,
		false
	>;
}
interface CodecWitnessFields {
	readonly localOpening: Field<
		Timestamp,
		{ kind: "timestamp"; withTimezone: false },
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
	Definition extends Field<unknown, infer Codec, boolean, boolean>
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

interface Literal<Value> {
	readonly kind: "literal";
	readonly value: Value;
}
interface Parameter<Value, Nullable extends boolean> {
	readonly kind: "parameter";
	readonly __value: Value;
	readonly __nullable: Nullable;
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
type RangeCodec = { kind: "timestamp"; withTimezone: boolean };
type CursorOrderCodec = { kind: "uuid" } | RangeCodec;
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
	in(values: readonly [Value, ...Value[]]): Filter;
	notIn(values: readonly [Value, ...Value[]]): Filter;
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
	Record<string, Field<unknown, ScalarCodec, boolean, boolean>>
>;
type QueryFields<Fields> = {
	readonly [Key in keyof Fields]: Fields[Key] extends Field<
		infer Value,
		infer Codec,
		infer Nullable,
		boolean
	>
		? QueryField<Key, Value, Codec, Nullable>
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
declare const runtimeListParameter: Parameter<readonly string[], false>;

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
appointmentScope.fields.auditNote.isNull();
appointmentScope.fields.auditNote.isNotNull();
// @ts-expect-error in/notIn v1 accepts a non-empty literal tuple, not a list parameter.
appointmentScope.fields.status.in(runtimeListParameter);
// @ts-expect-error an empty membership tuple is invalid.
appointmentScope.fields.status.in([]);
// @ts-expect-error UUID range comparison is outside the public v1 operator matrix.
appointmentScope.fields.id.lessThan("11111111-1111-4111-8111-111111111111");
appointmentScope.relations.tenant.exists(({ fields }) =>
	// @ts-expect-error a Tenant predicate cannot read an Appointment Field.
	fields.status.equal("scheduled"),
);

type ParameterValue<Definition> =
	Definition extends Parameter<infer Value, infer Nullable>
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
type ValidTotalOrder<
	Descriptor,
	Order extends readonly OrderTerm<PropertyKey>[],
> = true extends (
	ConstraintFieldUnion<Descriptor> extends infer Suffix
		? Suffix extends readonly PropertyKey[]
			? EndsWith<OrderFieldKeys<Order>, Suffix>
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
	const Parameters extends Record<string, Parameter<unknown, boolean>> & {
		readonly first: Parameter<number, false>;
		readonly after: Parameter<string, true>;
	},
	const Selection extends OutputSelection,
	const Order extends readonly [
		OrderTerm<DescriptorFieldKeys<Descriptor>>,
		...OrderTerm<DescriptorFieldKeys<Descriptor>>[],
	],
>(definition: {
	readonly from: Descriptor["name"];
	readonly parameters: Parameters &
		(Equal<NullableParameterKey<Parameters>, "after"> extends true
			? unknown
			: never);
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
	}) => ForwardPage<Parameters["first"], Parameters["after"]>;
}) => DataQueryContract<ParameterValues<Parameters>, SelectedOutput<Selection>>;

const appointmentPage = dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		tenantId: { kind: "parameter" } as Parameter<string, false>,
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
			fields.status.in(["scheduled", "confirmed"]),
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
		{ tenantId: string; first: number; after: string | null }
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
	first: 20,
	after: null,
});
// @ts-expect-error UUID parameters do not accept numbers.
appointmentPage.bind({ tenantId: 42, first: 20, after: null });

const allAppointments = dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: ({ fields }) => ({ id: fields.id, startsAt: fields.startsAt }),
	where: null,
	orderBy: ({ fields }) => [
		fields.startsAt.descending({ nulls: "first" }),
		fields.id.descending({ nulls: "first" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({ first: parameters.first, after: parameters.after }),
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

// @ts-expect-error a data Query definition cannot omit `where` or `page`.
dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: selectIdAndStart,
	orderBy: ascendingAppointmentOrder,
});

interface OrderField<Key extends string, Nullable extends boolean> {
	readonly key: Key;
	readonly nullable: Nullable;
}
type NonNullableKey<Key extends readonly OrderField<string, boolean>[]> =
	Key[number]["nullable"] extends false ? Key : never;
declare function acceptCompositeSuffix<
	const Key extends readonly OrderField<string, boolean>[],
>(key: NonNullableKey<Key>): void;
acceptCompositeSuffix([
	{ key: "tenantId", nullable: false },
	{ key: "externalRef", nullable: false },
]);
// @ts-expect-error a nullable unique key cannot prove a total cursor order.
acceptCompositeSuffix([
	{ key: "tenantId", nullable: false },
	{ key: "auditNote", nullable: true },
]);
