import { expect, test } from "bun:test";

import { projectLiveQueryCompilation } from "../../packages/compiler/src/live-query";

const digest = "a".repeat(64);

test("declares inverse, nested, and Policy collections in one watchability slot", () => {
	const projection = projectLiveQueryCompilation({
		resources: [
			{
				kind: "query",
				identity: "query:tickets.detail",
				name: "tickets.detail",
				contract: { exposure: "network" },
			},
		] as never,
		contextProjection: {
			format: "questpie.context-projection",
			version: 1,
			context: {
				identity: "context:request",
			},
		},
		dataProjection: {
			format: "questpie.data-contract-projection",
			version: 1,
			collections: [
				{
					identity: "collection:comments",
					relations: [
						{
							kind: "toOne",
							identity: "collection:comments/relation:author",
							target: "collection:memberships",
						},
						{
							kind: "toOne",
							identity: "collection:comments/relation:ticket",
							target: "collection:tickets",
						},
					],
				},
				{ identity: "collection:memberships", relations: [] },
				{
					identity: "collection:tickets",
					relations: [
						{
							kind: "toMany",
							identity: "collection:tickets/relation:comments",
							inverseOf: "collection:comments/relation:ticket",
							target: "collection:comments",
						},
					],
				},
			],
		},
		policyProjection: {
			format: "questpie.policy-projection",
			version: 1,
			policies: [
				{
					program: {
						identity: "policy:tickets.default",
						target: "collection:tickets",
						attachment: { kind: "default" },
						operations: {
							read: {
								rows: {
									kind: "equal",
									left: {
										kind: "field",
										collection: "collection:tickets",
										path: ["organizationId"],
									},
									right: {
										kind: "executionFact",
										source: "tenant",
										path: ["id"],
									},
								},
							},
						},
					},
				},
				{
					program: {
						identity: "policy:comments.default",
						target: "collection:comments",
						attachment: { kind: "default" },
						operations: {
							read: {
								rows: {
									kind: "exists",
									collection: "collection:tickets",
									predicate: {
										kind: "exists",
										collection: "collection:memberships",
										predicate: { kind: "constant", value: true },
									},
								},
							},
						},
					},
				},
				{
					program: {
						identity: "policy:memberships.default",
						target: "collection:memberships",
						attachment: { kind: "default" },
						operations: {
							read: {
								rows: { kind: "constant", value: true },
							},
						},
					},
				},
			],
		},
		queryProjection: {
			format: "questpie.query-projection",
			version: 2,
			queries: [
				{
					digest,
					policy: "policy:tickets.default",
					template: {
						format: "questpie.data-query-template",
						version: 2,
						from: "collection:tickets",
						order: [{ field: "collection:tickets/field:id" }],
						page: { kind: "forwardCursor" },
						select: [
							{
								kind: "inverseList",
								relation: "collection:comments/relation:ticket",
								source: "collection:comments",
								select: [
									{
										kind: "toOne",
										relation: "collection:comments/relation:author",
										select: [],
									},
								],
							},
						],
					},
				},
			],
		},
	});
	const query = projection.artifacts["query-watchability.json"].queries[0] as {
		possibleObservationSlots: readonly Readonly<Record<string, unknown>>[];
	};
	const slot = query.possibleObservationSlots.find(
		(candidate) => candidate.kind === "structuralQuery",
	);

	expect(slot).toMatchObject({
		templateDigest: digest,
		collections: [
			"collection:comments",
			"collection:memberships",
			"collection:tickets",
		],
		relations: [
			"collection:comments/relation:author",
			"collection:comments/relation:ticket",
		],
		tokens: [
			"collectionRange",
			"orderingBoundary",
			"pageSentinel",
			"policyEvidencePoint",
			"relationEndpoint",
			"relationMiss",
			"tenantPartition",
		],
	});
});
