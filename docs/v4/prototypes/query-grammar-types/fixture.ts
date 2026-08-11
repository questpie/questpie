// Throwaway type proof for docs/v4/data-model-and-query-grammar.md.

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends <
		Value,
	>() => Value extends Right ? 1 : 2
		? true
		: false;

type Expect<Value extends true> = Value;

type Simplify<Value> = { [Key in keyof Value]: Value[Key] };

interface Field<Value, Nullable extends boolean, HasDefault extends boolean> {
	readonly __value: Value;
	readonly __nullable: Nullable;
	readonly __hasDefault: HasDefault;
}

type FieldValue<Definition> =
	Definition extends Field<infer Value, infer Nullable, boolean>
		? Nullable extends true
			? Value | null
			: Value
		: never;

type RequiredInsertKey<Fields> = {
	[Key in keyof Fields]: Fields[Key] extends Field<
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

interface AppointmentFields {
	readonly id: Field<string, false, true>;
	readonly tenantId: Field<string, false, false>;
	readonly customerName: Field<string, false, false>;
	readonly notes: Field<string, true, false>;
	readonly startsAt: Field<string, false, false>;
	readonly endsAt: Field<string, false, false>;
	readonly status: Field<string, false, true>;
}

interface TenantFields {
	readonly id: Field<string, false, true>;
	readonly slug: Field<string, false, false>;
	readonly name: Field<string, false, false>;
}

type AppointmentRow = ReadRow<AppointmentFields>;
type AppointmentInsert = InsertRow<AppointmentFields>;
type AppointmentUpdate = UpdateRow<AppointmentFields>;

type ExpectedAppointmentRow = {
	id: string;
	tenantId: string;
	customerName: string;
	notes: string | null;
	startsAt: string;
	endsAt: string;
	status: string;
};

type ExpectedAppointmentInsert = {
	tenantId: string;
	customerName: string;
	startsAt: string;
	endsAt: string;
} & {
	id?: string;
	notes?: string | null;
	status?: string;
};

type ExpectedAppointmentUpdate = {
	id?: string;
	tenantId?: string;
	customerName?: string;
	notes?: string | null;
	startsAt?: string;
	endsAt?: string;
	status?: string;
};

type _readRow = Expect<Equal<AppointmentRow, ExpectedAppointmentRow>>;
type _insertRow = Expect<Equal<AppointmentInsert, ExpectedAppointmentInsert>>;
type _updateRow = Expect<Equal<AppointmentUpdate, ExpectedAppointmentUpdate>>;

type FieldSelection<Fields> = {
	readonly [Key in keyof Fields]?: true;
};

interface TenantSelection extends FieldSelection<TenantFields> {}

interface AppointmentSelection extends FieldSelection<AppointmentFields> {
	readonly tenant?: { readonly select: TenantSelection };
}

type SelectedFields<Fields, Selection> = {
	-readonly [Key in keyof Selection as Key extends keyof Fields
		? Selection[Key] extends true
			? Key
			: never
		: never]: Key extends keyof Fields ? FieldValue<Fields[Key]> : never;
};

type SelectedTenant<Selection extends TenantSelection> = SelectedFields<
	TenantFields,
	Selection
>;

type SelectedAppointment<Selection extends AppointmentSelection> = Simplify<
	SelectedFields<AppointmentFields, Selection> &
		(Selection extends {
			readonly tenant: {
				readonly select: infer Tenant extends TenantSelection;
			};
		}
			? { tenant: SelectedTenant<Tenant> | null }
			: object)
>;

interface Parameter<Value, Nullable extends boolean> {
	readonly __value: Value;
	readonly __nullable: Nullable;
}

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
	readonly direction: "ascending" | "descending";
	readonly nulls: "first" | "last";
}

declare function defineAppointmentQuery<
	const Parameters extends Record<string, Parameter<unknown, boolean>>,
	const Selection extends AppointmentSelection,
>(definition: {
	readonly parameters: Parameters;
	readonly select: Selection;
	readonly order: readonly [OrderTerm<"startsAt">, OrderTerm<"id">];
}): DataQueryContract<
	ParameterValues<Parameters>,
	SelectedAppointment<Selection>
>;

const appointmentPage = defineAppointmentQuery({
	parameters: {
		tenantId: {} as Parameter<string, false>,
		first: {} as Parameter<number, false>,
		after: {} as Parameter<string, true>,
	},
	select: {
		id: true,
		customerName: true,
		startsAt: true,
		tenant: { select: { slug: true, name: true } },
	},
	order: [
		{ field: "startsAt", direction: "ascending", nulls: "last" },
		{ field: "id", direction: "ascending", nulls: "last" },
	],
});

type ExpectedParameters = {
	tenantId: string;
	first: number;
	after: string | null;
};

type ExpectedNode = {
	id: string;
	customerName: string;
	startsAt: string;
	tenant: { slug: string; name: string } | null;
};

type ExpectedResult = {
	nodes: ExpectedNode[];
	pageInfo: PageInfo;
};

type _parameters = Expect<
	Equal<typeof appointmentPage.parameters, ExpectedParameters>
>;
type _result = Expect<Equal<typeof appointmentPage.result, ExpectedResult>>;

appointmentPage.bind({
	tenantId: "11111111-1111-4111-8111-111111111111",
	first: 20,
	after: null,
});

// @ts-expect-error UUID parameters do not accept numbers.
appointmentPage.bind({ tenantId: 42, first: 20, after: null });

interface TextExpression {
	equal(value: string): void;
	in(values: readonly string[]): void;
}

declare const customerName: TextExpression;

// @ts-expect-error Text range comparison is outside the v1 operator matrix.
customerName.lessThan("M");
