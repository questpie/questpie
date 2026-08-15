import {
	createCursorCodecV2,
	type CursorOrderTerm,
	type CursorScalar,
	type UsedExecutionFacts,
} from "./cursor";

export type {
	CursorOrderTerm,
	CursorScalar,
	UsedExecutionFacts,
} from "./cursor";

export type DataCursorDiagnosticCode =
	| "QP-DATA-010"
	| "QP-DATA-011"
	| "QP-DATA-013";

export class DataCursorBindingError extends Error {
	readonly blocking = "none" as const;
	readonly phase = "bind" as const;
	readonly diagnosticClass:
		| "cursorScopeMismatch"
		| "cursorTemplateMismatch"
		| "invalidCursor";

	constructor(readonly code: DataCursorDiagnosticCode) {
		const diagnosticClass =
			code === "QP-DATA-010"
				? "invalidCursor"
				: code === "QP-DATA-011"
					? "cursorTemplateMismatch"
					: "cursorScopeMismatch";
		super(diagnosticClass);
		this.name = "DataCursorBindingError";
		this.diagnosticClass = diagnosticClass;
	}
}

export function createCursorBindingV2(
	input: Readonly<{
		templateDigest: string;
		scopeDigest: string;
		policyProgramDigest: string;
		usedExecutionFacts: UsedExecutionFacts;
		order: readonly CursorOrderTerm[];
	}>,
): Readonly<{
	policyScopeBytes: string;
	policyScopeDigest: string;
	encode(values: readonly CursorScalar[]): string;
	execute<Result>(
		after: string | null,
		adapter: (boundary: readonly CursorScalar[] | null) => Result,
	): Result;
}> {
	const codec = createCursorCodecV2(input);
	return Object.freeze({
		policyScopeBytes: codec.policyScopeBytes,
		policyScopeDigest: codec.policyScopeDigest,
		encode: codec.encode,
		execute: <Result>(
			after: string | null,
			adapter: (boundary: readonly CursorScalar[] | null) => Result,
		): Result => {
			if (after === null) return adapter(null);
			const decoded = codec.decode(after);
			if ("kind" in decoded) {
				if (decoded.kind === "templateMismatch")
					throw new DataCursorBindingError("QP-DATA-011");
				if (decoded.kind === "scopeMismatch")
					throw new DataCursorBindingError("QP-DATA-013");
				throw new DataCursorBindingError("QP-DATA-010");
			}
			return adapter(decoded);
		},
	});
}
