import { expect, test } from "bun:test";

import { codec } from "questpie";

import { projectExecutionComposition } from "../../packages/compiler/src/composition";
import { validateOperationHttpAuthoring } from "../../packages/compiler/src/http";

const origin = Object.freeze({
	logicalPath: "src/messages.ts",
	exportName: "messagesPage",
	packageId: null,
	span: null,
	memberSpans: {},
});

function query(input: unknown) {
	return {
		identity: "query:messages.page",
		kind: "query",
		name: "messages.page",
		contract: { exposure: "network", input },
		contributions: [],
		origin,
		value: {},
	};
}

function route(path: string) {
	return {
		identity: `route:${path}`,
		kind: "route",
		name: "collision",
		contract: { method: "GET", path },
		contributions: [],
		origin: { ...origin, exportName: "rawRoute" },
		value: {},
	};
}

test("binds canonical HTTP diagnostics for unsupported Query input and authored HTTP", () => {
	expect(() =>
		projectExecutionComposition([
			query({
				kind: "object",
				properties: { search: { kind: "text" } },
			}),
		] as never),
	).toThrow(
		expect.objectContaining({
			code: "QP-COMPOSE-028",
			diagnosticClass: "invalidHttpProjection",
			details: expect.objectContaining({
				reason: "queryHttpEncodingUnsupported",
			}),
		}),
	);
	expect(() =>
		validateOperationHttpAuthoring(
			{ http: { method: "GET", path: "/messages" } },
			{
				logicalPath: "src/messages.ts",
				exportName: "messagesPage",
				value: {},
				span: null,
				memberSpans: {},
				acceptanceSpans: [],
				lifecycleSources: {},
				packageId: null,
			},
		),
	).toThrow(
		expect.objectContaining({
			code: "QP-COMPOSE-028",
			diagnosticClass: "invalidHttpProjection",
			details: expect.objectContaining({ reason: "unexpectedHttpMember" }),
		}),
	);
});

test("retains the authored text bound required by canonical Query GET", () => {
	expect(codec.text({ maxLength: 100 })).toEqual({
		kind: "text",
		maxLength: 100,
	});
});

test("rejects exact, parameter, and wildcard raw Route intersections", () => {
	for (const [path, reason] of [
		["/_questpie/query/messages.page", "exactPathCollision"],
		["/_questpie/query/:name", "ambiguousParameterCollision"],
		["/_questpie/*rest", "rawWildcardIntersection"],
	] as const)
		expect(() =>
			projectExecutionComposition([
				query({
					kind: "object",
					properties: { search: { kind: "text", maxLength: 100 } },
				}),
				route(path),
			] as never),
		).toThrow(
			expect.objectContaining({
				code: "QP-COMPOSE-029",
				diagnosticClass: "httpProjectionCollision",
				details: expect.objectContaining({ reason }),
			}),
		);
});
