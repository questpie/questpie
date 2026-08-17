import { expect, test } from "bun:test";

import { principal } from "questpie";

import { collaborationContext } from "../../fixtures/collaboration/src/execution";
import { channelMessagePage } from "../../fixtures/collaboration/src/message-page";
import {
	canonicalJsonLine,
	sha256Digest,
} from "../../packages/runtime/src/canonical-json";
import { createApplicationRuntime } from "../../packages/runtime/src/execution";
import {
	createLiveQueryObservation,
	decodeObservedLiveQueryPlan,
	type LinkedQueryWatchabilityV1,
} from "../../packages/runtime/src/live-query";

const sha = (digit: string) => digit.repeat(64);

const query: LinkedQueryWatchabilityV1 = {
	identity: "query:messages.page",
	watchable: true,
	inputCodec: {},
	outputCodec: {},
	contractDigest: sha("1"),
	context: {
		kind: "context",
		identity: "context:request",
		projectionDigest: sha("2"),
		tokens: ["contextBootstrapPoint", "tenantPartition"],
	},
	structuralQueries: new Map([
		[
			sha("3"),
			{
				kind: "structuralQuery",
				templateDigest: sha("3"),
				policy: "policy:messages.default",
				policyProgramDigest: sha("4"),
				collections: [
					"collection:channels",
					"collection:memberships",
					"collection:messages",
				],
				relations: ["collection:messages/relation:author"],
				tokens: [
					"collectionRange",
					"orderingBoundary",
					"pageSentinel",
					"policyEvidencePoint",
					"relationEndpoint",
					"relationMiss",
					"tenantPartition",
				],
			},
		],
	]),
	maximumTokensPerPlan: 256,
	unsupportedReason: null,
};

test("records only reached and compiler-declared Live Query dependencies", () => {
	const observation = createLiveQueryObservation(query);
	observation.recordContext("context:request", [
		{
			kind: "contextBootstrapPoint",
			collection: "collection:memberships",
			detail: {
				companyId: "company-northwind",
				principalId: "principal-alice",
				scopeKey: "company",
			},
		},
		{
			kind: "tenantPartition",
			collection: "collection:companies",
			detail: { id: "company-northwind" },
		},
	]);
	observation.recordStructuralQuery(sha("3"), [
		{
			kind: "collectionRange",
			collection: "collection:messages",
			detail: { channelId: "channel-general", after: null },
		},
		{
			kind: "pageSentinel",
			collection: "collection:messages",
			detail: { first: 20, observed: 0 },
		},
		{
			kind: "relationMiss",
			collection: "collection:memberships",
			detail: { relation: "collection:messages/relation:author" },
		},
		{
			kind: "pageSentinel",
			collection: "collection:messages",
			detail: { observed: 0, first: 20 },
		},
	]);

	const plan = observation.finish();
	expect(plan.query).toBe("query:messages.page");
	expect(plan.tokens).toHaveLength(5);
	expect(plan.tokens.map(({ kind }) => kind)).toEqual([
		"tenantPartition",
		"contextBootstrapPoint",
		"relationMiss",
		"collectionRange",
		"pageSentinel",
	]);
	expect(plan.digest).toMatch(/^[0-9a-f]{64}$/);
	expect(Object.isFrozen(plan)).toBe(true);
	expect(Object.isFrozen(plan.tokens[0]?.detail)).toBe(true);
});

test("rejects an undeclared Collection before it can widen invalidation", () => {
	const observation = createLiveQueryObservation(query);
	expect(() =>
		observation.recordStructuralQuery(sha("3"), [
			{
				kind: "policyEvidencePoint",
				collection: "collection:messageEvents",
				detail: {},
			},
		]),
	).toThrow("is not declared by the structural Query observation slot");
});

test("threads a per-root observation through Context and the reached Message structural Query", async () => {
	const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
	const principalId = "018f5f72-d1ce-75de-a1d4-04dbf07df912";
	const messageQuery: LinkedQueryWatchabilityV1 = {
		...query,
		context: { ...query.context!, identity: "context:app.context" },
		structuralQueries: new Map([
			[
				sha("3"),
				{
					...query.structuralQueries.get(sha("3"))!,
					collections: [
						"collection:channels",
						"collection:companies",
						"collection:memberships",
						"collection:messages",
						"collection:spaces",
					],
				},
			],
		]),
	};
	const observation = createLiveQueryObservation(messageQuery);
	const runtime = createApplicationRuntime({
		services: [],
		context: collaborationContext,
		bootstrap: {
			get: async () =>
				({
					id: "018f5f78-64ac-73cc-985e-b48c00e945fa",
					companyId,
					principalId,
					role: "member",
					scopeKey: "company",
					status: "active",
				}) as never,
		},
		project: ({ facts }) => ({
			run(definition: unknown) {
				expect(definition).toBe(channelMessagePage);
				facts.liveQueryObservation?.recordStructuralQueryReached(sha("3"));
				return { nodes: [] };
			},
		}),
	});
	const root = {
		principal: principal.user({ id: principalId }),
		context: { companyId },
		liveQueryObservation: observation,
	};
	const result = await runtime.execution(root, ({ run }) =>
		run(channelMessagePage),
	);
	const successfulPlan = observation.finish();

	expect(result).toEqual({ nodes: [] });
	expect(successfulPlan.tokens.map(({ collection }) => collection)).toEqual([
		"collection:channels",
		"collection:companies",
		"collection:memberships",
		"collection:memberships",
		"collection:messages",
		"collection:spaces",
	]);
	expect(successfulPlan.tokens.map(({ kind }) => kind)).toEqual([
		"collectionRange",
		"collectionRange",
		"collectionRange",
		"contextBootstrapPoint",
		"collectionRange",
		"collectionRange",
	]);

	await runtime.close();
});

test("refuses the 257th distinct dependency token and publishes no plan", () => {
	const observation = createLiveQueryObservation(query);
	const token = (index: number) => ({
		kind: "collectionRange" as const,
		collection: "collection:messages",
		detail: { channelId: "channel-general", after: `cursor-${index}` },
	});

	// The accepted budget is 256 tokens per plan, so exactly 256 distinct
	// tokens must be accepted and the next one must fail closed.
	observation.recordStructuralQuery(
		sha("3"),
		Array.from({ length: 256 }, (_unused, index) => token(index)),
	);
	expect(() =>
		observation.recordStructuralQuery(sha("3"), [token(256)]),
	).toThrow("Live Query dependency token limit exceeded");

	// A repeat of an already-recorded token is deduplicated, not counted again.
	expect(() =>
		observation.recordStructuralQuery(sha("3"), [token(0)]),
	).not.toThrow();
	expect(() =>
		observation.recordStructuralQuery(sha("3"), [token(257)]),
	).toThrow("Live Query dependency token limit exceeded");
});

test("strict-decodes at the 256 token bound and rejects a 257 token plan", () => {
	const encode = (count: number) => {
		const withoutDigest = {
			format: "questpie.observed-live-query-plan" as const,
			version: 1 as const,
			query: "query:messages.page",
			tokens: Array.from({ length: count }, (_unused, index) => ({
				kind: "collectionRange" as const,
				collection: "collection:messages",
				detail: { after: `cursor-${index}` },
			})).sort((left, right) =>
				Buffer.from(canonicalJsonLine(left))
					.toString("utf8")
					.localeCompare(
						Buffer.from(canonicalJsonLine(right)).toString("utf8"),
					),
			),
		};
		return canonicalJsonLine({
			...withoutDigest,
			digest: sha256Digest(
				Buffer.concat([
					Buffer.from("questpie-observed-live-query-plan-v1\0"),
					canonicalJsonLine(withoutDigest),
				]),
			),
		});
	};
	const decode = (bytes: Uint8Array) =>
		decodeObservedLiveQueryPlan({
			bytes,
			bytesDigest: sha256Digest(bytes),
			queryIdentity: "query:messages.page",
		});

	expect(decode(encode(256)).tokens).toHaveLength(256);
	expect(() => decode(encode(257))).toThrow();
});
