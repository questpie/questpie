export type DiscriminatedValue<
	Variants extends Readonly<Record<string, object>>,
> = {
	[Kind in keyof Variants]: Readonly<{ kind: Kind } & Variants[Kind]>;
}[keyof Variants];

export type DiscriminatedCases<
	Value extends Readonly<{ kind: PropertyKey }>,
	Result,
> = {
	[Kind in Value["kind"]]: (
		value: Extract<Value, Readonly<{ kind: Kind }>>,
	) => Result;
};

export function matchDiscriminated<
	Value extends Readonly<{ kind: PropertyKey }>,
	Result,
>(value: Value, cases: DiscriminatedCases<Value, Result>): Result {
	const select = cases as Readonly<
		Record<PropertyKey, (candidate: Value) => Result>
	>;
	return select[value.kind]!(value);
}
