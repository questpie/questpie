export type DiscriminatedValue<
	Variants extends Readonly<Record<string, object>>,
> = {
	[Kind in keyof Variants & string]: Readonly<{ kind: Kind } & Variants[Kind]>;
}[keyof Variants & string];

export type DiscriminatedReference<
	Targets extends Readonly<Record<string, unknown>>,
> = DiscriminatedValue<{
	[Kind in keyof Targets & string]: { id: Targets[Kind] };
}>;

type KindOf<Value extends Readonly<{ kind: string }>> = Value["kind"];

export type DiscriminatedCases<Value extends Readonly<{ kind: string }>> = {
	[Kind in KindOf<Value>]: (
		value: Extract<Value, Readonly<{ kind: Kind }>>,
	) => unknown;
};

type ExactCases<
	Value extends Readonly<{ kind: string }>,
	Cases extends DiscriminatedCases<Value>,
> = Cases & Record<Exclude<keyof Cases, KindOf<Value>>, never>;

type CaseResult<Cases> = ReturnType<
	Cases[keyof Cases] extends (...arguments_: never[]) => unknown
		? Cases[keyof Cases]
		: never
>;

export function matchDiscriminated<
	Value extends Readonly<{ kind: string }>,
	const Cases extends DiscriminatedCases<Value>,
>(value: Value, cases: ExactCases<Value, Cases>): CaseResult<Cases> {
	if (!Object.hasOwn(cases, value.kind))
		throw new TypeError("invalid discriminated value");
	const branch = (cases as Readonly<Record<string, unknown>>)[value.kind];
	if (typeof branch !== "function")
		throw new TypeError("invalid discriminated value");
	return branch(value) as CaseResult<Cases>;
}
