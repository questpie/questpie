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
	const rootScopes = new Set(["row", "current", "candidate"]);
	for (const binding of scopes) {
		if (rootScopes.has(binding.scope)) {
			if (binding.collection !== program.target || binding.parentScope !== null)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`Policy ${program.identity} has an invalid root scope ${binding.scope}`,
				);
			continue;
		}
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
	const validateFrom = (
		expression:
			| PolicyExpressionV1
			| Readonly<{ kind: "sameRelationalScopeAsRead" }>
			| undefined,
		currentScope: string,
		visibleScopes: readonly string[],
	): void => {
		if (!expression || expression.kind === "sameRelationalScopeAsRead") return;
		for (const scope of visibleScopes) {
			const binding = byName.get(scope);
			if (
				!binding ||
				binding.collection !== program.target ||
				binding.parentScope !== null
			)
				throw new CompilerDiagnosticError(
					"QP-COMPOSE-013",
					"structuralTypeError",
					`Policy ${program.identity} has no exact ${scope} root scope`,
				);
		}
		validateExpression(expression, currentScope, new Set(visibleScopes));
	};
	validateFrom(program.operations.read?.rows, "row", ["row"]);
	validateFrom(program.operations.create?.candidate, "candidate", [
		"candidate",
	]);
	validateFrom(program.operations.update?.current, "current", ["current"]);
	validateFrom(program.operations.update?.candidate, "candidate", [
		"current",
		"candidate",
	]);
	validateFrom(program.operations.delete?.current, "current", ["current"]);
	for (const rule of program.fields?.selectedOutput ?? [])
		validateFrom(rule.when, "row", ["row"]);
	for (const rule of program.fields?.callerInput.create ?? [])
		validateFrom(rule.when, "candidate", ["candidate"]);
	for (const rule of program.fields?.callerInput.update ?? [])
		validateFrom(rule.when, "candidate", ["current", "candidate"]);
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
