import type { FieldNode, InlineShapeDefinition } from "./shape";

export type LocalCheckExpression =
	| Readonly<{ kind: "field"; field: readonly [string, ...string[]] }>
	| Readonly<{
			kind: "compare";
			operator: "greaterThan";
			left: LocalCheckExpression;
			right: LocalCheckExpression;
	  }>;

export interface CheckConstraintDefinition {
	readonly kind: "check";
	readonly expression: LocalCheckExpression;
	readonly postgresName: string | null;
}

type OrderedCheckScalar =
	| "bigint"
	| "date"
	| "integer"
	| "numeric"
	| "text"
	| "timestamp";

declare const checkFieldScalar: unique symbol;
declare const checkPredicate: unique symbol;

interface CheckFieldExpression<Scalar extends string> {
	readonly [checkFieldScalar]: Scalar;
}

interface OrderedCheckFieldExpression<
	Scalar extends OrderedCheckScalar,
> extends CheckFieldExpression<Scalar> {
	greaterThan(right: OrderedCheckFieldExpression<Scalar>): CheckPredicate;
}

interface CheckPredicate {
	readonly [checkPredicate]: true;
}

type CheckFieldFor<Node extends FieldNode> =
	Node extends Readonly<{
		kind: "field";
		scalar: infer Scalar extends string;
	}>
		? Scalar extends OrderedCheckScalar
			? OrderedCheckFieldExpression<Scalar>
			: CheckFieldExpression<Scalar>
		: Node extends InlineShapeDefinition<infer Fields>
			? CheckFields<Fields>
			: never;

export type CheckFields<Fields extends Readonly<Record<string, FieldNode>>> =
	Readonly<{
		[Key in keyof Fields]: CheckFieldFor<Fields[Key]>;
	}>;

type CheckCallback<Fields extends Readonly<Record<string, FieldNode>>> = (
	context: Readonly<{ fields: CheckFields<Fields> }>,
) => CheckPredicate;

const fieldPaths = new WeakMap<object, readonly [string, ...string[]]>();
const predicates = new WeakMap<object, LocalCheckExpression>();

function frozenField(
	path: readonly [string, ...string[]],
): LocalCheckExpression {
	return Object.freeze({
		kind: "field",
		field: Object.freeze([...path]),
	}) as LocalCheckExpression;
}

function fieldExpression(
	path: readonly string[],
): CheckFieldExpression<string> {
	const target = () => undefined;
	const proxy = new Proxy(target, {
		get(_target, property) {
			if (typeof property !== "string") return undefined;
			return fieldExpression([...path, property]);
		},
		apply(_target, _thisArgument, argumentsList): CheckPredicate {
			const right = argumentsList[0];
			const rightPath =
				right && (typeof right === "object" || typeof right === "function")
					? fieldPaths.get(right)
					: undefined;
			if (path.length < 2 || path.at(-1) !== "greaterThan" || !rightPath)
				throw new TypeError(
					"constraint.check greaterThan requires two Field expressions",
				);
			const leftPath = path.slice(0, -1) as [string, ...string[]];
			const expression: LocalCheckExpression = Object.freeze({
				kind: "compare",
				operator: "greaterThan",
				left: frozenField(leftPath),
				right: frozenField(rightPath),
			});
			const predicate = Object.create(null) as object;
			predicates.set(predicate, expression);
			return predicate as CheckPredicate;
		},
	});
	if (path.length > 0) fieldPaths.set(proxy, path as [string, ...string[]]);
	return proxy as unknown as CheckFieldExpression<string>;
}

export function createCheckConstraint<
	const Fields extends Readonly<Record<string, FieldNode>> = never,
>(
	callback: CheckCallback<NoInfer<Fields>>,
	options: Readonly<{ postgres?: Readonly<{ name: string }> }> = {},
): CheckConstraintDefinition {
	const predicate = callback({
		fields: fieldExpression([]) as CheckFields<NoInfer<Fields>>,
	});
	const expression =
		predicate &&
		(typeof predicate === "object" || typeof predicate === "function")
			? predicates.get(predicate)
			: undefined;
	if (!expression)
		throw new TypeError(
			"constraint.check callback must return a QUESTPIE check expression",
		);
	return Object.freeze({
		kind: "check",
		expression,
		postgresName: options.postgres?.name ?? null,
	});
}
