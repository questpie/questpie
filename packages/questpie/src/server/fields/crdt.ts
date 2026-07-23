import type { FieldState } from "./field-class-types.js";
import type { Field } from "./field-class.js";

export type CrdtFieldEligibilityIssue =
	| "missing-capability"
	| "invalid-awareness-schema"
	| "unsupported-field-type"
	| "nullable"
	| "missing-empty-default"
	| "localized"
	| "array"
	| "virtual"
	| "input-mode"
	| "output-mode"
	| "hooks"
	| "drizzle-transform"
	| "zod-transform"
	| "from-db-transform"
	| "to-db-transform"
	| "text-refinement"
	| "custom-type"
	| "missing-column";

export function getCrdtFieldEligibilityIssues(
	field: Field<FieldState>,
): CrdtFieldEligibilityIssue[] {
	const state = field._state;
	const issues: CrdtFieldEligibilityIssue[] = [];

	if (state.crdt?.format !== "text") issues.push("missing-capability");
	if (
		state.crdt?.awarenessSchema !== undefined &&
		typeof (state.crdt.awarenessSchema as { safeParse?: unknown }).safeParse !==
			"function"
	) {
		issues.push("invalid-awareness-schema");
	}
	if (state.type !== "textarea") issues.push("unsupported-field-type");
	if (!state.notNull) issues.push("nullable");
	if (!state.hasDefault || state.defaultValue !== "") {
		issues.push("missing-empty-default");
	}
	if (state.localized) issues.push("localized");
	if (state.isArray) issues.push("array");
	if (state.virtual !== false) issues.push("virtual");
	if (state.input !== true) issues.push("input-mode");
	if (state.output !== true) issues.push("output-mode");
	if (state.hooks) issues.push("hooks");
	if (state.drizzleTransform) issues.push("drizzle-transform");
	if (state.zodTransform) issues.push("zod-transform");
	if (state.fromDbFn) issues.push("from-db-transform");
	if (state.toDbFn) issues.push("to-db-transform");
	if (
		state.minLength !== undefined ||
		state.maxLength !== undefined ||
		state.pattern !== undefined ||
		state.trim ||
		state.lowercase ||
		state.uppercase
	) {
		issues.push("text-refinement");
	}
	if (state.customType) issues.push("custom-type");
	if (!state.columnFactory) issues.push("missing-column");

	return issues;
}

export function assertCrdtFieldEligibility(field: Field<FieldState>): void {
	const issues = getCrdtFieldEligibilityIssues(field);
	if (issues.length === 0) return;

	throw new Error(`Invalid QUESTPIE CRDT text field: ${issues.join(", ")}`);
}
