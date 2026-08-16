import { expect, test } from "bun:test";

import { principal } from "questpie";

import {
	createLiveQueryCoordinator,
	type LiveQueryCoordinatorDelivery,
} from "../../packages/runtime/src/application/realtime/coordinator";
import type {
	ChangeLedgerFactV1,
	LinkedLiveQueryProgramV1,
	ObservedLiveQueryPlanV1,
} from "../../packages/runtime/src/live-query";
import type {
	PostgresLiveQueryRetention,
	RetainedLiveQueryCompleteResult,
} from "../../packages/runtime/src/live-query/postgres-retention";

const sha = (digit: string) => digit.repeat(64);
const user = principal.user({ id: "user:one" });
const context = Object.freeze({ companyId: "company:one" });

const program: LinkedLiveQueryProgramV1 = {
	format: "questpie.live-query-program",
	version: 1,
	queries: new Map(),
	limits: {
		activePerPrincipal: 64,
		bufferedBytesPerClient: 2_097_152,
		dependencyTokensPerPlan: 256,
		fanoutPerBatch: 1_024,
		ledgerLagMilliseconds: 30_000,
		resultBytes: 1_048_576,
		retainedTokensPerPrincipal: 128,
		retentionMilliseconds: 86_400_000,
	},
};

function plan(collection: string, digit: string): ObservedLiveQueryPlanV1 {
	return Object.freeze({
		format: "questpie.observed-live-query-plan",
		version: 1,
		query: "query:messages.page",
		tokens: Object.freeze([
			Object.freeze({
				kind: "collectionRange" as const,
				collection,
				detail: Object.freeze({}),
			}),
		]),
		digest: sha(digit),
	});
}

function fact(collection = "collection:messages"): ChangeLedgerFactV1 {
	return Object.freeze({
		factIdentity: "00000000-0000-0000-0000-000000000001",
		factId: "1",
		transactionId: "1",
		collection,
		kind: "update",
		oldKey: Object.freeze({ id: "before" }),
		newKey: Object.freeze({ id: "after" }),
		conservative: false,
		capturedAt: new Date(0),
	});
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function retentionHarness() {
	const acknowledged: RetainedLiveQueryCompleteResult[] = [];
	const retained = new Map<
		string,
		Readonly<{
			resultBytes: Uint8Array;
			dependencyPlanBytes: Uint8Array;
			retainedGeneration: bigint;
		}>
	>();
	let sequence = 0;
	const retention: PostgresLiveQueryRetention = {
		mint() {
			sequence += 1;
			return `signed-token:${sequence}`;
		},
		async acknowledge(result) {
			acknowledged.push(result);
			retained.set(result.resumeToken, {
				resultBytes: result.resultBytes,
				dependencyPlanBytes: result.dependencyPlanBytes,
				retainedGeneration: result.binding.retainedGeneration,
			});
		},
		async resume({ resumeToken }) {
			const result = retained.get(resumeToken);
			return result
				? { status: "available" as const, ...result }
				: { status: "unavailable" as const };
		},
		async prune() {
			return { retainedResults: 0, ledgerFacts: 0 };
		},
	};
	return { retention, acknowledged };
}

function openInput(
	overrides: Partial<
		Parameters<ReturnType<typeof createLiveQueryCoordinator>["open"]>[0]
	> = {},
) {
	return {
		scopeId: "scope:one",
		bindingId: "binding:one",
		principal: user,
		context,
		query: "query:messages.page",
		input: { channelId: "channel:one", first: 20, after: null },
		resumeToken: null,
		signal: new AbortController().signal,
		evaluate: async () => ({
			payload: { nodes: [{ body: "initial" }] },
			observedPlan: plan("collection:messages", "1"),
		}),
		publish: (_delivery: LiveQueryCoordinatorDelivery) => true,
		...overrides,
	};
}

test("keeps Live Query opens unavailable until startup reconciliation completes", async () => {
	const latch = deferred();
	const { retention } = retentionHarness();
	const coordinator = createLiveQueryCoordinator({
		program,
		applicationName: "collaboration",
		deploymentDigest: sha("8"),
		wireVersion: 1,
		retention,
		reconcile: async () => latch.promise,
	});

	const startup = coordinator.start();
	await expect(coordinator.open(openInput())).rejects.toThrow(
		"startup reconciliation is incomplete",
	);
	latch.resolve();
	await startup;
	expect((await coordinator.open(openInput())).delivery).toBe("initial");
});

test("reconciles a matching fact into one complete update and replaces the plan", async () => {
	let pendingFacts: readonly ChangeLedgerFactV1[] = [];
	const { retention } = retentionHarness();
	const deliveries: LiveQueryCoordinatorDelivery[] = [];
	let evaluation = 0;
	const coordinator = createLiveQueryCoordinator({
		program,
		applicationName: "collaboration",
		deploymentDigest: sha("8"),
		wireVersion: 1,
		retention,
		reconcile: async (apply) => {
			await apply(pendingFacts);
		},
	});
	await coordinator.start();
	await coordinator.open(
		openInput({
			evaluate: async () => {
				evaluation += 1;
				return {
					payload: { nodes: [{ body: evaluation === 1 ? "initial" : "new" }] },
					observedPlan: plan(
						evaluation === 1 ? "collection:messages" : "collection:memberships",
						evaluation === 1 ? "1" : "2",
					),
				};
			},
			publish(delivery) {
				deliveries.push(delivery);
				return true;
			},
		}),
	);
	pendingFacts = [fact()];
	await coordinator.reconcile();

	expect(deliveries).toEqual([
		expect.objectContaining({
			delivery: "update",
			payload: { nodes: [{ body: "new" }] },
			resetReason: null,
		}),
	]);
	expect(coordinator.currentPlan("scope:one", "binding:one")).toEqual(
		plan("collection:memberships", "2"),
	);
});

test("makes failed or revoked recomputation roll reconciliation back and preserves the prior plan", async () => {
	let pendingFacts: readonly ChangeLedgerFactV1[] = [];
	let durableFrontier = 0;
	const { retention } = retentionHarness();
	const coordinator = createLiveQueryCoordinator({
		program,
		applicationName: "collaboration",
		deploymentDigest: sha("8"),
		wireVersion: 1,
		retention,
		reconcile: async (apply) => {
			await apply(pendingFacts);
			if (pendingFacts.length > 0) durableFrontier += 1;
		},
	});
	await coordinator.start();
	const initial = plan("collection:messages", "1");
	let evaluation = 0;
	await coordinator.open(
		openInput({
			evaluate: async () => {
				evaluation += 1;
				if (evaluation > 1)
					throw Object.assign(new Error("membership revoked"), {
						code: "AUTHORIZATION_FAILED",
					});
				return { payload: { nodes: [] }, observedPlan: initial };
			},
		}),
	);
	pendingFacts = [fact()];
	await expect(coordinator.reconcile()).rejects.toThrow(
		"Live Query reconciliation did not complete",
	);
	expect(durableFrontier).toBe(0);
	expect(coordinator.currentPlan("scope:one", "binding:one")).toBe(initial);
});

test("publishes no staged update when a sibling watch makes the durable batch roll back", async () => {
	let pendingFacts: readonly ChangeLedgerFactV1[] = [];
	let durableFrontier = 0;
	const { retention } = retentionHarness();
	const deliveries: LiveQueryCoordinatorDelivery[] = [];
	const coordinator = createLiveQueryCoordinator({
		program,
		applicationName: "collaboration",
		deploymentDigest: sha("8"),
		wireVersion: 1,
		retention,
		reconcile: async (apply) => {
			await apply(pendingFacts);
			if (pendingFacts.length > 0) durableFrontier += 1;
		},
	});
	await coordinator.start();
	const firstInitial = plan("collection:messages", "1");
	const secondInitial = plan("collection:messages", "2");
	let firstEvaluations = 0;
	let secondEvaluations = 0;
	await coordinator.open(
		openInput({
			bindingId: "binding:first",
			evaluate: async () => {
				firstEvaluations += 1;
				return {
					payload: { nodes: [{ body: "first" }] },
					observedPlan:
						firstEvaluations === 1
							? firstInitial
							: plan("collection:memberships", "3"),
				};
			},
			publish(delivery) {
				deliveries.push(delivery);
				return true;
			},
		}),
	);
	await coordinator.open(
		openInput({
			bindingId: "binding:second",
			evaluate: async () => {
				secondEvaluations += 1;
				if (secondEvaluations > 1) throw new Error("query failed");
				return { payload: { nodes: [] }, observedPlan: secondInitial };
			},
			publish(delivery) {
				deliveries.push(delivery);
				return true;
			},
		}),
	);

	pendingFacts = [fact()];
	await expect(coordinator.reconcile()).rejects.toThrow(
		"Live Query reconciliation did not complete",
	);
	expect(deliveries).toEqual([]);
	expect(durableFrontier).toBe(0);
	expect(coordinator.currentPlan("scope:one", "binding:first")).toBe(
		firstInitial,
	);
	expect(coordinator.currentPlan("scope:one", "binding:second")).toBe(
		secondInitial,
	);
});

test("persists ACK state, resumes an authenticated complete result, and resets unavailable state", async () => {
	const { retention, acknowledged } = retentionHarness();
	const coordinator = createLiveQueryCoordinator({
		program,
		applicationName: "collaboration",
		deploymentDigest: sha("8"),
		wireVersion: 1,
		retention,
		reconcile: async () => {},
	});
	await coordinator.start();
	const first = await coordinator.open(openInput());
	expect(
		await coordinator.acknowledge(
			"scope:one",
			"binding:one",
			first.resumeToken,
		),
	).toBe(true);
	expect(acknowledged).toHaveLength(1);
	coordinator.close("scope:one", "binding:one");

	const resumed = await coordinator.open(
		openInput({
			bindingId: "binding:two",
			resumeToken: first.resumeToken,
			evaluate: async () => {
				throw new Error("authenticated resume must not recompute");
			},
		}),
	);
	expect(resumed).toEqual(
		expect.objectContaining({
			delivery: "initial",
			resetReason: null,
			resumeToken: first.resumeToken,
		}),
	);

	const reset = await coordinator.open(
		openInput({
			bindingId: "binding:three",
			resumeToken: "tampered",
		}),
	);
	expect(reset).toEqual(
		expect.objectContaining({
			delivery: "reset",
			resetReason: "resume-unavailable",
		}),
	);
});
