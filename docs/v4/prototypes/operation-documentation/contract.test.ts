import { describe, expect, test } from "bun:test";

import { digest } from "../../../../packages/compiler/src/canonical";
import {
	assertClosedOperationMembers,
	compileOperationDocumentation,
	DocumentationDiagnostic,
	type OperationDocumentationSource,
} from "./contract";

const origin = Object.freeze({ module: "src/tickets.ts", line: 12, column: 3 });
const input = Object.freeze({
	kind: "object" as const,
	properties: Object.freeze({ id: Object.freeze({ kind: "uuid" as const }) }),
});
const output = Object.freeze({
	kind: "object" as const,
	properties: Object.freeze({
		id: Object.freeze({ kind: "uuid" as const }),
		status: Object.freeze({ kind: "text" as const }),
	}),
});
const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";

function source(
	overrides: Partial<OperationDocumentationSource> = {},
): OperationDocumentationSource {
	return {
		identity: "mutation:tickets.close",
		kind: "mutation",
		input,
		output,
		origin,
		describe: {
			summary: "Close an open ticket",
			description: "Returns the committed ticket state.",
			examples: [{ input: { id }, output: { id, status: "closed" } }],
		},
		...overrides,
	};
}

describe("projection-neutral Operation documentation", () => {
	test("emits deterministic ASCII-sorted canonical bytes", () => {
		const query = source({
			identity: "query:tickets.detail",
			kind: "query",
			describe: { summary: "Fetch one visible ticket" },
		});
		const left = compileOperationDocumentation([source(), query]);
		const right = compileOperationDocumentation([query, source()]);
		expect(left).toEqual(right);
		expect(left.bytes.endsWith("\n")).toBe(true);
		expect(left.artifact.operations.map((item) => item.identity)).toEqual([
			"mutation:tickets.close",
			"query:tickets.detail",
		]);
		expect(left.digest).toHaveLength(64);
	});

	test("keeps documentation digest independent of semantic client contract", () => {
		const semantic = {
			identity: source().identity,
			input,
			output,
		};
		const clientDigest = digest("questpie-client-contract-v1", semantic);
		const before = compileOperationDocumentation([source()]);
		const after = compileOperationDocumentation([
			source({ describe: { summary: "Close a currently open ticket" } }),
		]);
		expect(after.digest).not.toBe(before.digest);
		expect(digest("questpie-client-contract-v1", semantic)).toBe(clientDigest);
	});

	test("keeps semantic bytes stable when the Definition relocates", () => {
		const before = compileOperationDocumentation([source()]);
		const after = compileOperationDocumentation([
			source({
				origin: { module: "src/support/tickets.ts", line: 91, column: 7 },
			}),
		]);
		expect(after).toEqual(before);
	});

	test("rejects silently ignored Operation members with Origin and no value", () => {
		try {
			assertClosedOperationMembers(
				"query",
				{ name: "tickets.detail", descriptin: { secret: "do not disclose" } },
				origin,
			);
			throw new Error("expected diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(DocumentationDiagnostic);
			expect((error as DocumentationDiagnostic).code).toBe("QP-COMPOSE-030");
			expect((error as DocumentationDiagnostic).path).toEqual([
				"query:tickets.detail",
				"descriptin",
			]);
			expect(String(error)).not.toContain("secret");
		}
	});

	test.each([
		[" leading whitespace", "invalidText"],
		["not NFC: e\u0301", "invalidText"],
		["line\nbreak", "invalidText"],
		["bidi \u202e control", "invalidText"],
	])("rejects invalid summary %s", (summary, reason) => {
		expect(() =>
			compileOperationDocumentation([source({ describe: { summary } })]),
		).toThrow(reason);
	});

	test("accepts description line feeds but rejects codec-mismatched examples", () => {
		expect(
			compileOperationDocumentation([
				source({
					describe: {
						summary: "Close an open ticket",
						description: "First line.\nSecond line.",
					},
				}),
			]).artifact.operations[0]?.description,
		).toBe("First line.\nSecond line.");
		expect(() =>
			compileOperationDocumentation([
				source({
					describe: {
						summary: "Close an open ticket",
						examples: [{ input: { id: "not-a-uuid" } }],
					},
				}),
			]),
		).toThrow("exampleCodecMismatch");
	});

	test("forbids Runtime-minted cursor examples and bounds canonical bytes", () => {
		expect(() =>
			compileOperationDocumentation([
				source({
					input: { kind: "object", properties: { after: { kind: "cursor" } } },
					describe: {
						summary: "Page visible tickets",
						examples: [{ input: { after: "opaque" } }],
					},
				}),
			]),
		).toThrow("runtimeMintedExample");
		expect(
			compileOperationDocumentation([
				source({
					input: {
						kind: "object",
						properties: {
							after: { kind: "optional", codec: { kind: "cursor" } },
						},
					},
					describe: {
						summary: "Start the first visible page",
						examples: [{ input: {} }],
					},
				}),
			]).artifact.operations[0]?.examples,
		).toEqual([{ input: {} }]);
		expect(() =>
			compileOperationDocumentation([
				source({
					input: { kind: "object", properties: { value: { kind: "text" } } },
					describe: {
						summary: "Document a bounded value",
						examples: [{ input: { value: "x".repeat(5000) } }],
					},
				}),
			]),
		).toThrow("exampleLimitExceeded");
	});

	test("omits absent descriptions without mutating semantic Operations", () => {
		const result = compileOperationDocumentation([
			source({ describe: undefined }),
		]);
		expect(result.artifact.operations).toEqual([]);
	});
});
