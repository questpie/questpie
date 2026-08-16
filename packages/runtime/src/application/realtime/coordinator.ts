import type { SQL } from "bun";
import type { Principal } from "questpie";

import { canonicalJsonLine, sha256Digest } from "../../canonical-json";
import {
	createLiveQueryInvalidation,
	createPostgresReconciliationWake,
	reconcilePostgresChangeLedger,
	type ChangeLedgerFactV1,
	type LinkedLiveQueryProgramV1,
	type ObservedLiveQueryPlanV1,
	type PostgresReconciliationWake,
} from "../../live-query";
import {
	createPostgresLiveQueryRetention,
	type PostgresLiveQueryRetention,
	type RetainedLiveQueryBinding,
	type RetainedLiveQueryCompleteResult,
} from "../../live-query/postgres-retention";

type MaybePromise<Value> = Value | Promise<Value>;

export type LiveQueryCoordinatorEvaluation = Readonly<{
	payload: unknown;
	observedPlan: ObservedLiveQueryPlanV1;
}>;

export type LiveQueryCoordinatorDelivery = Readonly<{
	payload: unknown;
	observedPlan: ObservedLiveQueryPlanV1;
	delivery: "initial" | "reset" | "update";
	resetReason: "resume-unavailable" | null;
	resumeToken: string;
}>;

export type LiveQueryCoordinatorOpen<Context> = Readonly<{
	scopeId: string;
	bindingId: string;
	principal: Principal;
	context: Context;
	query: string;
	input: unknown;
	resumeToken: string | null;
	signal: AbortSignal;
	evaluate(): Promise<LiveQueryCoordinatorEvaluation>;
	publish(delivery: LiveQueryCoordinatorDelivery): MaybePromise<boolean>;
}>;

export interface LiveQueryCoordinator<Context> {
	start(): Promise<void>;
	drain(): Promise<void>;
	open(
		input: LiveQueryCoordinatorOpen<Context>,
	): Promise<LiveQueryCoordinatorDelivery>;
	acknowledge(
		scopeId: string,
		bindingId: string,
		resumeToken: string,
	): Promise<boolean>;
	close(scopeId: string, bindingId: string): void;
	reconcile(): Promise<void>;
	currentPlan(
		scopeId: string,
		bindingId: string,
	): ObservedLiveQueryPlanV1 | undefined;
}

type Reconcile = (
	apply: (facts: readonly ChangeLedgerFactV1[]) => Promise<void>,
	signal?: AbortSignal,
) => Promise<void>;

type Binding<Context> = {
	readonly identity: string;
	readonly input: LiveQueryCoordinatorOpen<Context>;
	readonly durableBinding: Omit<RetainedLiveQueryBinding, "retainedGeneration">;
	generation: bigint;
	complete: RetainedLiveQueryCompleteResult & Readonly<{ resumeToken: string }>;
	pending?: Readonly<{
		generation: bigint;
		complete: RetainedLiveQueryCompleteResult &
			Readonly<{ resumeToken: string }>;
		delivery: LiveQueryCoordinatorDelivery;
	}>;
	unregister(): void;
};

const digestPattern = /^[0-9a-f]{64}$/;
const tokenKinds = new Set([
	"contextBootstrapPoint",
	"collectionPoint",
	"collectionRange",
	"orderingBoundary",
	"pageSentinel",
	"policyEvidencePoint",
	"relationEndpoint",
	"relationMiss",
	"tenantPartition",
]);

function watchIdentity(scopeId: string, bindingId: string): string {
	return `${scopeId}\0${bindingId}`;
}

function queryIdentity(query: string): string {
	return query.startsWith("query:") ? query.slice("query:".length) : query;
}

function decodePlan(
	bytes: Uint8Array,
	expectedQuery: string,
): ObservedLiveQueryPlanV1 {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new TypeError("retained Live Query dependency plan is invalid");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("retained Live Query dependency plan is invalid");
	const plan = value as Readonly<Record<string, unknown>>;
	if (
		Object.keys(plan).toSorted().join(",") !==
			"digest,format,query,tokens,version" ||
		plan.format !== "questpie.observed-live-query-plan" ||
		plan.version !== 1 ||
		plan.query !== expectedQuery ||
		typeof plan.digest !== "string" ||
		!digestPattern.test(plan.digest) ||
		!Array.isArray(plan.tokens)
	)
		throw new TypeError("retained Live Query dependency plan is invalid");
	const tokens = plan.tokens.map((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw))
			throw new TypeError("retained Live Query dependency token is invalid");
		const token = raw as Readonly<Record<string, unknown>>;
		if (
			Object.keys(token).toSorted().join(",") !== "collection,detail,kind" ||
			typeof token.kind !== "string" ||
			!tokenKinds.has(token.kind) ||
			typeof token.collection !== "string" ||
			!token.collection.startsWith("collection:") ||
			!token.detail ||
			typeof token.detail !== "object" ||
			Array.isArray(token.detail)
		)
			throw new TypeError("retained Live Query dependency token is invalid");
		return Object.freeze({
			kind: token.kind,
			collection: token.collection,
			detail: Object.freeze({ ...(token.detail as Record<string, unknown>) }),
		});
	});
	return Object.freeze({
		format: "questpie.observed-live-query-plan",
		version: 1,
		query: expectedQuery,
		tokens: Object.freeze(tokens),
		digest: plan.digest,
	}) as ObservedLiveQueryPlanV1;
}

function decodePayload(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new TypeError("retained Live Query result is invalid");
	}
}

function completeResult(
	durableBinding: Omit<RetainedLiveQueryBinding, "retainedGeneration">,
	generation: bigint,
	evaluation: LiveQueryCoordinatorEvaluation,
	retention: PostgresLiveQueryRetention,
): RetainedLiveQueryCompleteResult & Readonly<{ resumeToken: string }> {
	const result = Object.freeze({
		binding: Object.freeze({
			...durableBinding,
			retainedGeneration: generation,
		}),
		resultBytes: canonicalJsonLine(evaluation.payload),
		dependencyPlanBytes: canonicalJsonLine(evaluation.observedPlan),
	});
	return Object.freeze({ ...result, resumeToken: retention.mint(result) });
}

function delivery(
	complete: RetainedLiveQueryCompleteResult & Readonly<{ resumeToken: string }>,
	observedPlan: ObservedLiveQueryPlanV1,
	payload: unknown,
	kind: LiveQueryCoordinatorDelivery["delivery"],
	resetReason: LiveQueryCoordinatorDelivery["resetReason"],
): LiveQueryCoordinatorDelivery {
	return Object.freeze({
		payload,
		observedPlan,
		delivery: kind,
		resetReason,
		resumeToken: complete.resumeToken,
	});
}

type LiveQueryCoordinatorInput = Readonly<{
	program: LinkedLiveQueryProgramV1;
	applicationName: string;
	deploymentDigest: string;
	wireVersion: number;
	retention: PostgresLiveQueryRetention;
	reconcile: Reconcile;
}>;

function createLiveQueryCoordinatorInternal<Context>(
	input: LiveQueryCoordinatorInput,
	postgresWake?: Readonly<{ signal?: AbortSignal }>,
): LiveQueryCoordinator<Context> {
	const invalidation = createLiveQueryInvalidation(input.program);
	const bindings = new Map<string, Binding<Context>>();
	let state: "drained" | "draining" | "failed" | "idle" | "ready" | "starting" =
		"idle";
	let startup: Promise<void> | undefined;
	let reconciliation: Promise<void> | undefined;
	let wake: PostgresReconciliationWake | undefined;

	const discardPending = (): void => {
		for (const binding of bindings.values()) binding.pending = undefined;
	};
	const reconcile = (signal?: AbortSignal): Promise<void> => {
		if (reconciliation) return reconciliation;
		let commitPlans: (() => void) | undefined;
		reconciliation = input
			.reconcile(async (facts) => {
				const prepared = await invalidation.prepare(facts);
				if (
					prepared.result.failed.length > 0 ||
					prepared.result.revoked.length > 0
				)
					throw new Error("Live Query reconciliation did not complete");
				commitPlans = prepared.commit;
			}, signal)
			.then(async () => {
				commitPlans?.();
				const pending = [...bindings.values()].flatMap((binding) =>
					binding.pending ? [[binding, binding.pending] as const] : [],
				);
				for (const [binding, staged] of pending) {
					binding.generation = staged.generation;
					binding.complete = staged.complete;
					binding.pending = undefined;
				}
				await Promise.allSettled(
					pending.map(([binding, staged]) =>
						binding.input.publish(staged.delivery),
					),
				);
			})
			.catch((error) => {
				discardPending();
				throw error;
			})
			.finally(() => {
				reconciliation = undefined;
			});
		return reconciliation;
	};
	if (postgresWake) {
		wake = createPostgresReconciliationWake({
			reconcile,
			signal: postgresWake.signal,
		});
	}
	const register = (
		opened: LiveQueryCoordinatorOpen<Context>,
		initial: LiveQueryCoordinatorEvaluation,
		generation: bigint,
		resumeToken?: string,
	): Binding<Context> => {
		const identity = watchIdentity(opened.scopeId, opened.bindingId);
		if (bindings.has(identity))
			throw new TypeError("Live Query binding is already registered");
		const durableBinding = Object.freeze({
			applicationName: input.applicationName,
			deploymentDigest: input.deploymentDigest,
			authorityPartitionDigest: sha256Digest(
				canonicalJsonLine({
					principal: { kind: opened.principal.kind, id: opened.principal.id },
					context: opened.context,
				}),
			),
			queryIdentity: queryIdentity(opened.query),
			inputDigest: sha256Digest(canonicalJsonLine(opened.input)),
			wireVersion: input.wireVersion,
		});
		let complete = completeResult(
			durableBinding,
			generation,
			initial,
			input.retention,
		);
		if (resumeToken) complete = Object.freeze({ ...complete, resumeToken });
		const binding: Binding<Context> = {
			identity,
			input: opened,
			durableBinding,
			generation,
			complete,
			pending: undefined,
			unregister: () => {},
		};
		binding.unregister = invalidation.register({
			watch: identity,
			plan: initial.observedPlan,
			recompute: async () => {
				if (opened.signal.aborted || bindings.get(identity) !== binding)
					return { status: "failed" };
				try {
					const evaluated = await opened.evaluate();
					const nextGeneration = binding.generation + 1n;
					const nextComplete = completeResult(
						binding.durableBinding,
						nextGeneration,
						evaluated,
						input.retention,
					);
					const update = delivery(
						nextComplete,
						evaluated.observedPlan,
						evaluated.payload,
						"update",
						null,
					);
					binding.pending = Object.freeze({
						generation: nextGeneration,
						complete: nextComplete,
						delivery: update,
					});
					return { status: "success", plan: evaluated.observedPlan };
				} catch (error) {
					binding.pending = undefined;
					return (error as Readonly<{ code?: unknown }>)?.code ===
						"AUTHORIZATION_FAILED"
						? { status: "revoked" }
						: { status: "failed" };
				}
			},
		});
		bindings.set(identity, binding);
		return binding;
	};

	const coordinator: LiveQueryCoordinator<Context> = {
		start() {
			if (startup) return startup;
			state = "starting";
			startup = (wake ? wake.start() : reconcile()).then(
				() => {
					state = "ready";
				},
				(error) => {
					state = "failed";
					throw error;
				},
			);
			return startup;
		},
		async drain() {
			if (state === "drained" || state === "draining") {
				await wake?.drain();
				return;
			}
			state = "draining";
			await wake?.drain();
			state = "drained";
		},
		async open(opened) {
			if (state !== "ready")
				throw new Error("Live Query startup reconciliation is incomplete");
			if (opened.signal.aborted) throw opened.signal.reason;
			const durableBinding = Object.freeze({
				applicationName: input.applicationName,
				deploymentDigest: input.deploymentDigest,
				authorityPartitionDigest: sha256Digest(
					canonicalJsonLine({
						principal: {
							kind: opened.principal.kind,
							id: opened.principal.id,
						},
						context: opened.context,
					}),
				),
				queryIdentity: queryIdentity(opened.query),
				inputDigest: sha256Digest(canonicalJsonLine(opened.input)),
				wireVersion: input.wireVersion,
			});
			if (opened.resumeToken !== null) {
				const retained = await input.retention.resume({
					binding: durableBinding,
					resumeToken: opened.resumeToken,
				});
				if (retained.status === "available") {
					if (opened.signal.aborted) throw opened.signal.reason;
					const observedPlan = decodePlan(
						retained.dependencyPlanBytes,
						opened.query,
					);
					const payload = decodePayload(retained.resultBytes);
					const binding = register(
						opened,
						{ payload, observedPlan },
						retained.retainedGeneration,
						opened.resumeToken,
					);
					return delivery(
						binding.complete,
						observedPlan,
						payload,
						"initial",
						null,
					);
				}
			}
			const evaluated = await opened.evaluate();
			if (opened.signal.aborted) throw opened.signal.reason;
			const binding = register(opened, evaluated, 1n);
			return delivery(
				binding.complete,
				evaluated.observedPlan,
				evaluated.payload,
				opened.resumeToken === null ? "initial" : "reset",
				opened.resumeToken === null ? null : "resume-unavailable",
			);
		},
		async acknowledge(scopeId, bindingId, resumeToken) {
			const binding = bindings.get(watchIdentity(scopeId, bindingId));
			if (!binding || binding.complete.resumeToken !== resumeToken)
				return false;
			await input.retention.acknowledge({
				...binding.complete,
			});
			return true;
		},
		close(scopeId, bindingId) {
			const identity = watchIdentity(scopeId, bindingId);
			const binding = bindings.get(identity);
			if (!binding) return;
			bindings.delete(identity);
			binding.unregister();
		},
		reconcile,
		currentPlan(scopeId, bindingId) {
			return invalidation.currentPlan(watchIdentity(scopeId, bindingId));
		},
	};
	return Object.freeze(coordinator);
}

export function createLiveQueryCoordinator<Context>(
	input: LiveQueryCoordinatorInput,
): LiveQueryCoordinator<Context> {
	return createLiveQueryCoordinatorInternal(input);
}

export function createPostgresLiveQueryCoordinator<Context>(
	input: Readonly<{
		program: LinkedLiveQueryProgramV1;
		sql: SQL;
		hmacKey: Uint8Array;
		applicationName: string;
		consumer: string;
		deploymentDigest: string;
		wireVersion: number;
		signal?: AbortSignal;
	}>,
): LiveQueryCoordinator<Context> {
	const retention = createPostgresLiveQueryRetention({
		sql: input.sql,
		hmacKey: input.hmacKey,
	});
	return createLiveQueryCoordinatorInternal(
		{
			program: input.program,
			applicationName: input.applicationName,
			deploymentDigest: input.deploymentDigest,
			wireVersion: input.wireVersion,
			retention,
			reconcile: async (apply, signal) => {
				await reconcilePostgresChangeLedger({
					sql: input.sql,
					application: input.applicationName,
					consumer: input.consumer,
					apply: (facts) => apply(facts),
					signal,
				});
			},
		},
		{ signal: input.signal },
	);
}
