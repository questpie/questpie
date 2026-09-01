import { expect, test } from "bun:test";

import {
	canonicalContextHeader,
	canonicalOperationPath,
	canonicalPostBody,
	canonicalQueryString,
	decodeCanonicalContextHeader,
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
