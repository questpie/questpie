import { expect, test } from "bun:test";

import { projectExecutionComposition } from "../../packages/compiler/src/composition";
import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import type { NormalizedResource } from "../../packages/compiler/src/types";

function serviceResource(
	name: string,
	dependencies: readonly Readonly<{ key: string; identity: string }>[],
	options: Readonly<{
		lifetime?: "application" | "execution";
		effect?: "read" | "external";
	}> = {},
): NormalizedResource {
	return {
		identity: `service:${name}`,
		kind: "service",
		name,
		contract: {
			lifetime: options.lifetime ?? "execution",
			effect: options.effect ?? "read",
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

test("rejects invalid Service lifetime and effect edges", () => {
	expect(() =>
		projectExecutionComposition([
			serviceResource("execution", []),
			serviceResource(
				"application",
				[{ key: "execution", identity: "service:execution" }],
				{ lifetime: "application" },
			),
		]),
	).toThrow("application lifetime cannot depend");
	expect(() =>
		projectExecutionComposition([
			serviceResource("external", [], { effect: "external" }),
			serviceResource("read", [
				{ key: "external", identity: "service:external" },
			]),
		]),
	).toThrow("read effect cannot depend");
});

test("rejects a Service dependency cycle deterministically", () => {
	expect(() =>
		projectExecutionComposition([
			serviceResource("alpha", [{ key: "beta", identity: "service:beta" }]),
			serviceResource("beta", [{ key: "alpha", identity: "service:alpha" }]),
		]),
	).toThrow("Service dependency cycle includes service:alpha");
});
