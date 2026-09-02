import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CompilerDiagnosticError } from "../../packages/compiler/src/diagnostic";
import {
	compileOperationDocumentation,
	type OperationDocumentationSource,
} from "../../packages/compiler/src/operation-documentation";

const origin = Object.freeze({
	module: "src/tickets.ts",
	line: 12,
	column: 3,
});
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
	value: Readonly<Record<string, unknown>> | undefined,
	overrides: Partial<OperationDocumentationSource> = {},
): OperationDocumentationSource {
	const base = source(overrides);
	return {
		...base,
		definition: {
			...base.definition,
			describe: value,
		},
	};
}

function diagnostic(
	run: () => unknown,
	reason: string,
	path: readonly string[],
): void {
	try {
		run();
		throw new Error("expected documentation diagnostic");
	} catch (error) {
		expect(error).toBeInstanceOf(CompilerDiagnosticError);
		const actual = error as CompilerDiagnosticError;
		expect(actual.code).toBe("QP-COMPOSE-030");
		expect(actual.diagnosticClass).toBe("invalidDocumentation");
		expect(actual.details.reason).toBe(reason);
		expect(actual.details.origin).toEqual(origin);
		expect(actual.details.path).toEqual(path);
	}
}

describe("DOC-01 Operation Documentation compiler primitive", () => {
	test("always emits one deterministic relocation-stable artifact and digest", () => {
		const empty = compileOperationDocumentation([]);
		expect(empty.artifact).toEqual({
			format: "questpie.operation-documentation",
			version: 1,
			operations: [],
		});
		expect(empty.bytes.endsWith("\n")).toBe(true);
		expect(empty.digest).toHaveLength(64);
		expect(empty.digest).not.toBe(
			createHash("sha256").update(empty.bytes).digest("hex"),
		);

		const query = source({
			identity: "query:tickets.detail",
			kind: "query",
			definition: {
				name: "tickets.detail",
				query: {},
				describe: { summary: "Fetch one visible ticket" },
			},
		});
		const first = compileOperationDocumentation([source(), query]);
		const reversed = compileOperationDocumentation([query, source()]);
		const relocated = compileOperationDocumentation([
			source({
				origin: { module: "src/support/tickets.ts", line: 91, column: 7 },
			}),
			query,
		]);
		expect(first).toEqual(reversed);
		expect(first).toEqual(relocated);
		expect(first.artifact.operations.map(({ identity }) => identity)).toEqual([
			"mutation:tickets.close",
			"query:tickets.detail",
		]);
		expect(
			compileOperationDocumentation([
				described({ summary: "Close a currently open ticket" }),
			]).digest,
		).not.toBe(compileOperationDocumentation([source()]).digest);
	});

	test("covers Query, Mutation, Action, and all five Collection members", () => {
		const kinds = [
			["query", "query:tickets.list", { name: "tickets.list", query: {} }],
			[
				"mutation",
				"mutation:tickets.close",
				{ name: "tickets.close", policy: {}, errors: {}, handler: () => {} },
			],
			[
				"action",
				"action:reports.export",
				{
					name: "reports.export",
					policy: {},
					errors: {},
					limits: {},
					handler: () => {},
				},
			],
			["collectionList", "query:tickets.list", { data: {} }],
			["collectionGet", "query:tickets.get", { select: {} }],
			[
				"collectionCreate",
				"mutation:tickets.create",
				{ input: [], select: {}, errors: {}, issueMappings: {} },
			],
			[
				"collectionUpdate",
				"mutation:tickets.update",
				{ input: [], select: {}, errors: {}, issueMappings: {} },
			],
			["collectionDelete", "mutation:tickets.delete", { select: {} }],
		] as const;
		const compiled = compileOperationDocumentation(
			kinds.map(([kind, identity, definition]) =>
				source({
					kind,
					identity,
					definition: {
						...definition,
						describe: { summary: `Describe ${kind}` },
					},
				}),
			),
		);
		expect(compiled.artifact.operations).toHaveLength(kinds.length);
	});

	test("validates prose and examples without disclosing rejected values", () => {
		diagnostic(
			() => compileOperationDocumentation([described({})]),
			"missingSummary",
			["describe", "summary"],
		);
		diagnostic(
			() =>
				compileOperationDocumentation([
					described({ summary: ` ${"x".repeat(120)}` }),
				]),
			"invalidText",
			["describe", "summary"],
		);
		diagnostic(
			() =>
				compileOperationDocumentation([
					described({ summary: "Close ticket", examples: [{}] }),
				]),
			"missingExampleInput",
			["describe", "examples", "0"],
		);
		try {
			compileOperationDocumentation([
				described({
					summary: "Close ticket",
					examples: [{ input: { secretTicketId: "do-not-disclose" } }],
				}),
			]);
			throw new Error("expected documentation diagnostic");
		} catch (error) {
			expect(error).toBeInstanceOf(CompilerDiagnosticError);
			expect(String(error)).not.toContain("do-not-disclose");
			expect(
				JSON.stringify((error as CompilerDiagnosticError).details),
			).not.toContain("do-not-disclose");
		}
		diagnostic(
			() =>
				compileOperationDocumentation([
					described({
						summary: "Close ticket",
						examples: [{ input: { id }, output: { id, status: 42 } }],
					}),
				]),
			"exampleCodecMismatch",
			["describe", "examples", "0", "output"],
		);
	});

	test("rejects runtime-minted cursors, unknown members, and oversized examples", () => {
		diagnostic(
			() =>
				compileOperationDocumentation([
					source({
						identity: "query:tickets.page",
						kind: "query",
						input: { kind: "cursor" },
						definition: {
							name: "tickets.page",
							query: {},
							describe: {
								summary: "Page tickets",
								examples: [{ input: "runtime-cursor" }],
							},
						},
					}),
				]),
			"runtimeMintedExample",
			["describe", "examples", "0", "input"],
		);
		diagnostic(
			() =>
				compileOperationDocumentation([
					described(
						{ summary: "Close ticket" },
						{ definition: { ...source().definition, descriptin: "typo" } },
					),
				]),
			"unexpectedOperationMember",
			["mutation:tickets.close", "descriptin"],
		);
		diagnostic(
			() =>
				compileOperationDocumentation([
					source({
						input: { kind: "object", properties: { body: { kind: "text" } } },
						definition: {
							...source().definition,
							describe: {
								summary: "Close ticket",
								examples: [{ input: { body: "x".repeat(4_097) } }],
							},
						},
					}),
				]),
			"exampleLimitExceeded",
			["describe", "examples"],
		);
	});

	test("rejects authored compiler metadata and keeps one public mutation seam", () => {
		diagnostic(
			() =>
				compileOperationDocumentation([
					described(
						{ summary: "Close ticket" },
						{ definition: { ...source().definition, __questpie: {} } },
					),
				]),
			"unexpectedOperationMember",
			["mutation:tickets.close", "__questpie"],
		);
		diagnostic(
			() =>
				compileOperationDocumentation([
					source({
						identity: "action:tickets.close",
						kind: "action",
						definition: {
							name: "tickets.close",
							policy: {},
							errors: {},
							limits: {},
							handler: () => undefined,
							describe: { summary: "Close ticket" },
							executableSlots: ["handler"],
						},
					}),
				]),
			"unexpectedOperationMember",
			["action:tickets.close", "executableSlots"],
		);

		const implementation = readFileSync(
			resolve(
				import.meta.dir,
				"../../packages/compiler/src/operation-documentation.ts",
			),
			"utf8",
		);
		expect(implementation).toContain('from "./mutation"');
		expect(implementation).not.toContain(
			'from "./mutation/operation-write-resource"',
		);
		expect(implementation).not.toContain("invalidOperationDocumentation");
	});
});
