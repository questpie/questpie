import { expect, test } from "bun:test";

import {
	createCursorBindingV2,
	DataCursorBindingError,
} from "../../packages/runtime/src";

const templateDigest = "a".repeat(64);
const scopeDigest = "b".repeat(64);
const policyProgramDigest = "c".repeat(64);
const policyScopeBytes =
	'{"format":"questpie.policy-cursor-scope","policyProgramDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","usedExecutionFacts":{"principalId":"principal-é-😀","tenantId":"tenant-north"},"version":1}\n';
const policyScopeDigest =
	"3901f0e9f6b806f8ebdfdd7d89bf3dec303f89bd1a3e38c555e0291dd6adff33";
const cursorBytes =
	'{"format":"questpie.data-cursor","order":[{"field":"collection:messages/field:body","value":"é-😀"},{"field":"collection:messages/field:sequence","value":42}],"policyScopeDigest":"3901f0e9f6b806f8ebdfdd7d89bf3dec303f89bd1a3e38c555e0291dd6adff33","scopeDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","templateDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","version":2}\n';
const encodedCursor =
	"eyJmb3JtYXQiOiJxdWVzdHBpZS5kYXRhLWN1cnNvciIsIm9yZGVyIjpbeyJmaWVsZCI6ImNvbGxlY3Rpb246bWVzc2FnZXMvZmllbGQ6Ym9keSIsInZhbHVlIjoiw6kt8J-YgCJ9LHsiZmllbGQiOiJjb2xsZWN0aW9uOm1lc3NhZ2VzL2ZpZWxkOnNlcXVlbmNlIiwidmFsdWUiOjQyfV0sInBvbGljeVNjb3BlRGlnZXN0IjoiMzkwMWYwZTlmNmI4MDZmOGViZGZkZDdkODliZjNkZWMzMDNmODliZDFhM2UzOGM1NTVlMDI5MWRkNmFkZmYzMyIsInNjb3BlRGlnZXN0IjoiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYiIsInRlbXBsYXRlRGlnZXN0IjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYSIsInZlcnNpb24iOjJ9Cg";

function binding(overrides: Record<string, unknown> = {}) {
	return createCursorBindingV2({
		templateDigest,
		scopeDigest,
		policyProgramDigest,
		usedExecutionFacts: {
			principalId: "principal-é-😀",
			tenantId: "tenant-north",
		},
		order: [
			{
				field: "collection:messages/field:body",
				codec: "text",
				nullable: false,
			},
			{
				field: "collection:messages/field:sequence",
				codec: "integer",
				nullable: false,
			},
		],
		...overrides,
	} as Parameters<typeof createCursorBindingV2>[0]);
}

function token(bytes: string): string {
	return Buffer.from(bytes).toString("base64url");
}

function expectDiagnostic(
	operation: () => unknown,
	code: "QP-DATA-010" | "QP-DATA-011" | "QP-DATA-013",
): void {
	try {
		operation();
		expect.unreachable("cursor binding should fail");
	} catch (error) {
		expect(error).toBeInstanceOf(DataCursorBindingError);
		expect(error).toMatchObject({
			blocking: "none",
			code,
			phase: "bind",
		});
	}
}

test("encodes exact sparse Policy scope and DataCursorV2 authority vectors", () => {
	const cursor = binding();
	expect(cursor.policyScopeBytes).toBe(policyScopeBytes);
	expect(cursor.policyScopeDigest).toBe(policyScopeDigest);
	expect(cursor.encode(["é-😀", 42])).toBe(encodedCursor);
	expect(Buffer.from(encodedCursor, "base64url").toString()).toBe(cursorBytes);

	let adapterCalls = 0;
	const result = cursor.execute(encodedCursor, (boundary) => {
		adapterCalls += 1;
		return boundary;
	});
	expect(adapterCalls).toBe(1);
	expect(result).toEqual(["é-😀", 42]);
});

test("omits unused Execution facts from Policy scope bytes", () => {
	const cursor = binding({
		usedExecutionFacts: { authorityKind: "ordinary" },
	});
	expect(cursor.policyScopeBytes).toBe(
		`{"format":"questpie.policy-cursor-scope","policyProgramDigest":"${policyProgramDigest}","usedExecutionFacts":{"authorityKind":"ordinary"},"version":1}\n`,
	);
	expect(cursor.policyScopeBytes).not.toContain("principalId");
	expect(cursor.policyScopeBytes).not.toContain("tenantId");
	const firstPage = cursor.execute(null, (boundary) => boundary);
	expect(firstPage).toBeNull();
});

test("rejects invalid bytes and shapes as QP-DATA-010 before the adapter", () => {
	const cursor = binding();
	const invalidTokens = [
		`${encodedCursor}=`,
		token(cursorBytes.slice(0, -1)),
		token(cursorBytes.replace('{"format"', '{ "format"')),
		token(cursorBytes.replace('"version":2', '"version":1')),
		token(cursorBytes.replace('"value":42', '"value":-0')),
		token(cursorBytes.replace('"é-😀"', '"\\ud800"')),
		"a".repeat(2_049),
	];
	for (const candidate of invalidTokens) {
		let adapterCalls = 0;
		expectDiagnostic(
			() =>
				cursor.execute(candidate, () => {
					adapterCalls += 1;
				}),
			"QP-DATA-010",
		);
		expect(adapterCalls).toBe(0);
	}
});

test("checks exact shape before template and both scopes before the adapter", () => {
	const wrongShape = token(
		cursorBytes
			.replace('"version":2', '"version":1')
			.replace(templateDigest, "d".repeat(64))
			.replace(scopeDigest, "e".repeat(64)),
	);
	expectDiagnostic(
		() => binding().execute(wrongShape, () => null),
		"QP-DATA-010",
	);

	const wrongTemplate = token(
		cursorBytes.replace(templateDigest, "d".repeat(64)),
	);
	expectDiagnostic(
		() => binding().execute(wrongTemplate, () => null),
		"QP-DATA-011",
	);

	for (const wrongScope of [
		cursorBytes.replace(scopeDigest, "e".repeat(64)),
		cursorBytes.replace(policyScopeDigest, "f".repeat(64)),
	]) {
		let adapterCalls = 0;
		expectDiagnostic(
			() =>
				binding().execute(token(wrongScope), () => {
					adapterCalls += 1;
				}),
			"QP-DATA-013",
		);
		expect(adapterCalls).toBe(0);
	}
});
