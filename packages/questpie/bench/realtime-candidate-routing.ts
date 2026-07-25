import { performance } from "node:perf_hooks";

import { classifyRealtimeDeliveryDecision } from "../src/server/modules/core/integrated/realtime/delta.js";
import {
	compileRealtimeTopicRouting,
	evaluateRealtimeChangeRouting,
	RealtimeCandidateRouter,
} from "../src/server/modules/core/integrated/realtime/topic-routing.js";
import type { RealtimeChangeEvent } from "../src/server/modules/core/integrated/realtime/types.js";

const SUBSCRIPTIONS = 100_000;
const SCOPES = 1_000;
const SUBSCRIPTIONS_PER_SCOPE = SUBSCRIPTIONS / SCOPES;
const MODELED_FRAME_BYTES = 256;

type Result = {
	name: string;
	subscriptions: number;
	scopes: number;
	candidateGroups: number;
	guardMatch: number;
	guardMiss: number;
	guardUnknown: number;
	authoritativeDbCalls: number;
	modeledFrames: number;
	modeledSnapshotBytes: number;
	maxQueueEvents: number;
	deliveryMode: "snapshot" | "delta";
	classificationReason: string;
	wallMs: number;
};

function change(scopeId: string): RealtimeChangeEvent {
	return {
		seq: 1,
		resourceType: "collection",
		resource: "activity",
		operation: "create",
		payload: { before: null, after: { scopeId } },
		createdAt: new Date(0),
	};
}

function execute(
	name: string,
	router: RealtimeCandidateRouter<number>,
	plans: Map<number, ReturnType<typeof compileRealtimeTopicRouting>>,
	event: RealtimeChangeEvent,
	classification: ReturnType<typeof classifyRealtimeDeliveryDecision>,
	scopes: number,
): Result {
	const startedAt = performance.now();
	const candidates = router.candidates(event);
	let guardMatch = 0;
	let guardMiss = 0;
	let guardUnknown = 0;
	for (const candidate of candidates) {
		const outcome = evaluateRealtimeChangeRouting(plans.get(candidate)!, event);
		if (outcome === "match") guardMatch += 1;
		else if (outcome === "miss") guardMiss += 1;
		else guardUnknown += 1;
	}
	const authoritativeDbCalls = guardMatch + guardUnknown;
	return {
		name,
		subscriptions: SUBSCRIPTIONS,
		scopes,
		candidateGroups: candidates.size,
		guardMatch,
		guardMiss,
		guardUnknown,
		authoritativeDbCalls,
		modeledFrames: authoritativeDbCalls,
		modeledSnapshotBytes: authoritativeDbCalls * MODELED_FRAME_BYTES,
		maxQueueEvents: 0,
		deliveryMode: classification.mode,
		classificationReason: classification.reason,
		wallMs: Number((performance.now() - startedAt).toFixed(2)),
	};
}

function scopedCase(): Result {
	const router = new RealtimeCandidateRouter<number>();
	const plans = new Map<
		number,
		ReturnType<typeof compileRealtimeTopicRouting>
	>();
	const scopePlans = Array.from({ length: SCOPES }, (_, scope) =>
		compileRealtimeTopicRouting({
			scopeId: `scope-${scope}`,
			RAW: "modeled expensive residual",
		}),
	);
	for (let subscription = 0; subscription < SUBSCRIPTIONS; subscription += 1) {
		const plan = scopePlans[subscription % SCOPES]!;
		plans.set(subscription, plan);
		router.add(subscription, plan);
	}
	return execute(
		"100k subscriptions / 1k scopes",
		router,
		plans,
		change("scope-137"),
		classifyRealtimeDeliveryDecision({
			mode: "delta",
			resourceType: "collection",
			operation: "find",
			where: { scopeId: "scope-137" },
		}),
		SCOPES,
	);
}

function personalizedRelationCase(): Result {
	const router = new RealtimeCandidateRouter<number>();
	const plans = new Map<
		number,
		ReturnType<typeof compileRealtimeTopicRouting>
	>();
	const relationNames = new Set(["recipients"]);
	for (let subscription = 0; subscription < SUBSCRIPTIONS; subscription += 1) {
		const plan = compileRealtimeTopicRouting(
			{
				scopeId: "scope-one",
				recipients: { contains: `principal-${subscription}` },
			},
			relationNames,
		);
		plans.set(subscription, plan);
		router.add(subscription, plan);
	}
	return execute(
		"100k personalized relation subscriptions / 1 scope",
		router,
		plans,
		change("scope-one"),
		classifyRealtimeDeliveryDecision(
			{
				mode: "delta",
				resourceType: "collection",
				operation: "find",
				where: { recipients: { contains: "principal" } },
			},
			relationNames,
		),
		1,
	);
}

const scoped = scopedCase();
const personalized = personalizedRelationCase();

if (scoped.candidateGroups !== SUBSCRIPTIONS_PER_SCOPE) {
	throw new Error(
		`Scoped routing considered ${scoped.candidateGroups}, expected ${SUBSCRIPTIONS_PER_SCOPE}`,
	);
}
if (scoped.authoritativeDbCalls !== SUBSCRIPTIONS_PER_SCOPE) {
	throw new Error("Scoped routing did not bound authoritative DB calls");
}
if (
	personalized.candidateGroups !== SUBSCRIPTIONS ||
	personalized.authoritativeDbCalls !== SUBSCRIPTIONS ||
	personalized.deliveryMode !== "snapshot" ||
	personalized.classificationReason !== "relation_where"
) {
	throw new Error("Personalized relation high-blast case was not surfaced");
}

console.log(
	JSON.stringify(
		{
			fixture: {
				subscriptions: SUBSCRIPTIONS,
				scopes: SCOPES,
				modeledFrameBytes: MODELED_FRAME_BYTES,
				queueModel: "synchronous candidate pass; no queued delivery",
			},
			results: [scoped, personalized],
		},
		null,
		2,
	),
);
