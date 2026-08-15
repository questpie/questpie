import { expect, test } from "bun:test";

import { projectExecutionComposition } from "../../packages/compiler/src/composition";
import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import type { NormalizedResource } from "../../packages/compiler/src/types";

function serviceResource(
	name: string,
	dependencies: readonly Readonly<{ key: string; identity: string }>[],
): NormalizedResource {
	return {
		identity: `service:${name}`,
		kind: "service",
		name,
		contract: {
			lifetime: "execution",
			effect: "read",
			dependencies,
			executableSlots: ["create"],
		},
		contributions: [],
		origin: {
			logicalPath: "src/services.ts",
			exportName: name,
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: {},
	};
}

test("reports an unknown Service dependency with the closed diagnostic", () => {
	try {
		projectExecutionComposition([
			serviceResource("messages", [
				{ key: "database", identity: "service:missing" },
			]),
		]);
		expect.unreachable();
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerDiagnosticError);
		expect(error).toMatchObject({
			code: "QP-COMPOSE-004",
			diagnosticClass: "unknownReference",
		});
	}
});
