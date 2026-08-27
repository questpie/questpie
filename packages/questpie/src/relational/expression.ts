import {
	booleanExpression,
	type BooleanExpression,
	type PolicyBooleanExpression,
	type PolicyEvidenceExpression,
} from "./model";
import type { PolicyCollection, PolicyRow, PolicyScope } from "./policy";

type EvidenceScope<Collection extends PolicyCollection> = PolicyScope &
	Readonly<{
		row: PolicyRow<Collection["fields"]>;
	}>;

function and(
	first: BooleanExpression,
	second: BooleanExpression,
	...rest: readonly BooleanExpression[]
): BooleanExpression;
function and(
	first: PolicyBooleanExpression,
	second: PolicyBooleanExpression,
	...rest: readonly PolicyBooleanExpression[]
): PolicyBooleanExpression;
function and(
	first: PolicyBooleanExpression,
	second: PolicyBooleanExpression,
	...rest: readonly PolicyBooleanExpression[]
): PolicyBooleanExpression {
	return booleanExpression("and", [first, second, ...rest]);
}

function or(
	first: BooleanExpression,
	second: BooleanExpression,
	...rest: readonly BooleanExpression[]
): BooleanExpression;
function or(
	first: PolicyBooleanExpression,
	second: PolicyBooleanExpression,
	...rest: readonly PolicyBooleanExpression[]
): PolicyBooleanExpression;
function or(
	first: PolicyBooleanExpression,
	second: PolicyBooleanExpression,
	...rest: readonly PolicyBooleanExpression[]
): PolicyBooleanExpression {
	return booleanExpression("or", [first, second, ...rest]);
}

function not(expression: BooleanExpression): BooleanExpression;
function not(expression: PolicyEvidenceExpression): PolicyEvidenceExpression;
function not(expression: PolicyBooleanExpression): PolicyBooleanExpression {
	return booleanExpression("not", [expression]);
}

export const expr = Object.freeze({
	and,
	or,
	not,
	always: (): BooleanExpression => booleanExpression("always"),
	never: (): BooleanExpression =>
		booleanExpression("not", [booleanExpression("always")]),
	exists: <const Collection extends PolicyCollection>(
		collection: Collection,
		predicate: (
			scope: EvidenceScope<NoInfer<Collection>>,
		) => PolicyBooleanExpression,
	): PolicyEvidenceExpression =>
		booleanExpression("exists", [
			collection,
			predicate,
		]) as unknown as PolicyEvidenceExpression,
});
