import type { SQL } from "bun";
import type { Principal } from "questpie";

import { canonicalJsonLine, sha256Digest } from "../../canonical-json";
import {
	createPostgresLiveQueryInvalidationEffect,
	createPostgresLiveQueryRetention,
	createPostgresRealtimeScopeStore,
	createPostgresReconciliationWake,
	decodeObservedLiveQueryPlan,
	reconcilePostgresChangeLedger,
	type LinkedLiveQueryProgramV1,
	type PostgresRealtimeWatch,
	type PostgresRealtimeScopeLease,
	type PostgresWakeTickSource,
	type RetainedLiveQueryCompleteResult,
} from "../../live-query";
import {
	LiveQueryEvaluationFailure,
	type LiveQueryCoordinator,
} from "./coordinator";
import type {
	DurableRealtimeAttachment,
	DurableRealtimeCoordinator,
	DurableRealtimeOpen,
} from "./durable";

type ScopeAuthority = Readonly<{
	applicationName: string;
	scopeIdentity: string;
	deploymentDigest: string;
	principal: DurableRealtimeAttachment["principal"];
}>;

type Holder = Readonly<{
	attachment: DurableRealtimeAttachment;
	framed: Map<string, string>;
	/**
	 * Retained generations this holder refused to disclose because a fresh root
	 * did not reproduce them. Keyed by binding, valued by the exact retained
	 * token digest, so a later real invalidation lifts the fence on its own.
	 */
	withheld: Map<string, string>;
	/**
	 * Bindings whose fresh root was refused by Context or Policy. A refusal never
	 * stages, so the binding stays dirty and would otherwise be recomputed in
	 * full on every tick and re-emit an identical failure. Keyed by binding,
	 * valued by the invalidation generation the refusal was observed at, so the
	 * next real invalidation lifts the fence on its own.
	 */
	denied: Map<string, bigint>;
	lease: PostgresRealtimeScopeLease;
}>;

function scopeAuthority(
	applicationName: string,
	deploymentDigest: string,
	attachment: Pick<DurableRealtimeAttachment, "scopeId" | "principal">,
): ScopeAuthority {
	return Object.freeze({
		applicationName,
		scopeIdentity: attachment.scopeId,
		deploymentDigest,
		principal: attachment.principal,
	});
}

function completeResult(
	applicationName: string,
	deploymentDigest: string,
	watch: PostgresRealtimeWatch,
	generation: bigint,
	resultBytes: Uint8Array,
	dependencyPlanBytes: Uint8Array,
): RetainedLiveQueryCompleteResult {
	return Object.freeze({
		binding: Object.freeze({
			applicationName,
			deploymentDigest,
			authorityPartitionDigest: watch.authorityPartitionDigest,
			queryIdentity: watch.queryIdentity,
			inputDigest: watch.inputDigest,
			wireVersion: watch.wireVersion,
			retainedGeneration: generation,
		}),
		resultBytes,
		dependencyPlanBytes,
	});
}

function decodePayload(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new TypeError("durable realtime result is invalid");
	}
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}

export function createPostgresDurableLiveQueryCoordinator(
	input: Readonly<{
		program: LinkedLiveQueryProgramV1;
		sql: SQL;
		hmacKey: Uint8Array;
		applicationName: string;
		deploymentDigest: string;
		wireVersion: number;
		tickSource?: PostgresWakeTickSource;
		signal?: AbortSignal;
	}>,
): LiveQueryCoordinator {
	const store = createPostgresRealtimeScopeStore({ sql: input.sql });
	const retention = createPostgresLiveQueryRetention({
		sql: input.sql,
		hmacKey: input.hmacKey,
	});
	const effect = createPostgresLiveQueryInvalidationEffect({
		deploymentDigest: input.deploymentDigest,
		fanoutPerBatch: input.program.limits.fanoutPerBatch,
	});
	const attachments = new Map<string, Holder>();
	const leases = new WeakMap<
		DurableRealtimeAttachment,
		PostgresRealtimeScopeLease
	>();
	let state: "idle" | "ready" | "draining" | "drained" = "idle";

	const processWatch = async (
		holder: Holder,
		authority: PostgresRealtimeScopeLease,
		watch: PostgresRealtimeWatch,
		signal: AbortSignal,
	): Promise<void> => {
		const prepared = await holder.attachment.prepare(watch, signal);
		if (
			!prepared ||
			prepared.authorityPartitionDigest !== watch.authorityPartitionDigest
		)
			return;
		if (
			holder.denied.get(watch.bindingIdentity) === watch.invalidationGeneration
		)
			return;
		const dirty =
			watch.latest === null ||
			watch.invalidationGeneration > watch.evaluatedInvalidationGeneration;
		if (dirty) {
			let unavailableResetReason:
				| "authority-changed"
				| "deployment-changed"
				| "resume-unavailable"
				| null = null;
			if (
				watch.latest === null &&
				watch.resumeRequested &&
				watch.requestedResumeToken !== null
			) {
				const retained = await retention.resume({
					binding: {
						applicationName: input.applicationName,
						deploymentDigest: input.deploymentDigest,
						authorityPartitionDigest: watch.authorityPartitionDigest,
						queryIdentity: watch.queryIdentity,
						inputDigest: watch.inputDigest,
						wireVersion: watch.wireVersion,
					},
					resumeToken: watch.requestedResumeToken,
				});
				if (retained.status === "available") {
					decodeObservedLiveQueryPlan({
						bytes: retained.dependencyPlanBytes,
						bytesDigest: sha256Digest(retained.dependencyPlanBytes),
						queryIdentity: watch.queryIdentity,
					});
					let evaluated;
					try {
						evaluated = await prepared.evaluate();
					} catch (error) {
						if (error instanceof LiveQueryEvaluationFailure) {
							await holder.attachment.publishFailure(watch, error.code);
							holder.denied.set(
								watch.bindingIdentity,
								watch.invalidationGeneration,
							);
						}
						return;
					}
					signal.throwIfAborted();
					const resultBytes = canonicalJsonLine(evaluated.payload);
					const dependencyPlanBytes = canonicalJsonLine(evaluated.observedPlan);
					if (
						sameBytes(resultBytes, retained.resultBytes) &&
						sameBytes(dependencyPlanBytes, retained.dependencyPlanBytes)
					) {
						const staged = await store.stageGeneration({
							...authority,
							bindingIdentity: watch.bindingIdentity,
							observedInvalidationGeneration: watch.invalidationGeneration,
							generation: retained.retainedGeneration,
							resumeToken: watch.requestedResumeToken,
							resultBytes: retained.resultBytes,
							dependencyPlanBytes: retained.dependencyPlanBytes,
							delivery: "initial",
							resetReason: null,
						});
						if (!staged) return;
						const published = await holder.attachment.publish(
							watch,
							Object.freeze({
								payload: evaluated.payload,
								observedPlan: evaluated.observedPlan,
								delivery: "initial",
								resetReason: null,
								resumeToken: watch.requestedResumeToken,
							}),
						);
						if (published)
							holder.framed.set(
								watch.bindingIdentity,
								sha256Digest(watch.requestedResumeToken),
							);
						return;
					}

					const generation = retained.retainedGeneration + 1n;
					const complete = completeResult(
						input.applicationName,
						input.deploymentDigest,
						watch,
						generation,
						resultBytes,
						dependencyPlanBytes,
					);
					const resumeToken = retention.mint(complete);
					const staged = await store.stageGeneration({
						...authority,
						bindingIdentity: watch.bindingIdentity,
						observedInvalidationGeneration: watch.invalidationGeneration,
						generation,
						resumeToken,
						resultBytes,
						dependencyPlanBytes,
						delivery: "update",
						resetReason: null,
					});
					if (!staged) return;
					const published = await holder.attachment.publish(
						watch,
						Object.freeze({
							payload: evaluated.payload,
							observedPlan: evaluated.observedPlan,
							delivery: "update",
							resetReason: null,
							resumeToken,
						}),
					);
					if (published)
						holder.framed.set(watch.bindingIdentity, sha256Digest(resumeToken));
					return;
				}
				unavailableResetReason = retained.resetReason;
			}
			let evaluated;
			try {
				evaluated = await prepared.evaluate();
			} catch (error) {
				if (error instanceof LiveQueryEvaluationFailure) {
					await holder.attachment.publishFailure(watch, error.code);
					holder.denied.set(
						watch.bindingIdentity,
						watch.invalidationGeneration,
					);
				}
				return;
			}
			signal.throwIfAborted();
			const generation = (watch.latest?.generation ?? 0n) + 1n;
			const resultBytes = canonicalJsonLine(evaluated.payload);
			const dependencyPlanBytes = canonicalJsonLine(evaluated.observedPlan);
			const complete = completeResult(
				input.applicationName,
				input.deploymentDigest,
				watch,
				generation,
				resultBytes,
				dependencyPlanBytes,
			);
			const resumeToken = retention.mint(complete);
			const resumeUnavailable = watch.latest === null && watch.resumeRequested;
			const resetReason = resumeUnavailable
				? (unavailableResetReason ?? "resume-unavailable")
				: null;
			const deliveryKind = resumeUnavailable
				? "reset"
				: watch.latest === null
					? "initial"
					: "update";
			const staged = await store.stageGeneration({
				...authority,
				bindingIdentity: watch.bindingIdentity,
				observedInvalidationGeneration: watch.invalidationGeneration,
				generation,
				resumeToken,
				resultBytes,
				dependencyPlanBytes,
				delivery: deliveryKind,
				resetReason,
			});
			if (!staged) return;
			const published = await holder.attachment.publish(
				watch,
				Object.freeze({
					payload: evaluated.payload,
					observedPlan: evaluated.observedPlan,
					delivery: deliveryKind,
					resetReason,
					resumeToken,
				}),
			);
			if (published)
				holder.framed.set(watch.bindingIdentity, sha256Digest(resumeToken));
			return;
		}
		const latest = watch.latest;
		if (
			!latest ||
			holder.framed.get(watch.bindingIdentity) === latest.tokenDigest ||
			holder.withheld.get(watch.bindingIdentity) === latest.tokenDigest
		)
			return;
		// A holder takeover or reconnect re-frames a retained generation onto a new
		// connection. The earlier Execution that produced those bytes is not
		// authority for this disclosure, so evaluate a fresh root and let Policy
		// deny before anything is framed, exactly as the resume path does.
		let evaluated;
		try {
			evaluated = await prepared.evaluate();
		} catch (error) {
			if (error instanceof LiveQueryEvaluationFailure) {
				await holder.attachment.publishFailure(watch, error.code);
				holder.denied.set(watch.bindingIdentity, watch.invalidationGeneration);
			}
			return;
		}
		signal.throwIfAborted();
		const resultBytes = canonicalJsonLine(evaluated.payload);
		const dependencyPlanBytes = canonicalJsonLine(evaluated.observedPlan);
		if (
			sameBytes(resultBytes, latest.resultBytes) &&
			sameBytes(dependencyPlanBytes, latest.dependencyPlanBytes)
		) {
			const complete = completeResult(
				input.applicationName,
				input.deploymentDigest,
				watch,
				latest.generation,
				latest.resultBytes,
				latest.dependencyPlanBytes,
			);
			const resumeToken = retention.mint(complete);
			if (sha256Digest(resumeToken) !== latest.tokenDigest) return;
			const observedPlan = decodeObservedLiveQueryPlan({
				bytes: latest.dependencyPlanBytes,
				bytesDigest: sha256Digest(latest.dependencyPlanBytes),
				queryIdentity: watch.queryIdentity,
			});
			const published = await holder.attachment.publish(
				watch,
				Object.freeze({
					payload: decodePayload(latest.resultBytes),
					observedPlan,
					delivery: latest.delivery,
					resetReason: latest.resetReason,
					resumeToken,
				}),
			);
			if (published)
				holder.framed.set(watch.bindingIdentity, latest.tokenDigest);
			return;
		}
		// The freshly authorized result no longer equals the retained generation, so
		// those bytes are not disclosable. A new generation cannot be staged either:
		// this branch runs only while the binding is clean, and staging requires an
		// observed invalidation above the evaluated one. Every change is supposed to
		// reach the binding through the Change Ledger, so divergence here means a
		// change escaped capture. Withhold the generation, and record the exact
		// retained token so the fence lifts by itself once a real invalidation
		// produces a different one instead of recomputing on every tick forever.
		holder.withheld.set(watch.bindingIdentity, latest.tokenDigest);
	};

	const reconcile = async (signal: AbortSignal): Promise<void> => {
		await reconcilePostgresChangeLedger({
			sql: input.sql,
			application: input.applicationName,
			consumer: effect.consumer,
			apply() {},
			effect,
			signal,
		});
		let batch: Array<
			readonly [
				holder: Holder,
				authority: PostgresRealtimeScopeLease,
				watch: PostgresRealtimeWatch,
			]
		> = [];
		const flushBatch = async (): Promise<void> => {
			if (batch.length === 0) return;
			const current = batch;
			batch = [];
			const settled = await Promise.allSettled(
				current.map(([holder, authority, watch]) =>
					processWatch(holder, authority, watch, signal),
				),
			);
			const failed = settled.find(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			if (failed) throw failed.reason;
		};
		// Scope expiry and retention pruning are tick-level obligations, so they run
		// even when a batch rejects. A refusal is already published and fenced
		// before reaching here, so this covers genuine faults rather than denials.
		// The rejection has to survive: an error raised by the maintenance work
		// itself must not silently replace the fault that ended the tick.
		let maintenanceFailure: unknown;
		try {
			for (const [scopeId, holder] of attachments) {
				signal.throwIfAborted();
				const authority = holder.lease;
				if (!(await store.renewScope(authority))) {
					if (attachments.get(scopeId) === holder) attachments.delete(scopeId);
					continue;
				}
				const watches = await store.scanOpenWatches(authority);
				const open = new Set(watches.map((watch) => watch.bindingIdentity));
				holder.attachment.synchronize(open);
				for (const bindingIdentity of holder.framed.keys())
					if (!open.has(bindingIdentity)) holder.framed.delete(bindingIdentity);
				for (const bindingIdentity of holder.withheld.keys())
					if (!open.has(bindingIdentity))
						holder.withheld.delete(bindingIdentity);
				for (const bindingIdentity of holder.denied.keys())
					if (!open.has(bindingIdentity)) holder.denied.delete(bindingIdentity);
				for (const watch of watches) {
					batch.push([holder, authority, watch]);
					if (batch.length === input.program.limits.fanoutPerBatch)
						await flushBatch();
				}
			}
			await flushBatch();
		} finally {
			try {
				await store.expireScopes({
					applicationName: input.applicationName,
					deploymentDigest: input.deploymentDigest,
				});
				await retention.prune({ applicationName: input.applicationName });
			} catch (error) {
				maintenanceFailure = error;
			}
		}
		if (maintenanceFailure !== undefined) throw maintenanceFailure;
	};
	const wake = createPostgresReconciliationWake({
		reconcile,
		tickSource: input.tickSource,
		signal: input.signal,
	});

	const durable: DurableRealtimeCoordinator = Object.freeze({
		async attach(attachment: DurableRealtimeAttachment) {
			const authority = scopeAuthority(
				input.applicationName,
				input.deploymentDigest,
				attachment,
			);
			const attached = await store.attachScope(authority);
			if (attached.status !== "attached") return false;
			const lease = Object.freeze({
				...authority,
				holderGeneration: attached.holderGeneration,
			});
			leases.set(attachment, lease);
			attachments.set(
				attachment.scopeId,
				Object.freeze({
					attachment,
					framed: new Map(),
					withheld: new Map(),
					denied: new Map(),
					lease,
				}),
			);
			void wake.requestScan().catch(() => {});
			return true;
		},
		async detach(attachment: DurableRealtimeAttachment) {
			const holder = attachments.get(attachment.scopeId);
			if (holder?.attachment === attachment)
				attachments.delete(attachment.scopeId);
			const lease = leases.get(attachment);
			if (lease) await store.withdrawScope(lease);
		},
		async open(opened: DurableRealtimeOpen) {
			const result = await store.openWatch({
				...scopeAuthority(
					input.applicationName,
					input.deploymentDigest,
					opened,
				),
				bindingIdentity: opened.bindingId,
				authorityPartitionDigest: opened.authorityPartitionDigest,
				queryIdentity: opened.queryIdentity,
				queryBytes: opened.queryBytes,
				inputBytes: opened.inputBytes,
				inputDigest: opened.inputDigest,
				contextInputBytes: opened.contextInputBytes,
				wireVersion: input.wireVersion,
				resumeRequested: opened.resumeRequested,
				requestedResumeToken: opened.requestedResumeToken,
			});
			void wake.requestScan().catch(() => {});
			return result.status;
		},
		async acknowledge(
			scopeId: string,
			bindingId: string,
			principal: Principal,
			resumeToken: string,
		) {
			const authority = scopeAuthority(
				input.applicationName,
				input.deploymentDigest,
				{ scopeId, principal },
			);
			const watch = await store.readOpenWatch({
				...authority,
				bindingIdentity: bindingId,
			});
			if (
				!watch?.latest ||
				sha256Digest(resumeToken) !== watch.latest.tokenDigest
			)
				return false;
			const complete = completeResult(
				input.applicationName,
				input.deploymentDigest,
				watch,
				watch.latest.generation,
				watch.latest.resultBytes,
				watch.latest.dependencyPlanBytes,
			);
			if (retention.mint(complete) !== resumeToken) return false;
			await retention.acknowledge({ ...complete, resumeToken });
			return store.acknowledgeWatch({
				...authority,
				bindingIdentity: bindingId,
				generation: watch.latest.generation,
				resumeToken,
			});
		},
		close(scopeId: string, bindingId: string, principal: Principal) {
			return store.closeWatch({
				...scopeAuthority(input.applicationName, input.deploymentDigest, {
					scopeId,
					principal,
				}),
				bindingIdentity: bindingId,
			});
		},
		requestScan: () => wake.requestScan(),
	});

	return Object.freeze({
		durable,
		async start() {
			if (state !== "idle")
				throw new Error("Live Query coordinator already started");
			await wake.start();
			state = "ready";
		},
		async drain() {
			if (state === "drained") return;
			state = "draining";
			const withdrawals = [...attachments.values()].map((holder) =>
				store.withdrawScope(holder.lease),
			);
			attachments.clear();
			await Promise.allSettled(withdrawals);
			await wake.drain();
			state = "drained";
		},
	});
}
