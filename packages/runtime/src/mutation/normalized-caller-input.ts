import type { MutationRow } from "./field-path";

type NormalizedCallerInput = Readonly<{
	raw: MutationRow;
	normalized: MutationRow;
}>;

const normalizedCallerInputs = new WeakMap<object, NormalizedCallerInput>();

export function carryNormalizedCallerInput<
	Request extends Readonly<Record<string, unknown>>,
>(request: Request, raw: MutationRow, normalized: MutationRow): Request {
	normalizedCallerInputs.set(request, Object.freeze({ raw, normalized }));
	return request;
}

export function normalizedCallerInput(
	request: Readonly<Record<string, unknown>>,
	raw: MutationRow,
): MutationRow {
	const carried = normalizedCallerInputs.get(request);
	if (!carried) return raw;
	if (carried.raw !== raw)
		throw new TypeError("Collection normalized caller input is invalid");
	return carried.normalized;
}
