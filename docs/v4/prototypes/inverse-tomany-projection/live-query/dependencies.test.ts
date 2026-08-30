import { expect, test } from "bun:test";

import {
	changeReachesDependency,
	collectSelectionDependencies,
	ObservedResult,
} from "./dependencies";

const initial = collectSelectionDependencies(
	"collection:tickets",
	{
		identity: "policy:tickets.default",
		evidenceCollections: ["collection:memberships"],
		tenant: true,
	},
	[
		{ kind: "field", field: "collection:tickets/field:id" },
		{
			kind: "toManyList",
			relation: "collection:tickets/relation:comments",
			collection: "collection:comments",
			policy: {
				identity: "policy:comments.default",
				evidenceCollections: ["collection:commentReaders"],
				tenant: true,
			},
			select: [
				{ kind: "field", field: "collection:comments/field:id" },
				{
					kind: "toOne",
					relation: "collection:comments/relation:author",
					collection: "collection:users",
					policy: {
						identity: "policy:users.default",
						evidenceCollections: ["collection:userVisibility"],
						tenant: false,
					},
					select: [
						{
							kind: "field",
							field: "collection:users/field:name",
						},
					],
				},
			],
		},
	],
);

test("recursively observes inverse lists, nested relations, and child Policy evidence", () => {
	expect(initial).toEqual({
		collections: [
			"collection:commentReaders",
			"collection:comments",
			"collection:memberships",
			"collection:tickets",
			"collection:userVisibility",
			"collection:users",
		],
		relations: [
			"collection:comments/relation:author",
			"collection:tickets/relation:comments",
		],
		policies: [
			"policy:comments.default",
			"policy:tickets.default",
			"policy:users.default",
		],
		tokens: [
			"childListBoundary",
			"childOrderingBoundary",
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

test("child facts dirty empty/top-N lists and successful recompute atomically replaces dependencies", () => {
	for (const kind of ["insert", "update", "delete"] as const)
		expect(
			changeReachesDependency(initial, {
				kind,
				collection: "collection:comments",
			}),
		).toBe(true);
	expect(
		changeReachesDependency(initial, {
			kind: "correlationMove",
			collection: "collection:comments",
			relation: "collection:tickets/relation:comments",
		}),
	).toBe(true);
	expect(
		changeReachesDependency(initial, {
			kind: "policyEvidence",
			collection: "collection:commentReaders",
			policy: "policy:comments.default",
		}),
	).toBe(true);

	const watch = new ObservedResult(initial, {
		comments: [] as readonly string[],
	});
	const replacement = collectSelectionDependencies(
		"collection:tickets",
		{
			identity: "policy:tickets.default",
			evidenceCollections: ["collection:memberships-v2"],
			tenant: true,
		},
		[],
	);
	watch.recompute(() => ({
		plan: replacement,
		result: { comments: ["new"] },
	}));
	expect(watch.read()).toEqual({
		plan: replacement,
		result: { comments: ["new"] },
	});
	expect(
		changeReachesDependency(watch.read().plan, {
			kind: "policyEvidence",
			collection: "collection:commentReaders",
		}),
	).toBe(false);
	expect(
		changeReachesDependency(watch.read().plan, {
			kind: "policyEvidence",
			collection: "collection:memberships-v2",
		}),
	).toBe(true);

	const beforeFailure = watch.read();
	expect(() =>
		watch.recompute(() => {
			throw new Error("cancelled");
		}),
	).toThrow("cancelled");
	expect(watch.read()).toEqual(beforeFailure);
});
