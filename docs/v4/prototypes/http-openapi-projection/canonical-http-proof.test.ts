import { expect, test } from "bun:test";

import {
	canonicalContextHeader,
	canonicalCallHeaders,
	canonicalOperationPath,
	canonicalPostBody,
	canonicalQueryString,
	decodeCanonicalQueryString,
	decodeCanonicalContextHeader,
	generatedCompatibilityHeaders,
	openApiSelected,
	projectCanonicalInventory,
	QUERY_RESPONSE_HEADERS,
} from "./canonical-http-proof";

test("derives disjoint canonical paths from kind and Resource name", () => {
	expect(canonicalOperationPath("query", "tickets.detail")).toBe(
		"/_questpie/query/tickets.detail",
	);
	expect(canonicalOperationPath("mutation", "tickets.detail")).toBe(
		"/_questpie/mutation/tickets.detail",
	);
	expect(canonicalOperationPath("action", "tickets.detail")).toBe(
		"/_questpie/action/tickets.detail",
	);
	expect(() => canonicalOperationPath("query", "tickets/detail")).toThrow();
});

test("selector, grouping, collision, wildcard, and explain inventory share one owner", () => {
	expect(openApiSelected({ projections: { openapi: true } })).toBe(true);
	expect(openApiSelected({})).toBe(false);
	expect(() => openApiSelected({ projections: { openapi: false } })).toThrow();
	const inventory = projectCanonicalInventory("support", [
		{ kind: "query", name: "tickets.detail", origin: "query.ts" },
		{ kind: "mutation", name: "close", origin: "close.ts" },
	]);
	expect(
		inventory.included.map(({ method, operationId, path, tag }) => ({
			method,
			operationId,
			path,
			tag,
		})),
	).toEqual([
		{
			method: "POST",
			operationId: "close",
			path: "/_questpie/mutation/close",
			tag: "support",
		},
		{
			method: "GET",
			operationId: "tickets.detail",
			path: "/_questpie/query/tickets.detail",
			tag: "tickets",
		},
	]);
	expect(() =>
		projectCanonicalInventory("support", [
			{ kind: "query", name: "tickets.detail", origin: "q.ts" },
			{ kind: "mutation", name: "tickets.detail", origin: "m.ts" },
		]),
	).toThrow("openApiOperationIdCollision:m.ts:q.ts");
	expect(() =>
		projectCanonicalInventory(
			"support",
			[{ kind: "query", name: "tickets.detail", origin: "q.ts" }],
			["/_questpie/*"],
		),
	).toThrow("rawWildcardIntersection:q.ts");
});

test("uses readable scalar and one structured encoding per codec-owned member", () => {
	const codec = {
		kind: "object",
		properties: {
			filter: {
				kind: "object",
				properties: {
					labels: {
						kind: "array",
						maximum: 3,
						items: { kind: "text", maxLength: 20 },
					},
				},
			},
			search: { kind: "text", maxLength: 100 },
		},
	} as const;
	expect(
		canonicalQueryString(codec, {
			search: "null value",
			filter: { labels: ["urgent", "customer"] },
		}),
	).toBe(
		"filter=~json%3A%7B%22labels%22%3A%5B%22urgent%22%2C%22customer%22%5D%7D&search=null%20value",
	);
	expect(() =>
		canonicalQueryString(
			{
				kind: "object",
				properties: { search: { kind: "text" } },
			},
			{ search: "unbounded" },
		),
	).toThrow("queryHttpEncodingUnsupported");
	expect(
		decodeCanonicalQueryString(
			codec,
			"filter=~json%3A%7B%22labels%22%3A%5B%22urgent%22%5D%7D&search=hello%20world",
		),
	).toEqual({ filter: { labels: ["urgent"] }, search: "hello world" });
	expect(() =>
		decodeCanonicalQueryString(codec, "search=one&search=two"),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(codec, "search=hello+world"),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(codec, "search=%7ejson%3A%7B%7D"),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(
			codec,
			"filter=~json%3A%7B%22labels%22%3A%5B%22x%22%5D%2C%22labels%22%3A%5B%5D%7D",
		),
	).toThrow();
});

test("preserves safe CallOptions and disables Query cache reuse", () => {
	expect(
		canonicalCallHeaders({ callId: "caller-1", timeoutMilliseconds: 5000 }),
	).toEqual({
		"Questpie-Call-Id": "caller-1",
		"Questpie-Timeout-Milliseconds": "5000",
	});
	expect(() => canonicalCallHeaders({ timeoutMilliseconds: 0 })).toThrow();
	expect(
		generatedCompatibilityHeaders({
			application: "application:support",
			clientContractDigest: "a".repeat(64),
			wireDigest: "b".repeat(64),
		}),
	).toEqual({
		"Questpie-Application": "application:support",
		"Questpie-Client-Contract": "a".repeat(64),
		"Questpie-Wire-Digest": "b".repeat(64),
	});
	expect(QUERY_RESPONSE_HEADERS).toEqual({
		"Cache-Control": "private, no-store",
	});
});

test("keeps typed Context disjoint from Query input and credential Principal", () => {
	const context = {
		membershipId: "018f3b7a-cd17-7b11-9f22-3f43af873efe",
		organizationId: "018f3b79-b78e-7f08-936d-81e995fd2251",
	};
	const header = canonicalContextHeader(context);
	expect(header).not.toContain("=");
	expect(decodeCanonicalContextHeader(header)).toEqual(context);
	expect(
		canonicalQueryString(
			{
				kind: "object",
				properties: { search: { kind: "text", maxLength: 100 } },
			},
			{ search: "printer" },
		),
	).toBe("search=printer");
	expect(canonicalPostBody({ ticketId: "ticket-1" }, context)).toBe(
		'{"context":{"membershipId":"018f3b7a-cd17-7b11-9f22-3f43af873efe","organizationId":"018f3b79-b78e-7f08-936d-81e995fd2251"},"input":{"ticketId":"ticket-1"}}',
	);
});
