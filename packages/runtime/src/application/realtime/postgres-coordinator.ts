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
	type PostgresWakeTickSource,
	type RetainedLiveQueryCompleteResult,
} from "../../live-query";
import type { LiveQueryCoordinator } from "./coordinator";
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

export function createPostgresDurableLiveQueryCoordinator<Context>(
	input: Readonly<{
		program: LinkedLiveQueryProgramV1;
		sql: SQL;
		hmacKey: Uint8Array;
		applicationName: string;
		consumer?: string;
		deploymentDigest: string;
		wireVersion: number;
		tickSource?: PostgresWakeTickSource;
		signal?: AbortSignal;
	}>,
): LiveQueryCoordinator<Context> {
	void input.program;
	const store = createPostgresRealtimeScopeStore({ sql: input.sql });
	const retention = createPostgresLiveQueryRetention({
		sql: input.sql,
		hmacKey: input.hmacKey,
	});
	const effect = createPostgresLiveQueryInvalidationEffect({
		deploymentDigest: input.deploymentDigest,
	});
	const attachments = new Map<
		string,
		Readonly<{
			attachment: DurableRealtimeAttachment;
			framed: Map<string, string>;
		}>
	>();
	let state: "idle" | "ready" | "draining" | "drained" = "idle";

	const processWatch = async (
		holder: typeof attachments extends Map<string, infer Value> ? Value : never,
		authority: ScopeAuthority,
		watch: PostgresRealtimeWatch,
		signal: AbortSignal,
	): Promise<void> => {
		const prepared = await holder.attachment.prepare(watch, signal);
		if (
			!prepared ||
			prepared.authorityPartitionDigest !== watch.authorityPartitionDigest
		)
			return;
		const dirty =
			watch.latest === null ||
			watch.invalidationGeneration > watch.evaluatedInvalidationGeneration;
		if (dirty) {
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
					const observedPlan = decodeObservedLiveQueryPlan({
						bytes: retained.dependencyPlanBytes,
						bytesDigest: sha256Digest(retained.dependencyPlanBytes),
						queryIdentity: watch.queryIdentity,
					});
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
							payload: decodePayload(retained.resultBytes),
							observedPlan,
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
			}
			let evaluated;
			try {
				evaluated = await prepared.evaluate();
			} catch {
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
				resetReason: resumeUnavailable ? "resume-unavailable" : null,
			});
			if (!staged) return;
			const published = await holder.attachment.publish(
				watch,
				Object.freeze({
					payload: evaluated.payload,
					observedPlan: evaluated.observedPlan,
					delivery: deliveryKind,
					resetReason: resumeUnavailable ? "resume-unavailable" : null,
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
			holder.framed.get(watch.bindingIdentity) === latest.tokenDigest
		)
			return;
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
		if (published) holder.framed.set(watch.bindingIdentity, latest.tokenDigest);
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
		for (const holder of attachments.values()) {
			signal.throwIfAborted();
			const authority = scopeAuthority(
				input.applicationName,
				input.deploymentDigest,
				holder.attachment,
			);
			if (!(await store.renewScope(authority))) continue;
			const watches = await store.scanOpenWatches(authority);
			holder.attachment.synchronize(
				new Set(watches.map((watch) => watch.bindingIdentity)),
			);
			for (const watch of watches)
				await processWatch(holder, authority, watch, signal);
		}
		await store.expireScopes({
			applicationName: input.applicationName,
			deploymentDigest: input.deploymentDigest,
		});
		await retention.prune({ applicationName: input.applicationName });
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
			attachments.set(
				attachment.scopeId,
				Object.freeze({ attachment, framed: new Map() }),
			);
			void wake.requestScan().catch(() => {});
			return true;
		},
		async detach(scopeId: string, principal: Principal) {
			const holder = attachments.get(scopeId);
			if (
				holder &&
				holder.attachment.principal.kind === principal.kind &&
				holder.attachment.principal.id === principal.id
			)
				attachments.delete(scopeId);
			await store.withdrawScope(
				scopeAuthority(input.applicationName, input.deploymentDigest, {
					scopeId,
					principal,
				}),
			);
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
			const watch = (await store.scanOpenWatches(authority)).find(
				(candidate) => candidate.bindingIdentity === bindingId,
			);
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
				store.withdrawScope(
					scopeAuthority(
						input.applicationName,
						input.deploymentDigest,
						holder.attachment,
					),
				),
			);
			attachments.clear();
			await Promise.allSettled(withdrawals);
			await wake.drain();
			state = "drained";
		},
		async open() {
			throw new Error(
				"PostgreSQL realtime opens through the durable carrier seam",
			);
		},
		async acknowledge() {
			return false;
		},
		close() {},
		reconcile: () => wake.requestScan(),
		currentPlan() {
			return undefined;
		},
	});
}
