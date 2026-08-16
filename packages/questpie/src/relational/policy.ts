import type { FieldDefinition } from "../field-contract";
import type { FieldNode, InlineShapeDefinition } from "../shape";
import {
	booleanExpression,
	type BooleanExpression,
	type ExecutionOperands,
	type PolicyOperand,
} from "./model";

type PolicyCollection = Readonly<{
	name: string;
	fields: Readonly<Record<string, FieldNode>>;
}>;

type CollectionFields<Collection> =
	Collection extends Readonly<{
		fields: infer Fields;
	}>
		? Fields
		: never;

type PolicyField<Node> =
	Node extends FieldDefinition<infer Value, infer Nullable>
		? PolicyOperand<Value | (Nullable extends true ? null : never)>
		: Node extends InlineShapeDefinition<infer Fields>
			? PolicyRow<Fields>
			: never;

type PolicyRow<Fields> = {
	readonly [Key in keyof Fields]: PolicyField<Fields[Key]>;
};

type PolicyScope<Collection> = ExecutionOperands & {
	readonly row: PolicyRow<CollectionFields<Collection>>;
};

type PolicyCreateScope<Collection> = ExecutionOperands & {
	readonly candidate: PolicyRow<CollectionFields<Collection>>;
};

type PolicyUpdateScope<Collection> = ExecutionOperands & {
	readonly current: PolicyRow<CollectionFields<Collection>>;
	readonly candidate: PolicyRow<CollectionFields<Collection>>;
};

type PolicyDeleteScope<Collection> = ExecutionOperands & {
	readonly current: PolicyRow<CollectionFields<Collection>>;
};

type FieldDecisionMap<Collection> = Partial<{
	readonly [Key in keyof CollectionFields<Collection>]: BooleanExpression;
}>;

declare const policyTarget: unique symbol;

export interface PolicyRowPredicate<Target extends `collection:${string}`> {
	readonly kind: "policyRows";
	readonly [policyTarget]: Target;
}

type CollectionIdentity<Collection> =
	Collection extends Readonly<{
		name: infer Name extends string;
	}>
		? `collection:${Name}`
		: never;

type PolicyRowRule<Collection> =
	| ((scope: PolicyScope<Collection>) => BooleanExpression)
	| PolicyRowPredicate<CollectionIdentity<Collection>>;

export interface PolicyBody<Collection, Name extends string> {
	readonly name: Name;
	readonly read?: Readonly<{
		admit: BooleanExpression;
		rows: PolicyRowRule<Collection>;
	}>;
	readonly create?: Readonly<{
		admit: BooleanExpression;
		candidate: (scope: PolicyCreateScope<Collection>) => BooleanExpression;
	}>;
	readonly update?: Readonly<{
		admit: BooleanExpression;
		rows: (scope: PolicyDeleteScope<Collection>) => BooleanExpression;
		candidate: (scope: PolicyUpdateScope<Collection>) => BooleanExpression;
	}>;
	readonly delete?: Readonly<{
		admit: BooleanExpression;
		rows: (scope: PolicyDeleteScope<Collection>) => BooleanExpression;
	}>;
	readonly fields?: Readonly<{
		output?: (scope: PolicyScope<Collection>) => FieldDecisionMap<Collection>;
		create?: (
			scope: PolicyCreateScope<Collection>,
		) => FieldDecisionMap<Collection>;
		update?: (
			scope: PolicyUpdateScope<Collection>,
		) => FieldDecisionMap<Collection>;
	}>;
}

export interface PolicyDefinition<
	Name extends string,
	Target extends `collection:${string}`,
> {
	readonly __questpie: Readonly<{
		category: "definition";
		resourceKind: "policy";
	}>;
	readonly kind: "policy";
	readonly name: Name;
	readonly identity: `policy:${Name}`;
	readonly target: Target;
}

export function definePolicy<
	const Collection extends PolicyCollection,
	const Name extends string,
>(
	collection: Collection,
	body: PolicyBody<NoInfer<Collection>, Name>,
): PolicyDefinition<Name, CollectionIdentity<Collection>> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "policy",
		}),
		kind: "policy",
		name: body.name,
		identity: `policy:${body.name}`,
		target: `collection:${collection.name}`,
		body,
	}) as unknown as PolicyDefinition<Name, CollectionIdentity<Collection>>;
}

export const policy = Object.freeze({
	authenticated: (): BooleanExpression => booleanExpression("authenticated"),
	public: (): BooleanExpression => booleanExpression("public"),
	exists: <const Collection extends PolicyCollection>(
		collection: Collection,
		predicate: (scope: PolicyScope<NoInfer<Collection>>) => BooleanExpression,
	): BooleanExpression => booleanExpression("exists", [collection, predicate]),
	rows: <const Collection extends PolicyCollection>(
		collection: Collection,
		predicate: (scope: PolicyScope<NoInfer<Collection>>) => BooleanExpression,
	): PolicyRowPredicate<CollectionIdentity<Collection>> =>
		Object.freeze({
			kind: "policyRows",
			collection,
			predicate,
		}) as unknown as PolicyRowPredicate<CollectionIdentity<Collection>>,
});
