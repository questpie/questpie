import type { RuntimeCodec } from "../codec";
import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import type { LinkedJobProjection, LinkedReactionProjection } from "../durable";
import { createJobAcceptance, durableRunIdentity } from "../durable/acceptance";
import { retryBytes } from "../durable/rows";
import { runtimeMonotonicNow, type ExecutionFacts } from "../execution";
import { observePostgresTransaction } from "../observation";
import {
	assertOperationAdmission,
	CommittedResultUnavailable,
	DeclaredOperationError,
	isOperationCallId,
	isPostgresTransactionId,
	OperationFailure,
	type PreparedOperation,
} from "../operation";
import {
	QuestpiePostgresError,
	type PostgresTransactionRunner,
} from "../postgres/contract";
import {
	type DataQueryBindingV1,
	executePostgresTransactionQuery,
	type LinkedPostgresQueryPlans,
	type PostgresQueryObservationV1,
} from "../relational";
import {
	canonicalMutationBytes,
	deterministicUuid,
	mutationDigest,
} from "./canonical";
import { createCollectionMutationData } from "./collection";
import { createDefaultCollectionExecutionBudget } from "./collection-budget";
import { budgetPostgresTransaction } from "./collection-budget-postgres";
import { MutationReceiptUnavailable } from "./contract";
import { createDurableDispatch } from "./dispatch";
import type { MutationInvoker } from "./index";
import { createCollectionLifecycleDoom } from "./lifecycle";
import { createPostgresJobAcceptanceTransaction } from "./postgres-job-acceptance";
import type { LinkedPostgresCollectionOperationPlansV1 } from "./postgres-program";
import type {
	LinkedPostgresMutationTransactionStatement,
	LinkedPostgresMutationTransactionStatements,
} from "./postgres-transaction-statements";
import type { LinkedCollectionMutationProgramsV1 } from "./program";
import {
	assertRequiredMutationReceipt,
	requiredMutationReceipt,
} from "./required-receipt";

const fixedIdentities = [
	"mutation.dispatch.accept",
	"mutation.dispatch.event.insert",
	"mutation.dispatch.insert",
	"mutation.dispatch.kernel.mark",
	"mutation.dispatch.run.insert",
	"mutation.job.acceptance.claim",
	"mutation.job.acceptance.read",
	"mutation.receipt.claim",
	"mutation.receipt.commit",
	"mutation.receipt.read",
] as const;
const emptyJobs: LinkedJobProjection = Object.freeze({
	members: new Map(),
	byIdentity: new Map(),
});
type FixedIdentity = (typeof fixedIdentities)[number];

function mutationPostgresObservationFailure(
	error: unknown,
	signal: AbortSignal,
) {
	const errorCode =
		error instanceof QuestpiePostgresError ? { errorCode: error.code } : {};
	if (
		(error instanceof QuestpiePostgresError && error.code !== "cancelled") ||
		!signal.aborted
	)
		return { outcome: "framework_error" as const, ...errorCode };
	return signal.reason instanceof DOMException &&
		signal.reason.name === "TimeoutError"
		? { outcome: "deadline" as const, ...errorCode }
		: { outcome: "cancelled" as const, ...errorCode };
}

function lifecycleJobRequest(value: unknown): Readonly<{
	payload: Readonly<Record<string, unknown>>;
	options: Readonly<{ idempotencyKey: string; notBefore?: Date }>;
}> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("Lifecycle Job argument must be an object");
	const {
		input: payload,
		idempotencyKey,
		notBefore,
		...unknown
	} = value as Readonly<Record<string, unknown>>;
	if (Object.keys(unknown).length > 0)
		throw new TypeError("Lifecycle Job argument has unknown keys");
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		throw new TypeError("Lifecycle Job input must be an object");
	if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0)
		throw new TypeError("Lifecycle Job idempotency key is invalid");
	if (notBefore !== undefined && !(notBefore instanceof Date))
		throw new TypeError("Lifecycle Job notBefore is invalid");
	return Object.freeze({
		payload: Object.freeze({
			...(payload as Readonly<Record<string, unknown>>),
		}),
		options: Object.freeze({
			idempotencyKey,
			...(notBefore instanceof Date ? { notBefore } : {}),
		}),
	});
}

function fixedStatements(
	linked: LinkedPostgresMutationTransactionStatements,
): Readonly<Record<FixedIdentity, LinkedPostgresMutationTransactionStatement>> {
	const members = new Set(linked.statements);
	if (
		linked.statements.length !== fixedIdentities.length ||
		members.size !== fixedIdentities.length
	)
		throw new TypeError("PostgreSQL Mutation fixed statements are incomplete");
	const entries = fixedIdentities.map((identity) => {
		const member = linked.get(identity);
		if (!member || !members.has(member) || member.identity !== identity)
			throw new TypeError(
				"PostgreSQL Mutation fixed statements are incomplete",
			);
		return [identity, member] as const;
	});
	if (entries.some(([, member], index) => linked.statements[index] !== member))
		throw new TypeError("PostgreSQL Mutation fixed statements are incomplete");
	return Object.freeze(Object.fromEntries(entries)) as Readonly<
		Record<FixedIdentity, LinkedPostgresMutationTransactionStatement>
	>;
}

function bytes(value: unknown, label: string): Uint8Array {
	if (value instanceof Uint8Array) return value;
	throw new TypeError(`${label} must be PostgreSQL bytea`);
}

function errorFactories(definition: Readonly<{ errors?: unknown }>) {
	const raw = definition.errors;
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		return Object.freeze({});
	return Object.freeze(
		Object.fromEntries(
			Object.entries(raw).map(([key, candidate]) => {
				if (
					!candidate ||
					typeof candidate !== "object" ||
					Array.isArray(candidate)
				)
					throw new TypeError(`Mutation error ${key} is invalid`);
				const item = candidate as Readonly<Record<string, unknown>>;
				if (
					item.kind !== "operationError" ||
					typeof item.code !== "string" ||
					typeof item.status !== "number"
				)
					throw new TypeError(`Mutation error ${key} is invalid`);
				const code = item.code;
				const status = item.status;
				return [
					key,
					(payload: unknown = null) =>
						new DeclaredOperationError(code, status, payload),
				];
			}),
		),
	);
}

function replayResult<View>(
	operation: PreparedOperation<View>,
	resultBytes: unknown,
): unknown {
	const encoded = JSON.parse(
		new TextDecoder().decode(bytes(resultBytes, "receipt result")),
	);
	return decodeRuntimeCodec(operation.output, encoded, "$receipt.result");
}

function transactionIdentity(value: unknown): string {
	if (!isPostgresTransactionId(value))
		throw new TypeError("transaction id must be a PostgreSQL xid8");
	return value;
}

function inputScopeBytes(
	input: Readonly<{
		application: string;
		tenantId: string;
		operation: string;
		principalKind: string;
		principalId: string;
		callId: string;
		dispatchSlot: string;
	}>,
): Uint8Array {
	return canonicalMutationBytes(input);
}

export function createPostgresDatabaseMutationInvoker<View>(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		transactionStatements: LinkedPostgresMutationTransactionStatements;
		collectionPlans: LinkedPostgresCollectionOperationPlansV1;
		collectionOperations?: LinkedCollectionMutationProgramsV1;
		queryPlans?: LinkedPostgresQueryPlans;
		reactions: LinkedReactionProjection;
		jobs?: LinkedJobProjection;
		contextInputCodec: RuntimeCodec;
		runtimeBuildDigest: string;
		facts: ExecutionFacts<
			Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
		>;
	}>,
): MutationInvoker<View> {
	const statements = fixedStatements(input.transactionStatements);
	return async (operation, callId, options) => {
		if (operation.binding.kind !== "mutation" || !isOperationCallId(callId))
			throw new TypeError("Mutation call identity is invalid");
		if (!operation.admission)
			throw new TypeError("Mutation admission is unavailable");
		assertOperationAdmission(operation.admission, input.facts);
		const encodedInput = encodeRuntimeCodec(
			operation.inputCodec,
			operation.input,
		);
		const inputBytes = canonicalMutationBytes(encodedInput);
		if (inputBytes.byteLength > 1_048_576)
			throw new TypeError("Mutation input exceeds its byte limit");
		const inputDigest = mutationDigest(inputBytes);
		const requiredReceipt = requiredMutationReceipt(options);
		const signals = [input.facts.signal, options?.signal].filter(
			(signal): signal is AbortSignal => signal !== undefined,
		);
		signals.push(AbortSignal.timeout(5_000));
		if (options?.deadline !== undefined) {
			if (!Number.isFinite(options.deadline))
				throw new TypeError("Mutation deadline is invalid");
			signals.push(
				AbortSignal.timeout(
					Math.max(0, Math.ceil(options.deadline - runtimeMonotonicNow())),
				),
			);
		}
		const signal =
			signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
		const facts = Object.freeze({ ...input.facts, signal });
		let transactionId: string | null = null;
		let observedTransactionId: string | undefined;
		const transactionObservation = options?.observation?.execution.begin({
			kind: "transaction",
			principalKind: facts.principal.kind,
			trace: { kind: "active-parent" },
		});
		const commitObservedTransaction = () => {
			transactionObservation?.event({
				kind: "transaction.committed",
				...(observedTransactionId === undefined
					? {}
					: { transactionId: observedTransactionId }),
			});
			transactionObservation?.end({ kind: "transaction", outcome: "ok" });
		};
		try {
			const runTransaction = () =>
				input.database.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					control: { signal },
					use: async (rawTransaction) => {
						const transaction = options?.observation
							? observePostgresTransaction({
									execution: options.observation.execution,
									failure: (error) =>
										mutationPostgresObservationFailure(error, signal),
									principalKind: facts.principal.kind,
									transaction: rawTransaction,
								})
							: rawTransaction;
						const transactionStarted = runtimeMonotonicNow();
						const scope = [
							input.application,
							facts.tenant.id,
							operation.binding.identity,
							facts.principal.kind,
							facts.principal.id,
							callId,
						] as const;
						const owners = requiredReceipt
							? []
							: await transaction.execute(
									statements["mutation.receipt.claim"].statement,
									[...scope, inputDigest],
								);
						if (owners.length === 0) {
							const receipts = await transaction
								.execute(statements["mutation.receipt.read"].statement, scope)
								.catch((error: unknown) => {
									// The fixed reader rejects absent or malformed rows itself.
									if (
										requiredReceipt &&
										error instanceof QuestpiePostgresError &&
										error.code === "invalidResult"
									)
										throw new MutationReceiptUnavailable();
									throw error;
								});
							const receipt = receipts[0];
							if (!receipt || receipt.outcome !== "committed") {
								if (requiredReceipt) throw new MutationReceiptUnavailable();
								throw new TypeError(
									"Mutation receipt is unavailable after conflict",
								);
							}
							if (receipt.inputDigest !== inputDigest) {
								if (requiredReceipt) throw new MutationReceiptUnavailable();
								throw new DeclaredOperationError("IDEMPOTENCY_CONFLICT", 409, {
									callId,
								});
							}
							let value: unknown;
							try {
								if (requiredReceipt)
									assertRequiredMutationReceipt(requiredReceipt, receipt);
								transactionId = transactionIdentity(receipt.transactionId);
								value = replayResult(operation, receipt.resultBytes);
							} catch (error) {
								if (requiredReceipt) throw new MutationReceiptUnavailable();
								throw error;
							}
							options?.observation?.mutation.event({
								kind: "receipt.replayed",
							});
							return Object.freeze({
								committed: true as const,
								transactionId,
								value,
							});
						}
						const owner = owners[0]!;
						transactionId = transactionIdentity(owner.transactionId);
						observedTransactionId = transactionId;
						if (!(owner.operationTime instanceof Date))
							throw new TypeError(
								"operation time must be a PostgreSQL timestamp",
							);
						let businessRows = 0;
						const lifecycleDoom = createCollectionLifecycleDoom();
						const lifecycleBudget = createDefaultCollectionExecutionBudget({
							doom: lifecycleDoom,
							signal,
						});
						const recordIdForSlot = (dispatchSlot: string) =>
							deterministicUuid(
								inputScopeBytes({
									application: input.application,
									tenantId: facts.tenant.id,
									operation: operation.binding.identity,
									principalKind: facts.principal.kind,
									principalId: facts.principal.id,
									callId,
									dispatchSlot,
								}),
							);
						const jobTransaction = createPostgresJobAcceptanceTransaction({
							transaction,
							statements: input.transactionStatements,
							application: input.application,
							sourceOperation: operation.binding.identity,
							callId,
						});
						const commonJobAcceptance = Object.freeze({
							application: input.application,
							tenantId: facts.tenant.id,
							principal: facts.principal,
							contextInput: facts.contextInput,
							contextInputCodec: input.contextInputCodec,
							runtimeBuildDigest: input.runtimeBuildDigest,
							acceptedAt: owner.operationTime,
							observation: options?.observation?.execution,
							signal,
							causation: Object.freeze({
								kind: "mutationDispatch" as const,
								id: callId,
								correlationId: callId,
							}),
						});
						const jobAcceptance = createJobAcceptance({
							...commonJobAcceptance,
							transaction: jobTransaction,
						});
						const linkedJobs = input.jobs ?? emptyJobs;
						const lifecycleJobAcceptance = createJobAcceptance({
							...commonJobAcceptance,
							transaction: createPostgresJobAcceptanceTransaction({
								transaction: budgetPostgresTransaction(
									transaction,
									lifecycleBudget,
								),
								statements: input.transactionStatements,
								application: input.application,
								sourceOperation: operation.binding.identity,
								callId,
							}),
						});
						const durableDispatch = createDurableDispatch(
							input.reactions,
							linkedJobs,
							jobAcceptance,
						);
						const data = createCollectionMutationData({
							plans: input.collectionPlans,
							collectionOperations: input.collectionOperations,
							facts,
							operationTime: owner.operationTime,
							resultValuesDecoded: true,
							executeLeaf: (leaf, parameters) =>
								transaction.execute(leaf.statement, parameters),
							callId,
							lifecycleDoom,
							executionBudget: lifecycleBudget,
							issueMappings: operation.issueMappings,
							executeList: async (identity, argument) => {
								const list =
									input.collectionOperations?.byIdentity.get(identity);
								if (
									!list ||
									list.member !== "list" ||
									list.dataQueryDigest === null
								)
									throw new TypeError("Lifecycle list capability is withheld");
								const linkedPlan = input.queryPlans?.get(list.dataQueryDigest);
								if (!linkedPlan)
									throw new TypeError(
										"Lifecycle list Query plan is unavailable",
									);
								if (
									!argument ||
									typeof argument !== "object" ||
									Array.isArray(argument)
								)
									throw new TypeError(
										"Lifecycle list argument must be an object",
									);
								const values = argument as Readonly<Record<string, unknown>>;
								const expected = linkedPlan.plan.binding.parameters
									.map(({ name }) => name)
									.sort();
								const actual = Object.keys(values).sort();
								if (
									actual.length !== expected.length ||
									actual.some((name, index) => name !== expected[index])
								)
									throw new TypeError(
										"Collection list argument must have exactly the compiled parameters",
									);
								let observation: PostgresQueryObservationV1 | undefined;
								const page = await executePostgresTransactionQuery({
									linkedPlan,
									binding: {
										templateDigest: linkedPlan.plan.templateDigest,
										values: linkedPlan.plan.binding.parameters.map(
											({ name }) => ({
												parameter: name,
												value: values[
													name
												] as DataQueryBindingV1["values"][number]["value"],
											}),
										),
									},
									executionFacts: {
										authority: facts.authority,
										principal: {
											id: facts.principal.id,
											kind: facts.principal.kind,
										},
										tenant: { id: facts.tenant.id },
									},
									transaction,
									signal,
									observer: {
										recordPostgresQuery(value) {
											observation = value;
										},
									},
								});
								if (!observation)
									throw new TypeError(
										"Lifecycle list observation is unavailable",
									);
								return Object.freeze({
									nodes: page.nodes,
									pageInfo: page.pageInfo,
									observed: observation.observed,
								});
							},
							acceptJob: async (identity, argument) => {
								const job = linkedJobs.byIdentity.get(identity);
								if (!job)
									throw new TypeError("Lifecycle Job capability is withheld");
								const request = lifecycleJobRequest(argument);
								return lifecycleJobAcceptance.accept(
									job,
									request.payload,
									request.options,
								);
							},
							consumeRows(count) {
								businessRows += count;
								if (businessRows > 100)
									throw new TypeError(
										"Mutation exceeded its business row limit",
									);
							},
						});
						const ctx = Object.freeze({
							principal: facts.principal,
							authority: facts.authority,
							tenant: facts.tenant,
							values: facts.values,
							signal,
							deadline: options?.deadline ?? facts.deadline,
							data,
							now: owner.operationTime,
							callId,
							transactionId,
							dispatch: durableDispatch.dispatch,
							jobs: durableDispatch.jobs,
						});
						let result: unknown;
						try {
							result = await operation.binding.execute({
								input: operation.input,
								ctx: ctx as View,
								errors: errorFactories(operation.binding.definition),
							} as never);
						} catch (error) {
							lifecycleDoom.throwIfDoomed();
							throw error;
						}
						lifecycleDoom.throwIfDoomed();
						const validated = decodeRuntimeCodec(
							operation.output,
							result,
							"$mutation.result",
						);
						const resultBytes = canonicalMutationBytes(
							encodeRuntimeCodec(operation.output, validated),
						);
						if (resultBytes.byteLength > 1_048_576)
							throw new TypeError("Mutation result exceeds its byte limit");
						for (const dispatch of durableDispatch.pending) {
							const recordId = recordIdForSlot(dispatch.slot);
							const runId = durableRunIdentity(recordId);
							const reactionAcceptedAt = owner.operationTime;
							const acceptanceObservation =
								options?.observation?.execution.begin({
									dispatchId: recordId,
									kind: "reaction.accept",
									principalKind: facts.principal.kind,
									resourceIdentity: dispatch.resource.identity,
									runId,
									trace: { kind: "active-parent" },
								});
							const acceptReaction = async () => {
								const firstMarker = await transaction.execute(
									statements["mutation.dispatch.kernel.mark"].statement,
									[],
								);
								if (firstMarker[0]?.enabled !== "on")
									throw new TypeError(
										"Durable kernel transaction marker is unavailable",
									);
								await transaction.execute(
									statements["mutation.dispatch.insert"].statement,
									[
										input.application,
										facts.tenant.id,
										operation.binding.identity,
										facts.principal.kind,
										facts.principal.id,
										callId,
										dispatch.slot,
										recordId,
										dispatch.resourceKind,
										dispatch.resource.identity,
										mutationDigest(dispatch.payloadBytes),
										dispatch.payloadBytes,
										reactionAcceptedAt,
									],
								);
								const secondMarker = await transaction.execute(
									statements["mutation.dispatch.kernel.mark"].statement,
									[],
								);
								if (secondMarker[0]?.enabled !== "on")
									throw new TypeError(
										"Durable kernel transaction marker is unavailable",
									);
								const advanced = await transaction.execute(
									statements["mutation.dispatch.accept"].statement,
									[input.application, recordId],
								);
								if (
									advanced.length !== 1 ||
									advanced[0]!.dispatchId !== recordId
								)
									throw new TypeError(
										"Durable dispatch acceptance did not advance",
									);
								const inserted = await transaction.execute(
									statements["mutation.dispatch.run.insert"].statement,
									[
										input.application,
										runId,
										recordId,
										dispatch.resource.identity,
										1,
										facts.tenant.id,
										facts.principal.kind,
										facts.principal.id,
										canonicalMutationBytes(
											encodeRuntimeCodec(
												input.contextInputCodec,
												facts.contextInput,
											),
										),
										dispatch.payloadBytes,
										retryBytes(dispatch.resource.retry),
										input.runtimeBuildDigest,
										dispatch.resource.contractDigest,
										"mutationDispatch",
										callId,
										callId,
										"ready",
										reactionAcceptedAt,
										new Date(
											reactionAcceptedAt.getTime() +
												dispatch.resource.retry.horizonMilliseconds,
										),
										reactionAcceptedAt,
										acceptanceObservation?.context?.traceId ?? null,
										acceptanceObservation?.context?.spanId ?? null,
										acceptanceObservation?.context?.flags ?? null,
									],
								);
								if (inserted.length !== 1 || inserted[0]!.runId !== runId)
									throw new TypeError(
										"Durable dispatch acceptance did not advance",
									);
								await transaction.execute(
									statements["mutation.dispatch.event.insert"].statement,
									[
										input.application,
										runId,
										reactionAcceptedAt,
										dispatch.resource.identity,
										recordId,
										callId,
										callId,
									],
								);
							};
							try {
								await acceptReaction();
								acceptanceObservation?.event({
									dispatchId: recordId,
									kind: "durable.accepted",
									runId,
								});
								acceptanceObservation?.end({
									kind: "reaction.accept",
									outcome: "ok",
								});
							} catch (error) {
								acceptanceObservation?.end({
									kind: "reaction.accept",
									...mutationPostgresObservationFailure(error, signal),
								});
								throw error;
							}
						}
						await transaction.execute(
							statements["mutation.receipt.commit"].statement,
							[...scope, resultBytes, owner.operationTime],
						);
						signal.throwIfAborted();
						if (runtimeMonotonicNow() - transactionStarted > 5_000)
							throw new TypeError(
								"Mutation exceeded its transaction duration limit",
							);
						return Object.freeze({
							committed: true as const,
							transactionId,
							value: validated,
						});
					},
				});
			const result = await (transactionObservation
				? transactionObservation.run(runTransaction)
				: runTransaction());
			commitObservedTransaction();
			return result;
		} catch (error) {
			if (
				error instanceof QuestpiePostgresError &&
				error.code === "commitOutcomeUnknown" &&
				error.phase === "commit" &&
				error.retry === "callerMustResolveCommit"
			) {
				if (transactionId === null) {
					transactionObservation?.end({
						kind: "transaction",
						outcome: "framework_error",
					});
					throw new TypeError(
						"Committed mutation transaction identity is unavailable",
						{ cause: error },
					);
				}
				commitObservedTransaction();
				throw new CommittedResultUnavailable(callId, transactionId, error);
			}
			const outcome = signal.aborted
				? signal.reason instanceof DOMException &&
					signal.reason.name === "TimeoutError"
					? ("deadline" as const)
					: ("cancelled" as const)
				: ("framework_error" as const);
			transactionObservation?.end({ kind: "transaction", outcome });
			if (outcome === "deadline")
				throw new OperationFailure("DEADLINE_EXCEEDED", true);
			if (outcome === "cancelled") throw signal.reason;
			throw error;
		}
	};
}
