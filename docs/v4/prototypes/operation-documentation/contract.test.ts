import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as ts from "typescript";

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
		definition: {
			name: "tickets.close",
			input,
			output,
			policy: {},
			errors: {},
			handler: () => undefined,
			describe: {
				summary: "Close an open ticket",
				description: "Returns the committed ticket state.",
				examples: [{ input: { id }, output: { id, status: "closed" } }],
			},
		},
		...overrides,
	};
}

function described(
	describe: Readonly<Record<string, unknown>> | undefined,
	overrides: Partial<OperationDocumentationSource> = {},
): OperationDocumentationSource {
	const base = source(overrides);
	return {
		...base,
		definition: {
			...base.definition,
			...(describe === undefined ? { describe: undefined } : { describe }),
		},
	};
}

describe("projection-neutral Operation documentation", () => {
	test("admits the member sets authored by both production fixtures", () => {
		const seen = new Map<string, number>();
		const propertyNames = (value: ts.ObjectLiteralExpression): string[] =>
			value.properties.map((property) => {
				if (ts.isSpreadAssignment(property))
					throw new Error("fixture Definition uses an unprovable spread");
				const name = property.name;
				if (!name || (!ts.isIdentifier(name) && !ts.isStringLiteral(name)))
					throw new Error("fixture Definition uses a non-static member name");
				return name.text;
			});
		const check = (
			kind: Parameters<typeof assertClosedOperationMembers>[0],
			value: ts.ObjectLiteralExpression,
			module: string,
		) => {
			assertClosedOperationMembers(
				kind,
				Object.fromEntries(propertyNames(value).map((name) => [name, true])),
				{ module, line: 1, column: 1 },
			);
			seen.set(kind, (seen.get(kind) ?? 0) + 1);
		};
		for (const module of new Bun.Glob(
			"fixtures/{collaboration,team-support-desk}/src/**/*.ts",
		).scanSync(".")) {
			const file = ts.createSourceFile(
				module,
				readFileSync(module, "utf8"),
				ts.ScriptTarget.Latest,
				true,
				ts.ScriptKind.TS,
			);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
					const factory = node.expression.text;
					if (
						factory === "defineQuery" ||
						factory === "defineMutation" ||
						factory === "defineAction"
					) {
						const definition = node.arguments[0];
						if (!definition || !ts.isObjectLiteralExpression(definition))
							throw new Error(
								`${factory} in ${module} is not an object literal`,
							);
						check(
							factory === "defineQuery"
								? "query"
								: factory === "defineMutation"
									? "mutation"
									: "action",
							definition,
							module,
						);
					} else if (factory === "defineCollectionOperations") {
						const body = node.arguments[1];
						if (!body || !ts.isObjectLiteralExpression(body))
							throw new Error(
								`defineCollectionOperations in ${module} is not an object literal`,
							);
						for (const property of body.properties) {
							if (!property.name || !ts.isIdentifier(property.name)) continue;
							const member = property.name.text;
							if (
								!["list", "get", "create", "update", "delete"].includes(member)
							)
								continue;
							if (
								!ts.isPropertyAssignment(property) ||
								!ts.isObjectLiteralExpression(property.initializer)
							)
								throw new Error(
									`Collection ${member} in ${module} is not an object literal`,
								);
							check(
								`collection${member[0]!.toUpperCase()}${member.slice(1)}` as Parameters<
									typeof assertClosedOperationMembers
								>[0],
								property.initializer,
								module,
							);
						}
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(file);
		}
		expect(seen.get("query")).toBeGreaterThan(0);
		expect(seen.get("mutation")).toBeGreaterThan(0);
		expect(seen.get("action")).toBeGreaterThan(0);
		expect(
			[...seen.entries()]
				.filter(([kind]) => kind.startsWith("collection"))
				.reduce((count, [, value]) => count + value, 0),
		).toBeGreaterThan(0);
	});

	test("emits deterministic ASCII-sorted canonical bytes", () => {
		const query = source({
			identity: "query:tickets.detail",
			kind: "query",
			definition: {
				name: "tickets.detail",
				query: {},
				describe: { summary: "Fetch one visible ticket" },
			},
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

	test("uses a domain-separated digest for prose changes", () => {
		const before = compileOperationDocumentation([source()]);
		const after = compileOperationDocumentation([
			described({ summary: "Close a currently open ticket" }),
		]);
		expect(after.digest).not.toBe(before.digest);
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

	test("admits the existing authored members for every Operation kind", () => {
		expect(() =>
			assertClosedOperationMembers(
				"query",
				{ name: "tickets.detail", network: true, query: {}, describe: {} },
				origin,
			),
		).not.toThrow();
		expect(() =>
			assertClosedOperationMembers(
				"mutation",
				{
					name: "tickets.close",
					policy: {},
					errors: {},
					issueMappings: {},
					describe: {},
				},
				origin,
			),
		).not.toThrow();
		expect(() =>
			assertClosedOperationMembers(
				"action",
				{
					name: "reports.export",
					policy: {},
					errors: {},
					limits: {},
					describe: {},
				},
				origin,
			),
		).not.toThrow();
		expect(() =>
			assertClosedOperationMembers(
				"collectionList",
				{ data: {}, describe: {} },
				origin,
			),
		).not.toThrow();
		expect(() =>
			assertClosedOperationMembers(
				"collectionGet",
				{ select: {}, describe: {} },
				origin,
			),
		).not.toThrow();
		expect(() =>
			assertClosedOperationMembers(
				"collectionCreate",
				{
					input: [],
					normalize: () => ({}),
					values: () => ({}),
					errors: {},
					issueMappings: {},
					select: {},
					describe: {},
				},
				origin,
			),
		).not.toThrow();
		expect(() =>
			assertClosedOperationMembers(
				"collectionDelete",
				{ select: {}, describe: {} },
				origin,
			),
		).not.toThrow();
	});

	test("composes closed member admission with artifact compilation", () => {
		expect(() =>
			compileOperationDocumentation([
				described(
					{ summary: "Close an open ticket" },
					{
						definition: {
							...source().definition,
							descriptin: { secret: "do not disclose" },
						},
					},
				),
			]),
		).toThrow("unexpectedOperationMember");
	});

	test("enforces scalar text boundaries including astral scalars", () => {
		expect(() =>
			compileOperationDocumentation([described({ summary: "x".repeat(120) })]),
		).not.toThrow();
		expect(() =>
			compileOperationDocumentation([described({ summary: "x".repeat(121) })]),
		).toThrow("invalidText");
		expect(() =>
			compileOperationDocumentation([described({ summary: "😀".repeat(120) })]),
		).not.toThrow();
		expect(() =>
			compileOperationDocumentation([
				described({
					summary: "Bounded description",
					description: "x".repeat(1024),
				}),
			]),
		).not.toThrow();
		expect(() =>
			compileOperationDocumentation([
				described({
					summary: "Bounded description",
					description: "x".repeat(1025),
				}),
			]),
		).toThrow("invalidText");
	});

	test.each([
		[" leading whitespace", "invalidText"],
		["not NFC: e\u0301", "invalidText"],
		["line\nbreak", "invalidText"],
		["bidi \u202e control", "invalidText"],
	])("rejects invalid summary %s", (summary, reason) => {
		expect(() =>
			compileOperationDocumentation([described({ summary })]),
		).toThrow(reason);
	});

	test("accepts description line feeds but rejects codec-mismatched examples", () => {
		expect(
			compileOperationDocumentation([
				described({
					summary: "Close an open ticket",
					description: "First line.\nSecond line.",
				}),
			]).artifact.operations[0]?.description,
		).toBe("First line.\nSecond line.");
		let mismatch: unknown;
		try {
			compileOperationDocumentation([
				described({
					summary: "Close an open ticket",
					examples: [{ input: { id: "not-a-uuid" } }],
				}),
			]);
		} catch (error) {
			mismatch = error;
		}
		expect(mismatch).toBeInstanceOf(DocumentationDiagnostic);
		expect((mismatch as DocumentationDiagnostic).reason).toBe(
			"exampleCodecMismatch",
		);
		expect(String(mismatch)).not.toContain("not-a-uuid");
	});

	test("does not disclose invalid prose or missing example data", () => {
		for (const candidate of [
			described({ summary: "private-value\u2028injection" }),
			described({
				summary: "Close an open ticket",
				examples: [{} as never],
			}),
		]) {
			let diagnostic: unknown;
			try {
				compileOperationDocumentation([candidate]);
			} catch (error) {
				diagnostic = error;
			}
			expect(diagnostic).toBeInstanceOf(DocumentationDiagnostic);
			expect(String(diagnostic)).not.toContain("private-value");
		}
	});

	test("forbids Runtime-minted cursor examples and bounds canonical bytes", () => {
		expect(() =>
			compileOperationDocumentation([
				described(
					{
						summary: "Page visible tickets",
						examples: [{ input: { after: "opaque" } }],
					},
					{
						input: {
							kind: "object",
							properties: { after: { kind: "cursor" } },
						},
					},
				),
			]),
		).toThrow("runtimeMintedExample");
		expect(
			compileOperationDocumentation([
				described(
					{
						summary: "Start the first visible page",
						examples: [{ input: {} }],
					},
					{
						input: {
							kind: "object",
							properties: {
								after: { kind: "optional", codec: { kind: "cursor" } },
							},
						},
					},
				),
			]).artifact.operations[0]?.examples,
		).toEqual([{ input: {} }]);
		expect(() =>
			compileOperationDocumentation([
				described(
					{
						summary: "Document a bounded value",
						examples: [{ input: { value: "x".repeat(5000) } }],
					},
					{
						input: { kind: "object", properties: { value: { kind: "text" } } },
					},
				),
			]),
		).toThrow("exampleLimitExceeded");
	});

	test("omits absent descriptions without mutating semantic Operations", () => {
		const result = compileOperationDocumentation([described(undefined)]);
		expect(result.artifact.operations).toEqual([]);
	});
});
