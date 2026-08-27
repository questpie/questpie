import { booleanExpression, type BooleanExpression } from "./model";
import type { PolicyCollection, PolicyRow, PolicyScope } from "./policy";

type EvidenceScope<Collection extends PolicyCollection> = PolicyScope & Readonly<{
	row: PolicyRow<Collection["fields"]>;
}>;

export const expr = Object.freeze({
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
	never: (): BooleanExpression =>
		booleanExpression("not", [booleanExpression("always")]),
	exists: <const Collection extends PolicyCollection>(
		collection: Collection,
		predicate: (scope: EvidenceScope<NoInfer<Collection>>) => BooleanExpression,
	): BooleanExpression => booleanExpression("exists", [collection, predicate]),
});
