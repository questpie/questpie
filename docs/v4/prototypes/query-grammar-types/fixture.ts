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

type ScalarKind = "uuid" | "text" | "timestamp" | "timestamptz";
interface Field<
	Value,
	Kind extends ScalarKind,
	Nullable extends boolean,
	HasDefault extends boolean,
> {
	readonly __value: Value;
	readonly __kind: Kind;
	readonly __nullable: Nullable;
	readonly __hasDefault: HasDefault;
}

type FieldValue<Definition> =
	Definition extends Field<infer Value, ScalarKind, infer Nullable, boolean>
		? Nullable extends true
			? Value | null
			: Value
		: never;
type RequiredInsertKey<Fields> = {
	[Key in keyof Fields]: Fields[Key] extends Field<
		unknown,
		ScalarKind,
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
	readonly id: Field<string, "uuid", false, true>;
	readonly tenantId: Field<string, "uuid", false, false>;
	readonly customerName: Field<string, "text", false, false>;
	readonly startsAt: Field<Timestamptz, "timestamptz", false, false>;
	readonly endsAt: Field<Timestamptz, "timestamptz", false, false>;
	readonly status: Field<string, "text", false, true>;
}
interface AuditAugmentation {
	readonly auditNote: Field<string, "text", true, false>;
}
interface ExternalAugmentation {
	readonly externalRef: Field<string, "text", false, false>;
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
	readonly id: Field<string, "uuid", false, true>;
	readonly slug: Field<string, "text", false, false>;
	readonly name: Field<string, "text", false, false>;
	readonly localOpening: Field<Timestamp, "timestamp", false, false>;
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
type FieldKind<Definition> =
	Definition extends Field<unknown, infer Kind, boolean, boolean>
		? Kind
		: never;
type _timestampCodecsStayDistinct = Expect<
	Equal<
		FieldKind<TenantFields["localOpening"]> extends FieldKind<
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
type Operand<Value> = Value | Literal<Value> | Parameter<Value, false>;
interface ScalarExpression<Value, Nullable extends boolean> {
	equal(value: Operand<Value>): Filter;
	notEqual(value: Operand<Value>): Filter;
	in(values: readonly [Value, ...Value[]]): Filter;
	notIn(values: readonly [Value, ...Value[]]): Filter;
	isNull: Nullable extends true ? () => Filter : never;
	isNotNull: Nullable extends true ? () => Filter : never;
}
interface Filter {
	readonly __filter: true;
}
type FieldExpressions<Fields> = {
	readonly [Key in keyof Fields]: Fields[Key] extends Field<
		infer Value,
		ScalarKind,
		infer Nullable,
		boolean
	>
		? ScalarExpression<Value, Nullable>
		: never;
};
interface RelationExpression<TargetFields> {
	exists(
		predicate: (scope: { fields: FieldExpressions<TargetFields> }) => Filter,
	): Filter;
	notExists(
		predicate: (scope: { fields: FieldExpressions<TargetFields> }) => Filter,
	): Filter;
}
interface AppointmentRelations {
	readonly tenant: RelationExpression<TenantFields>;
}
interface TenantRelations {
	readonly appointments: RelationExpression<AppointmentFields>;
}

declare const appointmentScope: {
	fields: FieldExpressions<AppointmentFields>;
	relations: AppointmentRelations;
};
declare const tenantScope: {
	fields: FieldExpressions<TenantFields>;
	relations: TenantRelations;
};
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
appointmentScope.fields.status.in(["scheduled"]);
appointmentScope.fields.status.notIn(["cancelled", "completed"]);
appointmentScope.fields.auditNote.isNull();
appointmentScope.fields.auditNote.isNotNull();
// @ts-expect-error in/notIn v1 accepts a non-empty literal tuple, not a list parameter.
appointmentScope.fields.status.in(runtimeListParameter);
// @ts-expect-error an empty membership tuple is invalid.
appointmentScope.fields.status.in([]);
appointmentScope.relations.tenant.exists(({ fields }) =>
	// @ts-expect-error a Tenant predicate cannot read an Appointment Field.
	fields.status.equal("scheduled"),
);

type FieldSelection<Fields> = { readonly [Key in keyof Fields]?: true };
interface TenantSelection extends FieldSelection<TenantFields> {}
interface AppointmentSelection extends FieldSelection<AppointmentFields> {
	readonly tenant?: { readonly select: TenantSelection };
}
type SelectedFields<Fields, Selection> = {
	-readonly [
		Key in keyof Selection as Key extends keyof Fields
			? Selection[Key] extends true
				? Key
				: never
			: never
	]: Key extends keyof Fields ? FieldValue<Fields[Key]> : never;
};
type SelectedAppointment<Selection extends AppointmentSelection> = Simplify<
	SelectedFields<AppointmentFields, Selection> &
		(Selection extends {
			readonly tenant: {
				readonly select: infer Tenant extends TenantSelection;
			};
		}
			? { tenant: SelectedFields<TenantFields, Tenant> | null }
			: object)
>;
type ParameterValue<Definition> =
	Definition extends Parameter<infer Value, infer Nullable>
		? Nullable extends true
			? Value | null
			: Value
		: never;
type ParameterValues<Definitions> = {
	-readonly [Key in keyof Definitions]: ParameterValue<Definitions[Key]>;
};
interface PageInfo {
	endCursor: string | null;
	hasNextPage: boolean;
}
interface DataQueryContract<Parameters, Node> {
	readonly parameters: Parameters;
	readonly result: { nodes: Node[]; pageInfo: PageInfo };
	bind(parameters: Parameters): void;
}
interface OrderTerm<FieldKey extends keyof AppointmentFields> {
	readonly field: FieldKey;
	readonly direction: "asc" | "desc";
	readonly nulls: "first" | "last";
}
interface AppointmentDescriptor {
	readonly name: "appointments";
	readonly fields: AppointmentFields;
	readonly relations: {
		readonly tenant: {
			readonly kind: "toOne";
			readonly target: "tenants";
		};
	};
}
type EndsInPrimaryKey<
	Order extends readonly OrderTerm<keyof AppointmentFields>[],
> = Order extends readonly [
	...OrderTerm<keyof AppointmentFields>[],
	OrderTerm<"id">,
]
	? Order
	: never;
declare function dataQuery<Descriptor extends AppointmentDescriptor>(): <
	const Parameters extends Record<string, Parameter<unknown, boolean>>,
	const Selection extends AppointmentSelection,
	const Order extends readonly [
		OrderTerm<keyof AppointmentFields>,
		...OrderTerm<keyof AppointmentFields>[],
	],
>(definition: {
	readonly from: Descriptor["name"];
	readonly parameters: Parameters;
	readonly select: Selection & {
		readonly [Key in Order[number]["field"]]: true;
	};
	readonly order: EndsInPrimaryKey<Order>;
}) => DataQueryContract<
	ParameterValues<Parameters>,
	SelectedAppointment<Selection>
>;

const appointmentPage = dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {
		tenantId: { kind: "parameter" } as Parameter<string, false>,
		first: { kind: "parameter" } as Parameter<number, false>,
		after: { kind: "parameter" } as Parameter<string, true>,
	},
	select: {
		id: true,
		customerName: true,
		startsAt: true,
		status: true,
		tenant: { select: { slug: true, name: true } },
	},
	order: [
		{ field: "startsAt", direction: "asc", nulls: "last" },
		{ field: "id", direction: "asc", nulls: "last" },
	],
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
				customerName: string;
				startsAt: Timestamptz;
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
dataQuery<AppointmentDescriptor>()({
	from: "appointments",
	parameters: {},
	// @ts-expect-error every order Field must be selected directly.
	select: { id: true },
	order: [
		{ field: "startsAt", direction: "asc", nulls: "last" },
		{ field: "id", direction: "asc", nulls: "last" },
	],
});

dataQuery<AppointmentDescriptor>()({
	// @ts-expect-error from is the exact generated Collection name.
	from: "tenants",
	parameters: {},
	select: { id: true },
	order: [{ field: "id", direction: "asc", nulls: "last" }],
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

interface TextExpression extends ScalarExpression<string, false> {}
declare const customerName: TextExpression;
// @ts-expect-error Text range comparison is outside the v1 operator matrix.
customerName.lessThan("M");
