declare const booleanExpressionBrand: unique symbol;

export interface BooleanExpression {
	readonly kind: "booleanExpression";
	readonly [booleanExpressionBrand]: true;
}

export interface PolicyOperand<Value> {
	equal(
		value:
			| Exclude<Value, null | undefined>
			| PolicyOperand<Exclude<Value, null | undefined>>,
	): BooleanExpression;
	notEqual(
		value:
			| Exclude<Value, null | undefined>
			| PolicyOperand<Exclude<Value, null | undefined>>,
	): BooleanExpression;
	in(values: readonly Exclude<Value, null | undefined>[]): BooleanExpression;
	isNull(): BooleanExpression;
}

export interface PrincipalOperands {
	readonly id: PolicyOperand<string>;
	readonly kind: PolicyOperand<"anonymous" | "service" | "user">;
}

export interface TenantOperands {
	readonly id: PolicyOperand<string>;
}

export interface AuthorityOperands {
	isOrdinary(): BooleanExpression;
	isSystem(): BooleanExpression;
}

export interface ExecutionOperands {
	readonly principal: PrincipalOperands;
	readonly tenant: TenantOperands;
	readonly authority: AuthorityOperands;
}

export function booleanExpression(
	operator: string,
	operands: readonly unknown[] = [],
): BooleanExpression {
	return Object.freeze({
		kind: "booleanExpression",
		operator,
		operands: Object.freeze([...operands]),
	}) as unknown as BooleanExpression;
}
