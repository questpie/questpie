import { expect, test } from "bun:test";

import { controlledEvaluationFailure } from "../../packages/compiler/src/diagnostic";

test.each([
	["QP-DATA-008 unsafe detail omitted", "QP-DATA-008", "orderFieldNotSelected"],
	["QP-DATA-026 unsafe detail omitted", "QP-DATA-026", "invalidInverseList"],
] as const)(
	"closes %s without reflecting evaluator details",
	(stderr, code, diagnosticClass) => {
		const diagnostic = controlledEvaluationFailure(stderr);

		expect(diagnostic).toMatchObject({ code, diagnosticClass });
		expect(JSON.stringify(diagnostic)).not.toContain("unsafe detail");
	},
);
