import { canonicalBytes } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";

type RecordValue = Readonly<Record<string, unknown>>;

const orderedKinds = new Set([
	"bigint",
	"date",
	"integer",
	"numeric",
	"text",
	"timestamp",
]);

function invalid(label: string, requirement: string): never {
	throw new CompilerDiagnosticError(
		"QP-SCHEMA-001",
		"invalidDefinition",
		`${label} ${requirement}`,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		invalid(label, "must be an object");
	return value as RecordValue;
}

function exactKeys(
	value: RecordValue,
	allowed: readonly string[],
	label: string,
): void {
	const unexpected = Object.keys(value)
		.filter((key) => !allowed.includes(key))
		.sort();
	if (unexpected.length > 0)
		invalid(label, `has unsupported member ${unexpected[0]}`);
}

function localFieldPath(value: unknown, label: string): readonly string[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((segment) => typeof segment !== "string")
	)
		invalid(label, "must contain one non-empty Field path");
	return Object.freeze([...(value as readonly string[])]);
}

export function localCheckContract(
	value: unknown,
	label: string,
	depth = 0,
	ancestors: ReadonlySet<object> = new Set(),
): RecordValue {
	if (depth > 32) invalid(label, "exceeds the check expression depth limit");
	const expression = record(value, label);
	if (ancestors.has(expression)) invalid(label, "cannot be cyclic");
	const nextAncestors = new Set(ancestors).add(expression);
	if (expression.kind === "field") {
		exactKeys(expression, ["field", "kind"], label);
		return {
			kind: "field",
			field: localFieldPath(expression.field, `${label}.field`),
		};
	}
	if (expression.kind === "compare") {
		exactKeys(expression, ["kind", "left", "operator", "right"], label);
		if (expression.operator !== "greaterThan")
			invalid(
				label,
				`has unsupported check comparison ${String(expression.operator)}`,
			);
		return {
			kind: "compare",
			operator: "greaterThan",
			left: localCheckContract(
				expression.left,
				`${label}.left`,
				depth + 1,
				nextAncestors,
			),
			right: localCheckContract(
				expression.right,
				`${label}.right`,
				depth + 1,
				nextAncestors,
			),
		};
	}
	invalid(label, `has unsupported check expression ${String(expression.kind)}`);
}

function fieldIdentity(
	collectionIdentity: string,
	path: readonly string[],
): string {
	return `${collectionIdentity}/${path.map((segment) => `field:${segment}`).join("/")}`;
}

function bindField(
	constraintIdentity: string,
	collectionIdentity: string,
	expression: RecordValue,
	fields: readonly RecordValue[],
): Readonly<{ expression: RecordValue; type: RecordValue }> {
	const path = expression.field as readonly string[];
	const identity = fieldIdentity(collectionIdentity, path);
	const field = fields.find((candidate) => candidate.identity === identity);
	if (!field)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-003",
			"invalidReference",
			`${constraintIdentity} references unknown ${identity}`,
		);
	return {
		expression: { kind: "field", field: identity },
		type: record(field.type, `${identity}.type`),
	};
}

export function projectCheckExpression(
	constraintIdentity: string,
	collectionIdentity: string,
	value: RecordValue,
	fields: readonly RecordValue[],
): RecordValue {
	if (value.kind === "field")
		return bindField(constraintIdentity, collectionIdentity, value, fields)
			.expression;
	if (value.kind !== "compare")
		return invalid(
			constraintIdentity,
			`has unsupported check expression ${String(value.kind)}`,
		);
	const left = bindField(
		constraintIdentity,
		collectionIdentity,
		record(value.left, `${constraintIdentity}.left`),
		fields,
	);
	const right = bindField(
		constraintIdentity,
		collectionIdentity,
		record(value.right, `${constraintIdentity}.right`),
		fields,
	);
	if (
		!orderedKinds.has(String(left.type.kind)) ||
		canonicalBytes(left.type) !== canonicalBytes(right.type)
	)
		invalid(constraintIdentity, "requires compatible ordered Fields");
	return {
		kind: "compare",
		operator: "greaterThan",
		left: left.expression,
		right: right.expression,
	};
}
