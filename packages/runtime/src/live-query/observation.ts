import { canonicalJsonLine, sha256Digest } from "../canonical-json";
import type { PostgresQueryObserver } from "../relational";
import type {
	LinkedQueryWatchabilityV1,
	LinkedStructuralQueryObservationSlotV1,
} from "./program";

export type LiveQueryDependencyTokenKind =
	| "contextBootstrapPoint"
	| "collectionPoint"
	| "collectionRange"
	| "orderingBoundary"
	| "pageSentinel"
	| "policyEvidencePoint"
	| "relationEndpoint"
	| "relationMiss"
	| "tenantPartition";

export type LiveQueryDependencyTokenV1 = Readonly<{
	kind: LiveQueryDependencyTokenKind;
	collection: string;
	detail: Readonly<Record<string, unknown>>;
}>;

export type ObservedLiveQueryPlanV1 = Readonly<{
	format: "questpie.observed-live-query-plan";
	version: 1;
	query: string;
	tokens: readonly LiveQueryDependencyTokenV1[];
	digest: string;
}>;

export interface LiveQueryObservation extends PostgresQueryObserver {
	recordContext(
		identity: string,
		tokens: readonly LiveQueryDependencyTokenV1[],
	): void;
	recordStructuralQuery(
		templateDigest: string,
		tokens: readonly LiveQueryDependencyTokenV1[],
	): void;
	recordStructuralQueryReached(templateDigest: string): void;
	finish(): ObservedLiveQueryPlanV1;
}

function deepFreeze<Value>(value: Value): Value {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

function canonicalToken(
	value: LiveQueryDependencyTokenV1,
	path: string,
): Readonly<{
	token: LiveQueryDependencyTokenV1;
	bytes: Uint8Array;
	key: string;
}> {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).length !== 3 ||
		!Object.hasOwn(value, "kind") ||
		!Object.hasOwn(value, "collection") ||
		!Object.hasOwn(value, "detail")
	)
		throw new TypeError(`${path} must have exact dependency token keys`);
	if (
		typeof value.collection !== "string" ||
		!value.collection.startsWith("collection:")
	)
		throw new TypeError(`${path} Collection identity is invalid`);
	if (
		value.detail === null ||
		typeof value.detail !== "object" ||
		Array.isArray(value.detail)
	)
		throw new TypeError(`${path} detail must be an object`);
	const bytes = canonicalJsonLine(value);
	const cloned = deepFreeze(
		JSON.parse(
			Buffer.from(bytes).toString("utf8"),
		) as LiveQueryDependencyTokenV1,
	);
	return Object.freeze({
		token: cloned,
		bytes,
		key: Buffer.from(bytes).toString("utf8"),
	});
}

function assertDeclaredToken(
	value: LiveQueryDependencyTokenV1,
	allowed: readonly string[],
	path: string,
): void {
	if (!allowed.includes(value.kind))
		throw new TypeError(`${path} kind is not declared by its observation slot`);
}

function assertStructuralCollection(
	value: LiveQueryDependencyTokenV1,
	slot: LinkedStructuralQueryObservationSlotV1,
	path: string,
): void {
	if (!slot.collections.includes(value.collection))
		throw new TypeError(
			`${path} Collection is not declared by the structural Query observation slot`,
		);
}

export function createLiveQueryObservation(
	query: LinkedQueryWatchabilityV1,
): LiveQueryObservation {
	if (!query.watchable || query.context === null)
		throw new TypeError(`Query ${query.identity} is not watchable`);
	const tokens = new Map<
		string,
		Readonly<{
			token: LiveQueryDependencyTokenV1;
			bytes: Uint8Array;
			key: string;
		}>
	>();
	let contextObserved = false;
	let structuralQueryObserved = false;
	let finished: ObservedLiveQueryPlanV1 | undefined;

	const record = (
		values: readonly LiveQueryDependencyTokenV1[],
		validate: (value: LiveQueryDependencyTokenV1, path: string) => void,
		path: string,
	): void => {
		if (finished)
			throw new TypeError("Live Query observation is already complete");
		for (const [index, value] of values.entries()) {
			const itemPath = `${path}[${index}]`;
			validate(value, itemPath);
			const item = canonicalToken(value, itemPath);
			if (!tokens.has(item.key)) {
				if (tokens.size >= query.maximumTokensPerPlan)
					throw new TypeError("Live Query dependency token limit exceeded");
				tokens.set(item.key, item);
			}
		}
	};

	const observation: LiveQueryObservation = {
		recordContext(identity, values) {
			if (identity !== query.context?.identity)
				throw new TypeError("Context observation slot is not declared");
			record(
				values,
				(value, path) =>
					assertDeclaredToken(value, query.context!.tokens, path),
				"Context dependency",
			);
			contextObserved = true;
		},
		recordStructuralQuery(templateDigest, values) {
			const slot = query.structuralQueries.get(templateDigest);
			if (!slot)
				throw new TypeError(
					"Structural Query observation slot is not declared",
				);
			record(
				values,
				(value, path) => {
					assertDeclaredToken(value, slot.tokens, path);
					assertStructuralCollection(value, slot, path);
				},
				"Structural Query dependency",
			);
			structuralQueryObserved = true;
		},
		recordStructuralQueryReached(templateDigest) {
			const slot = query.structuralQueries.get(templateDigest);
			if (!slot)
				throw new TypeError(
					"Structural Query observation slot is not declared",
				);
			const kind = slot.tokens.includes("collectionRange")
				? "collectionRange"
				: slot.tokens[0];
			if (!kind)
				throw new TypeError(
					"Structural Query observation slot has no token kind",
				);
			observation.recordStructuralQuery(
				templateDigest,
				slot.collections.map((collection) => ({
					kind,
					collection,
					detail: { conservative: true, templateDigest },
				})),
			);
		},
		recordPostgresQuery(reached) {
			const slot = query.structuralQueries.get(reached.templateDigest);
			if (!slot)
				throw new TypeError(
					"Structural Query observation slot is not declared",
				);
			const tokens: LiveQueryDependencyTokenV1[] = [];
			const add = (
				kind: LiveQueryDependencyTokenKind,
				collection: string,
				detail: Readonly<Record<string, unknown>>,
			): void => {
				if (slot.tokens.includes(kind))
					tokens.push({ kind, collection, detail });
			};
			add("collectionRange", reached.primaryCollection, {
				scope: reached.scope,
			});
			add("orderingBoundary", reached.primaryCollection, {
				after: reached.after,
				order: reached.order,
			});
			add("pageSentinel", reached.primaryCollection, {
				first: reached.first,
				hasNextPage: reached.hasNextPage,
				observed: reached.observed,
			});
			add("tenantPartition", reached.primaryCollection, {
				id: reached.tenantId,
			});
			const relationCollections = new Set(
				reached.relations.map(({ collection }) => collection),
			);
			for (const collection of slot.collections) {
				if (
					collection !== reached.primaryCollection &&
					!relationCollections.has(collection)
				)
					add("policyEvidencePoint", collection, {
						conservative: true,
						policy: slot.policy,
					});
			}
			for (const relation of reached.relations) {
				if (relation.endpoints > 0)
					add("relationEndpoint", relation.collection, {
						conservative: true,
						observed: relation.endpoints,
						relation: relation.relation,
					});
				if (relation.misses > 0)
					add("relationMiss", relation.collection, {
						conservative: true,
						observed: relation.misses,
						relation: relation.relation,
					});
			}
			observation.recordStructuralQuery(reached.templateDigest, tokens);
		},
		finish() {
			if (finished) return finished;
			if (!contextObserved || !structuralQueryObserved)
				throw new TypeError(
					"Live Query observation is missing an executed observation slot",
				);
			const ordered = [...tokens.values()].toSorted((left, right) =>
				left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
			);
			const withoutDigest = {
				format: "questpie.observed-live-query-plan" as const,
				version: 1 as const,
				query: query.identity,
				tokens: Object.freeze(ordered.map(({ token }) => token)),
			};
			const domain = Buffer.from("questpie-observed-live-query-plan-v1\0");
			finished = Object.freeze({
				...withoutDigest,
				digest: sha256Digest(
					Buffer.concat([domain, canonicalJsonLine(withoutDigest)]),
				),
			});
			return finished;
		},
	};
	return Object.freeze(observation);
}
