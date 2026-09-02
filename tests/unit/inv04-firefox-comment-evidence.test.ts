import { expect, test } from "bun:test";

import { firefoxCommentProjectionEvidence } from "../../fixtures/team-support-desk/tracer/browser/tracer/journey";

const commentIds = Object.freeze({
	internal: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7144",
	customerTie: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7143",
	agent: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7142",
	customer: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7141",
});

test("pins the customer Firefox inverse-list projection evidence", () => {
	expect(
		firefoxCommentProjectionEvidence({
			detail: {
				comments: [
					{ id: commentIds.customerTie, body: "tie" },
					{ id: commentIds.agent },
					{ id: commentIds.customer, body: "customer" },
				],
			},
			emptyDetail: { comments: [] },
		}),
	).toEqual({
		conditionalBodyOmitted: true,
		emptyCommentsObserved: true,
		hiddenCommentRemoved: true,
		seededCommentIds: [
			commentIds.customerTie,
			commentIds.agent,
			commentIds.customer,
		],
	});
});

test("rejects an incorrect seeded tie order", () => {
	expect(() =>
		firefoxCommentProjectionEvidence({
			detail: {
				comments: [
					{ id: commentIds.agent },
					{ id: commentIds.customerTie, body: "tie" },
					{ id: commentIds.customer, body: "customer" },
				],
			},
			emptyDetail: { comments: [] },
		}),
	).toThrow("seeded newest-first/tie order");
});
