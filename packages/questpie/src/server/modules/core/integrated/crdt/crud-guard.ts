import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";

function getCrdtFieldPaths(
	fieldDefinitions: Record<string, unknown> | undefined,
): string[] {
	if (!fieldDefinitions) return [];

	return Object.keys(fieldDefinitions)
		.filter((fieldPath) => {
			const field = fieldDefinitions[fieldPath] as Field<FieldState>;
			return field?._state?.crdt !== undefined;
		})
		.sort();
}

export function assertNoCrdtFieldsInOrdinaryMutation(input: {
	ownerName: string;
	fieldDefinitions: Record<string, unknown> | undefined;
	data: Record<string, unknown>;
}): void {
	const mutated = getCrdtFieldPaths(input.fieldDefinitions).filter(
		(fieldPath) => Object.hasOwn(input.data, fieldPath),
	);
	if (mutated.length === 0) return;

	throw new Error(
		`CRDT-managed field "${input.ownerName}.${mutated[0]}" cannot be changed through ordinary CRUD`,
	);
}

export function assertNoCrdtFieldsInVersionRestore(input: {
	ownerName: string;
	fieldDefinitions: Record<string, unknown> | undefined;
}): void {
	if (getCrdtFieldPaths(input.fieldDefinitions).length === 0) return;

	throw new Error(
		`Version restore for "${input.ownerName}" contains CRDT-managed fields`,
	);
}
