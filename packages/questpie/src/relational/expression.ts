import {
	booleanExpression,
	type BooleanExpression,
	type PolicyBooleanExpression,
} from "./model";
import type { PolicyCollection, PolicyRow, PolicyScope } from "./policy";

type EvidenceScope<Collection extends PolicyCollection> = PolicyScope &
	Readonly<{
		row: PolicyRow<Collection["fields"]>;
	}>;

type EvidenceOf<Expression> =
	Expression extends BooleanExpression<infer Evidence> ? Evidence : false;
type CombinedEvidence<Items extends readonly PolicyBooleanExpression[]> =
	true extends EvidenceOf<Items[number]> ? true : false;

function combine<const Items extends readonly PolicyBooleanExpression[]>(
	operator: "and" | "or",
	items: Items,
): BooleanExpression<CombinedEvidence<Items>> {
	return booleanExpression(operator, items) as BooleanExpression<
		CombinedEvidence<Items>
	>;
}

export const expr = Object.freeze({
	and: <
		const Items extends readonly [
			PolicyBooleanExpression,
			PolicyBooleanExpression,
			...PolicyBooleanExpression[],
		],
	>(
		...items: Items
	): BooleanExpression<CombinedEvidence<Items>> => combine("and", items),
	or: <
		const Items extends readonly [
			PolicyBooleanExpression,
			PolicyBooleanExpression,
			...PolicyBooleanExpression[],
		],
	>(
		...items: Items
	): BooleanExpression<CombinedEvidence<Items>> => combine("or", items),
	not: <Evidence extends boolean>(
		expression: BooleanExpression<Evidence>,
	): BooleanExpression<Evidence> =>
		booleanExpression("not", [expression]) as BooleanExpression<Evidence>,
	always: (): BooleanExpression => booleanExpression("always"),
	never: (): BooleanExpression =>
		booleanExpression("not", [booleanExpression("always")]),
	exists: <const Collection extends PolicyCollection>(
		collection: Collection,
		predicate: (
			scope: EvidenceScope<NoInfer<Collection>>,
		) => PolicyBooleanExpression,
	): BooleanExpression<true> =>
		booleanExpression("exists", [
			collection,
			predicate,
		]) as unknown as BooleanExpression<true>,
});
