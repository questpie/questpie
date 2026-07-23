import type { FieldState } from "./field-class-types.js";
import type { Field } from "./field-class.js";

export type CrdtFieldEligibilityIssue =
	| "missing-capability"
	| "unsupported-format"
	| "unsupported-field-type"
	| "nullable"
	| "missing-empty-default"
	| "localized"
	| "array"
	| "scalar"
	| "virtual"
	| "input-mode"
	| "output-mode"
	| "hooks"
	| "drizzle-transform"
	| "zod-transform"
	| "from-db-transform"
	| "to-db-transform"
	| "text-refinement"
	| "array-refinement"
	| "custom-type"
	| "missing-column";

function hasTextRefinement(state: Field<FieldState>["_state"]): boolean {
	return (
		state.minLength !== undefined ||
		state.maxLength !== undefined ||
		state.pattern !== undefined ||
		state.trim === true ||
		state.lowercase === true ||
		state.uppercase === true
	);
}

function hasEmptyDefault(
	state: Field<FieldState>["_state"],
	format: "text" | "set",
): boolean {
	if (!state.hasDefault) return false;
	if (format === "text") return state.defaultValue === "";
	return Array.isArray(state.defaultValue) && state.defaultValue.length === 0;
}

export function getCrdtFieldEligibilityIssues(
	field: Field<FieldState>,
): CrdtFieldEligibilityIssue[] {
	const state = field._state;
	const capability = state.crdt;
	const format = capability?.format;
	const issues: CrdtFieldEligibilityIssue[] = [];

	if (format === undefined) {
		issues.push("missing-capability");
		return issues;
	}
	if (format !== "text" && format !== "set") {
		issues.push("unsupported-format");
		return issues;
	}

	if (
		format === "text" &&
		!(
			(state.type === "textarea" && state.isArray === false) ||
			(state.type === "text" &&
				state.textStorage === "text" &&
				state.isArray === false)
		)
	) {
		issues.push(state.isArray ? "array" : "unsupported-field-type");
	}
	if (
		format === "set" &&
		!(
			state.type === "text" &&
			state.textStorage === "text" &&
			state.isArray === true &&
			capability?.format === "set" &&
			capability.conflict === "add-wins"
		)
	) {
		issues.push(state.isArray ? "unsupported-field-type" : "scalar");
	}

	if (!state.notNull) issues.push("nullable");
	if (!hasEmptyDefault(state, format)) issues.push("missing-empty-default");
	if (state.localized) issues.push("localized");
	if (state.virtual !== false) issues.push("virtual");
	if (state.input !== true) issues.push("input-mode");
	if (state.output !== true) issues.push("output-mode");
	if (state.hooks) issues.push("hooks");
	if (state.drizzleTransform) issues.push("drizzle-transform");
	if (state.zodTransform) issues.push("zod-transform");
	if (state.fromDbFn) issues.push("from-db-transform");
	if (state.toDbFn) issues.push("to-db-transform");
	if (hasTextRefinement(state)) issues.push("text-refinement");
	if (state.minItems !== undefined || state.maxItems !== undefined) {
		issues.push("array-refinement");
	}
	if (state.customType) issues.push("custom-type");
	if (!state.columnFactory) issues.push("missing-column");

	return issues;
}

export function assertCrdtFieldEligibility(field: Field<FieldState>): void {
	const issues = getCrdtFieldEligibilityIssues(field);
	if (issues.length === 0) return;

	throw new Error(`Invalid QUESTPIE CRDT field: ${issues.join(", ")}`);
}
