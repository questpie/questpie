import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import { normalizePolicyPrograms } from "./normalize-policy";
import type {
	CollectionIdentity,
	PolicyExpressionV1,
	PolicyOperandV1,
	PolicyProgramV1,
} from "./types";

type RecordValue = Readonly<Record<string, unknown>>;

export interface PolicyScopeBindingV1 {
	readonly scope: string;
	readonly collection: CollectionIdentity;
	readonly parentScope: string | null;
}

export interface BoundPolicyProgramV1 {
	readonly program: PolicyProgramV1;
	readonly scopes: readonly PolicyScopeBindingV1[];
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`${label} must be an object`,
		);
	return value as RecordValue;
}

function scopeBinding(value: unknown): PolicyScopeBindingV1 {
	const input = record(value, "Policy scope binding");
	if (
		typeof input.scope !== "string" ||
		typeof input.collection !== "string" ||
		(input.parentScope !== null && typeof input.parentScope !== "string")
	)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Policy scope binding has an invalid shape",
		);
	return {
		scope: input.scope,
		collection: input.collection as CollectionIdentity,
		parentScope: input.parentScope,
	};
}

function expressions(program: PolicyProgramV1): readonly PolicyExpressionV1[] {
	const result: PolicyExpressionV1[] = [];
	for (const operation of Object.values(program.operations))
		for (const key of ["rows", "current", "candidate"] as const) {
			const candidate = operation?.[key];
			if (candidate && candidate.kind !== "sameRelationalScopeAsRead")
				result.push(candidate);
		}
	for (const rule of program.fields?.selectedOutput ?? [])
		result.push(rule.when);
	for (const rules of [
		program.fields?.callerInput.create ?? [],
		program.fields?.callerInput.update ?? [],
	])
		for (const rule of rules) result.push(rule.when);
	return result;
}

function validateScopes(
	program: PolicyProgramV1,
	scopes: readonly PolicyScopeBindingV1[],
): void {
	const byName = new Map<string, PolicyScopeBindingV1>();
	for (const binding of scopes) {
		if (byName.has(binding.scope))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`Policy ${program.identity} has duplicate lexical scope ${binding.scope}`,
			);
		byName.set(binding.scope, binding);
	}
	const root = byName.get("row");
	if (!root || root.collection !== program.target || root.parentScope !== null)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`Policy ${program.identity} has no exact root scope`,
		);
	for (const binding of scopes) {
		if (binding.scope === "row") continue;
		if (!binding.parentScope || !byName.has(binding.parentScope))
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`Policy ${program.identity} scope ${binding.scope} has no lexical parent`,
			);
	}
	const validateOperand = (
		operand: PolicyOperandV1,
		visible: ReadonlySet<string>,
	): void => {
		if (operand.kind !== "field") return;
		const binding = byName.get(operand.scope);
		if (
			!binding ||
			binding.collection !== operand.collection ||
			!visible.has(operand.scope)
		)
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				`Policy ${program.identity} has an out-of-scope Field operand`,
			);
	};
	const validateExpression = (
		expression: PolicyExpressionV1,
		currentScope: string,
		visible: ReadonlySet<string>,
	): void => {
		switch (expression.kind) {
			case "equal":
			case "notEqual":
				validateOperand(expression.left, visible);
				validateOperand(expression.right, visible);
				return;
			case "in":
				validateOperand(expression.operand, visible);
				return;
			case "and":
			case "or":
				for (const item of expression.items)
					validateExpression(item, currentScope, visible);
				return;
			case "not":
				validateExpression(expression.expression, currentScope, visible);
				return;
			case "exists": {
				const binding = byName.get(expression.scope);
				if (
					!binding ||
					binding.collection !== expression.collection ||
					binding.parentScope !== currentScope
				)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-013",
						"structuralTypeError",
						`Policy ${program.identity} has an invalid exists scope`,
					);
				validateExpression(
					expression.predicate,
					expression.scope,
					new Set([...visible, expression.scope]),
				);
				return;
			}
			case "constant":
				return;
		}
	};
	for (const expression of expressions(program))
		validateExpression(expression, "row", new Set(["row"]));
}

export function normalizeBoundPolicy(value: unknown): BoundPolicyProgramV1 {
	const input = record(value, "Policy definition");
	const [program] = normalizePolicyPrograms([input.program]);
	if (!program)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"Policy definition has no program",
		);
	const scopes = (Array.isArray(input.policyScopes) ? input.policyScopes : [])
		.map(scopeBinding)
		.sort((left, right) => compareAscii(left.scope, right.scope));
	validateScopes(program, scopes);
	return { program, scopes };
}
