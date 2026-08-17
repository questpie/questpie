import { compareAscii } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`${label} must be an object`,
		);
	return value as RecordValue;
}

/**
 * P3's exact `operation.error({ code, status, payload? })` grammar. Mutation and
 * Reaction share one normalizer so a declared Reaction error cannot drift from
 * the accepted Operation error shape.
 */
export function normalizeDeclaredErrors(
	value: unknown,
	label: string,
	normalizeCodec: (value: unknown) => unknown,
): RecordValue {
	const errors = record(value ?? {}, `${label}.errors`);
	return Object.fromEntries(
		Object.entries(errors)
			.sort(([left], [right]) => compareAscii(left, right))
			.map(([key, candidate]) => {
				const definition = record(candidate, `${label}.errors.${key}`);
				if (definition.kind !== "operationError")
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-013",
						"structuralTypeError",
						`${label}.errors.${key} is not an Operation Error`,
					);
				const status = definition.status;
				if (
					typeof status !== "number" ||
					!Number.isInteger(status) ||
					status < 400 ||
					status > 599
				)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-013",
						"structuralTypeError",
						`${label}.errors.${key}.status is invalid`,
					);
				if (typeof definition.code !== "string" || definition.code.length === 0)
					throw new CompilerDiagnosticError(
						"QP-COMPOSE-013",
						"structuralTypeError",
						`${label}.errors.${key}.code is invalid`,
					);
				return [
					key,
					{
						code: definition.code,
						status,
						payload:
							definition.payload === null
								? null
								: normalizeCodec(definition.payload),
					},
				];
			}),
	);
}
