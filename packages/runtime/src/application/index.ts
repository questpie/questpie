import {
	principal,
	type ContextDefinition,
	type ContextInputOf,
	type Principal,
	type QuestpieObservability,
} from "questpie";

import { createApplicationRuntime, runtimeMonotonicNow } from "../execution";
import type { LiveQueryObservation } from "../live-query";
import type { MutationInvoker } from "../mutation";
import {
	type ExecutionEntry,
	type ExecutionEventV2,
	type ObservationEndV1,
} from "../observation";
import {
	createOperationEngine,
	CommittedResultUnavailable,
	isOperationCallId,
	OperationFailure,
	type PreparedOperation,
} from "../operation";
import { verifyRuntimeArtifactFiles } from "./artifact-files";
import { decodeRuntimeArtifacts } from "./artifacts";
import {
	validateRuntimeExecutableBindings,
	type RuntimeExecutableBindings,
} from "./bindings";
import type {
	ExecutionInput,
	ExecutionUse,
	MaybePromise,
	RuntimeApplication,
	RuntimeApplicationProgram,
	RuntimeOperations,
	WorkerExecutionAround,
} from "./contract";
import { createCanonicalPostHttp } from "./http-post";
import { createCanonicalQueryApplicationHttp } from "./http-query";
import { createMcpIngress, decodeMcpProjection } from "./mcp";
import { createMcpOperationAdapter } from "./mcp-operation";
import {
	applicationObservationFailure,
	beginApplicationExecution,
	beginApplicationRuntime,
	bindApplicationExecutionObservation,
	createApplicationObservation,
	endApplicationRuntime,
	observeApplicationFetch,
	observeApplicationRoute,
	observeApplicationUnmatchedFetch,
	runApplicationOperation,
} from "./observation";
import {
	isOperationAbort,
	normalizeExecutedOperationError,
} from "./operation-error";
import { controlledRoot, principalIdentity } from "./root";

export type {
	RuntimeExecutableBindings,
	RuntimeExecutableInventoryBinding,
	RuntimeReactionBinding,
} from "./bindings";
export type {
	RuntimeApplication,
	RuntimeApplicationProgram,
	RuntimeOperations,
} from "./contract";

type RuntimeState = "closed" | "draining" | "ready" | "verifying";

export async function createRuntimeApplication<
	Context extends ContextDefinition,
	OperationView,
	ExecutionView = OperationView,
>(
	input: Readonly<{
		artifacts: unknown;
		artifactFiles: Readonly<Record<string, Uint8Array | string>>;
		serverExports: Readonly<Record<string, unknown>>;
		bindings: RuntimeExecutableBindings<OperationView>;
		program: RuntimeApplicationProgram<Context, OperationView, ExecutionView>;
		drainMilliseconds?: number;
		maximumActiveRootsPerPrincipal?: number;
		observability?: QuestpieObservability;
		events?: (event: ExecutionEventV2) => void;
		now?: () => Date;
	}>,
): Promise<RuntimeApplication<ContextInputOf<Context>, ExecutionView>> {
	if (
		input.maximumActiveRootsPerPrincipal !== undefined &&
		(!Number.isSafeInteger(input.maximumActiveRootsPerPrincipal) ||
			input.maximumActiveRootsPerPrincipal <= 0)
	)
		throw new TypeError(
			"maximumActiveRootsPerPrincipal must be a positive safe integer",
		);
	if (
		input.drainMilliseconds !== undefined &&
		(!Number.isSafeInteger(input.drainMilliseconds) ||
			input.drainMilliseconds < 0)
	)
		throw new TypeError("drainMilliseconds must be a nonnegative safe integer");
	let state: RuntimeState = "verifying";
	const drainMilliseconds = input.drainMilliseconds ?? 30_000;
	const artifacts = decodeRuntimeArtifacts(input.artifacts);
	verifyRuntimeArtifactFiles(artifacts, input.artifactFiles);
	const mcpProjection = decodeMcpProjection({
		bytes: input.artifactFiles["mcp-projection.json"],
		digest: artifacts.runtimeBuild.mcpProjectionDigest,
		operationContractDigest: artifacts.runtimeBuild.operationContractsDigest,
		operationHttpContractDigest:
			artifacts.runtimeBuild.operationHttpContractDigest,
	});
	const observation = createApplicationObservation({
		applicationIdentity: artifacts.runtimeBuild.application,
		runtimeBuildDigest: artifacts.runtimeBuild.digest,
		questpieVersion: artifacts.runtimeBuild.compiler.version,
		signalProjectionDigest:
			artifacts.runtimeBuild.observationSignalProjectionDigest,
		observability: input.observability,
		events: input.events,
		wallClock: input.now,
	});
	const validatedBindings = validateRuntimeExecutableBindings(
		artifacts,
		input.bindings,
		input.serverExports,
		input.program as RuntimeApplicationProgram<
			ContextDefinition,
			OperationView,
			ExecutionView
		>,
	);
	const queryBindings = validatedBindings.operations;
	const operationEngine = createOperationEngine(
		queryBindings,
		artifacts.operationContracts.operations.filter(
			(contract) => !contract.identity.startsWith("action:"),
		),
	);
	const networkActionCount = artifacts.httpContract.operations.filter(
		(contract) => contract.identity.startsWith("action:"),
	).length;
	if (networkActionCount > 0 && !input.program.invokeAction)
		throw new TypeError("Runtime network Action executor is unavailable");
	await input.program.verifyReadiness?.(artifacts);
	try {
		await input.program.liveQueryCoordinator?.start();
	} catch (error) {
		await input.program.liveQueryCoordinator
			?.drain({ deadlineAt: Date.now() + drainMilliseconds })
			.catch(() => {});
		throw error;
	}
	const core = createApplicationRuntime({
		services: input.program.services,
		context: input.program.context,
		bootstrap: input.program.bootstrap,
		project: async (scope) => {
			const operation = await input.program.project(scope);
			const mutation = await input.program.projectMutation?.(scope);
			const execution = () =>
				Promise.resolve(
					input.program.projectExecution
						? input.program.projectExecution(scope)
						: (operation as unknown as ExecutionView),
				);
			return Object.freeze({ operation, execution, mutation });
		},
	});
	const activeByPrincipal = new Map<string, number>();
	const activeRoots = new Set<Promise<unknown>>();
	const rootControllers = new Set<AbortController>();
	const maximumRoots = input.maximumActiveRootsPerPrincipal ?? 64;
	const deadlineNow = runtimeMonotonicNow;
	let callSequence = 0;
	let closePromise: Promise<void> | undefined;
	const executeRoot = async <Result>(
		root: Readonly<{
			principal: Principal;
			context: ContextInputOf<Context>;
			signal?: AbortSignal;
			deadline?: number;
			liveQueryObservation?: LiveQueryObservation;
			observationEntry: ExecutionEntry;
			around?: WorkerExecutionAround<Result>;
			onMutationCommitted?(transactionId: string): void;
			completionOwnsAbort?: boolean;
		}>,
		use: (
			input: Readonly<{
				invoke(
					operation: PreparedOperation<OperationView>,
					callId: string,
					options?: Readonly<{ signal?: AbortSignal; deadline?: number }>,
				): Promise<unknown>;
				view: Readonly<{
					operation: OperationView;
					execution(): Promise<ExecutionView>;
					mutation?: MutationInvoker<OperationView>;
				}>;
			}>,
		) => MaybePromise<Result>,
	): Promise<Awaited<Result>> => {
		let admittedPrincipalKey: string | null = null;
		const admitRoot = () => {
			if (state !== "ready")
				throw new OperationFailure("RUNTIME_UNAVAILABLE", true);
			if (!principal.is(root.principal))
				throw new OperationFailure("NOT_FOUND");
			const principalKey = principalIdentity(root.principal);
			const active = activeByPrincipal.get(principalKey) ?? 0;
			if (active >= maximumRoots)
				throw new OperationFailure("RESOURCE_LIMIT", true);
			activeByPrincipal.set(principalKey, active + 1);
			admittedPrincipalKey = principalKey;
		};
		if (!root.around) admitRoot();
		const controlled = controlledRoot({ ...root, now: deadlineNow });
		const observedExecution = beginApplicationExecution(
			observation,
			root.observationEntry,
			root.principal.kind,
		);
		let committedMutation: CommittedResultUnavailable | undefined;
		rootControllers.add(controlled.controller);
		const observedOutcome = (error: unknown) =>
			applicationObservationFailure(error, {
				committedMutation: committedMutation !== undefined,
				deadlineExpired: controlled.deadlineExpired,
				aborted: controlled.controller.signal.aborted,
			});
		const runCore = () => {
			if (admittedPrincipalKey === null) admitRoot();
			return core.execution(
				{
					principal: root.principal,
					context: root.context,
					signal: controlled.controller.signal,
					deadline: root.deadline,
					liveQueryObservation: root.liveQueryObservation,
					settledUseWinsAbort: root.completionOwnsAbort,
					...bindApplicationExecutionObservation(
						observedExecution,
						root.observationEntry,
					),
				},
				(view) => {
					observedExecution?.scope.event({ kind: "context.completed" });
					return use({
						view,
						invoke: (operation, callId, options) =>
							runApplicationOperation({
								execution: observedExecution,
								entry: root.observationEntry,
								kind: operation.binding.kind,
								principalKind: root.principal.kind,
								resourceIdentity: operation.binding.identity,
								failure: observedOutcome,
								normalizeError: (error) =>
									isOperationAbort(error)
										? error
										: normalizeExecutedOperationError(operation, error),
								use: async (operationObservation) => {
									let result: unknown;
									if (operation.binding.kind === "mutation") {
										if (view.mutation === undefined)
											throw new OperationFailure("INTERNAL");
										const invocation = await view.mutation(operation, callId, {
											...options,
											...(operationObservation
												? {
														observation: {
															execution: operationObservation.execution,
															mutation: operationObservation.operation,
														},
													}
												: {}),
										});
										committedMutation = new CommittedResultUnavailable(
											callId,
											invocation.transactionId,
											controlled.controller.signal.reason,
										);
										root.onMutationCommitted?.(invocation.transactionId);
										result = invocation.value;
									} else {
										result = await operationEngine.invokePrepared(
											operation,
											view.operation,
										);
									}
									if (controlled.deadlineExpired && !root.completionOwnsAbort)
										throw (
											committedMutation ??
											new OperationFailure("DEADLINE_EXCEEDED", true)
										);
									if (
										controlled.controller.signal.aborted &&
										!root.completionOwnsAbort
									)
										throw (
											committedMutation ?? controlled.controller.signal.reason
										);
									return result;
								},
							}),
					});
				},
			);
		};
		const executeObserved = () =>
			root.around
				? root.around(observedExecution?.observation ?? null, runCore)
				: runCore();
		const pending = Promise.resolve().then(() =>
			observedExecution
				? observedExecution.scope.run(executeObserved)
				: executeObserved(),
		);
		activeRoots.add(pending);
		let executionEnd: ObservationEndV1 = {
			kind: "execution",
			outcome: "ok",
		};
		try {
			const result = await pending;
			if (controlled.deadlineExpired) {
				if (committedMutation === undefined)
					executionEnd = { kind: "execution", outcome: "deadline" };
				if (root.completionOwnsAbort) return result;
				throw (
					committedMutation ?? new OperationFailure("DEADLINE_EXCEEDED", true)
				);
			}
			if (controlled.controller.signal.aborted) {
				if (committedMutation === undefined)
					executionEnd = { kind: "execution", outcome: "cancelled" };
				if (root.completionOwnsAbort) return result;
				throw committedMutation ?? controlled.controller.signal.reason;
			}
			return result;
		} catch (error) {
			executionEnd = { kind: "execution", ...observedOutcome(error) };
			if (error instanceof CommittedResultUnavailable) throw error;
			if (controlled.deadlineExpired && !root.completionOwnsAbort)
				throw (
					committedMutation ?? new OperationFailure("DEADLINE_EXCEEDED", true)
				);
			if (controlled.controller.signal.aborted && !root.completionOwnsAbort)
				throw committedMutation ?? controlled.controller.signal.reason;
			throw error;
		} finally {
			if (executionEnd.outcome === "cancelled")
				observedExecution?.scope.event({ kind: "execution.cancelled" });
			else if (executionEnd.outcome === "deadline")
				observedExecution?.scope.event({ kind: "execution.deadline_exceeded" });
			observedExecution?.scope.end(executionEnd);
			activeRoots.delete(pending);
			rootControllers.delete(controlled.controller);
			controlled.dispose();
			if (admittedPrincipalKey !== null) {
				const remaining =
					(activeByPrincipal.get(admittedPrincipalKey) ?? 1) - 1;
				if (remaining === 0) activeByPrincipal.delete(admittedPrincipalKey);
				else activeByPrincipal.set(admittedPrincipalKey, remaining);
			}
		}
	};
	const executionAt = <Result>(
		entry: "direct" | "fetch" | "worker",
		root: ExecutionInput<ContextInputOf<Context>>,
		use: ExecutionUse<ExecutionView, Result>,
		around?: WorkerExecutionAround<Result>,
	): Promise<Awaited<Result>> =>
		executeRoot(
			{
				...root,
				observationEntry: entry,
				...(around ? { around, completionOwnsAbort: true } : {}),
			},
			async ({ invoke, view }) => {
				const operations: RuntimeOperations = Object.freeze({
					invoke: (
						identity: string,
						operationInput: unknown,
						options?: Readonly<{
							callId?: string;
							signal?: AbortSignal;
							deadline?: number;
						}>,
					) => {
						const prepared = operationEngine.prepare(identity, operationInput);
						if (prepared.binding.kind === "mutation") {
							const callId = options?.callId ?? crypto.randomUUID();
							if (!isOperationCallId(callId))
								throw new OperationFailure("PROTOCOL_UNSUPPORTED");
							return invoke(prepared, callId, options);
						}
						callSequence += 1;
						return invoke(prepared, `direct:${callSequence}`);
					},
				});
				const scope = Object.freeze({
					...operations,
					execution: await view.execution(),
				});
				return use(scope);
			},
		);
	const execution: RuntimeApplication<
		ContextInputOf<Context>,
		ExecutionView
	>["execution"] = (root, use) => executionAt("direct", root, use);
	const workerExecution: RuntimeApplication<
		ContextInputOf<Context>,
		ExecutionView
	>["workerExecution"] = (root, around, use) =>
		executionAt("worker", root, use, around);
	const route: RuntimeApplication<
		ContextInputOf<Context>,
		ExecutionView
	>["route"] = (root, use) =>
		core.route(root, ({ principal: caller, service, signal, deadline }) =>
			use(
				Object.freeze({
					principal: caller,
					service,
					signal,
					deadline,
					execution: (input, execute) =>
						executionAt(root.entry ?? "direct", input, execute),
				}),
			),
		);
	const observeRoute: RuntimeApplication<
		ContextInputOf<Context>,
		ExecutionView
	>["observeRoute"] = (request, routeTemplate, use) =>
		observeApplicationRoute(observation, request, routeTemplate, use);
	const observeUnmatchedFetch: RuntimeApplication<
		ContextInputOf<Context>,
		ExecutionView
	>["observeUnmatchedFetch"] = (request, use) =>
		observeApplicationUnmatchedFetch(observation, request, use);
	let realtimeCallSequence = 0;
	const realtime =
		input.program.createRealtime?.({
			artifacts,
			artifactFiles: input.artifactFiles,
			contextInput: input.program.context.input,
			resolvePrincipal: input.program.resolvePrincipal,
			evaluate: async ({
				entry,
				principal: caller,
				context,
				query,
				input: value,
				signal,
				observation,
			}) => {
				const prepared = operationEngine.prepare(query, value);
				if (prepared.binding.kind !== "query")
					throw new OperationFailure("NOT_FOUND");
				realtimeCallSequence += 1;
				return executeRoot(
					{
						principal: caller,
						context,
						signal,
						liveQueryObservation: observation,
						observationEntry: entry,
					},
					({ invoke }) => invoke(prepared, `realtime:${realtimeCallSequence}`),
				);
			},
			onObservedPlan: input.program.onLiveQueryObserved,
			coordinator: input.program.liveQueryCoordinator,
		}) ?? null;
	const canonicalQuery = createCanonicalQueryApplicationHttp({
		artifacts,
		contextCodec: input.program.context.input as never,
		prepare: operationEngine.prepare,
		resolvePrincipal: (request, signal) =>
			input.program.resolvePrincipal(request, signal),
		executeRoot,
		now: deadlineNow,
	});
	const executePreparedNetworkOperation = (
		value: Readonly<{
			principal: Principal;
			context: ContextInputOf<Context>;
			operation: PreparedOperation<OperationView>;
			callId: string;
			signal: AbortSignal;
			deadline?: number;
			onCommitted?(transactionId: string): void;
		}>,
	) =>
		executeRoot(
			{
				principal: value.principal,
				context: value.context,
				signal: value.signal,
				...(value.deadline === undefined ? {} : { deadline: value.deadline }),
				observationEntry: "fetch",
				onMutationCommitted: value.onCommitted,
			},
			({ invoke }) => invoke(value.operation, value.callId),
		);
	const executeNetworkAction = (
		value: Readonly<{
			principal: Principal;
			context: ContextInputOf<Context>;
			identity: string;
			operationInput: unknown;
			effectKey: string;
			callId: string;
			signal: AbortSignal;
			deadline?: number;
			timeoutMilliseconds?: number;
			onHandlerDispatch(): void;
		}>,
	) => {
		if (!input.program.invokeAction)
			throw new OperationFailure("RUNTIME_UNAVAILABLE", true);
		return executeRoot(
			{
				principal: value.principal,
				context: value.context,
				signal: value.signal,
				...(value.deadline === undefined ? {} : { deadline: value.deadline }),
				observationEntry: "fetch",
				completionOwnsAbort: true,
			},
			async ({ invoke, view }) => {
				const operations: RuntimeOperations = Object.freeze({
					invoke: (
						nestedIdentity: string,
						nestedInput: unknown,
						options?: Readonly<{
							callId?: string;
							signal?: AbortSignal;
							deadline?: number;
						}>,
					) => {
						const nested = operationEngine.prepare(nestedIdentity, nestedInput);
						if (nested.binding.kind === "mutation") {
							const nestedCallId = options?.callId ?? crypto.randomUUID();
							if (!isOperationCallId(nestedCallId))
								throw new OperationFailure("PROTOCOL_UNSUPPORTED");
							return invoke(nested, nestedCallId, options);
						}
						callSequence += 1;
						return invoke(nested, `action:${callSequence}`, options);
					},
				});
				return input.program.invokeAction!({
					identity: value.identity,
					input: value.operationInput,
					effectKey: value.effectKey,
					callId: value.callId,
					...(value.timeoutMilliseconds === undefined
						? {}
						: { timeoutMilliseconds: value.timeoutMilliseconds }),
					onHandlerDispatch: value.onHandlerDispatch,
					execution: await view.execution(),
					operations,
				});
			},
		);
	};
	const mcpOperation = createMcpOperationAdapter<
		ContextInputOf<Context>,
		OperationView
	>({
		contextCodec: input.program.context.input as never,
		operations: artifacts.httpContract.operations,
		maximumResponseBytes: artifacts.httpContract.limits.responseBytes,
		prepare: operationEngine.prepare,
		resolvePrincipal: async (request, signal) =>
			input.program.resolvePrincipal(request, signal),
		execute: (value) =>
			value.kind === "action"
				? executeNetworkAction({ ...value, effectKey: value.effectKey! })
				: executePreparedNetworkOperation({
						...value,
						operation: value.operation!,
					}),
	});
	const mcp = mcpProjection
		? createMcpIngress({
				serverInfo: {
					name: artifacts.runtimeBuild.application.slice("application:".length),
					version: artifacts.runtimeBuild.compiler.version,
				},
				maximumRequestBytes: artifacts.httpContract.limits.requestBytes,
				tools: mcpProjection.tools,
				execute: mcpOperation,
			})
		: null;
	const canonicalPost = createCanonicalPostHttp<
		ContextInputOf<Context>,
		OperationView
	>({
		application: artifacts.runtimeBuild.application,
		clientContractDigest: artifacts.runtimeBuild.clientContractDigest,
		httpContractDigest: artifacts.httpContract.digest,
		maximumRequestBytes: artifacts.httpContract.limits.requestBytes,
		maximumResponseBytes: artifacts.httpContract.limits.responseBytes,
		contextCodec: input.program.context.input as never,
		operations: artifacts.httpContract.operations,
		prepare: operationEngine.prepare,
		resolvePrincipal: async (request, signal) =>
			input.program.resolvePrincipal(request, signal),
		executeMutation: executePreparedNetworkOperation,
		executeAction: executeNetworkAction,
		now: deadlineNow,
	});
	const fetch = async (request: Request): Promise<Response> => {
		if (mcp) {
			const response = await mcp.fetch(request);
			if (response) return response;
		}
		if (realtime) {
			const response = await realtime.fetch(request);
			if (response) return response;
		}
		const canonicalQueryResponse = await canonicalQuery.fetch(request);
		if (canonicalQueryResponse) return canonicalQueryResponse;
		const canonicalPostResponse = await canonicalPost.fetch(request);
		if (canonicalPostResponse) return canonicalPostResponse;
		return new Response(null, { status: 404 });
	};

	const close = (shutdown: Readonly<{ deadlineAt: number }>): Promise<void> => {
		if (closePromise) return closePromise;
		const deadlineAt = shutdown.deadlineAt;
		if (!Number.isFinite(deadlineAt))
			return Promise.reject(new TypeError("close deadline must be finite"));
		const closeInput = Object.freeze({ deadlineAt });
		state = "draining";
		realtime?.beginDrain();
		let closeDeadlineExpired = false;
		closePromise = (async () => {
			let shutdownFailure: unknown;
			const settle = async (work: Promise<unknown>): Promise<void> => {
				const remaining = Math.max(0, deadlineAt - Date.now());
				if (remaining === 0) {
					closeDeadlineExpired = true;
					void work.catch(() => {});
					return;
				}
				let timer: ReturnType<typeof setTimeout> | undefined;
				let settled: boolean;
				try {
					settled = await Promise.race([
						work.then(() => true),
						new Promise<false>((resolve) => {
							timer = setTimeout(() => resolve(false), remaining);
						}),
					]);
				} finally {
					if (timer) clearTimeout(timer);
				}
				if (!settled) {
					closeDeadlineExpired = true;
					void work.catch(() => {});
				}
			};
			const settlePhase = async (work: Promise<unknown>): Promise<void> => {
				try {
					await settle(work);
				} catch (error) {
					shutdownFailure ??= error;
				}
			};
			if (activeRoots.size > 0) await settle(Promise.allSettled(activeRoots));
			if (activeRoots.size > 0) {
				for (const controller of rootControllers)
					controller.abort(new DOMException("Runtime draining", "AbortError"));
			}
			if (realtime) await settlePhase(realtime.drain(closeInput));
			if (input.program.liveQueryCoordinator)
				await settlePhase(input.program.liveQueryCoordinator.drain(closeInput));
			await settlePhase(core.close());
			state = "closed";
			if (shutdownFailure !== undefined) throw shutdownFailure;
		})()
			.catch((error) => {
				endApplicationRuntime(runtimeObservation, {
					deadlineExpired: closeDeadlineExpired,
					error,
				});
				throw error;
			})
			.then(() => {
				endApplicationRuntime(runtimeObservation, {
					deadlineExpired: closeDeadlineExpired,
				});
			});
		return closePromise;
	};
	const runtimeObservation = beginApplicationRuntime(observation);
	state = "ready";

	return Object.freeze({
		applicationService: core.applicationService,
		execution,
		workerExecution,
		observeRoute,
		observeUnmatchedFetch,
		fetch: observeApplicationFetch(
			observation,
			artifacts.httpContract.operations,
			fetch,
		),
		route,
		close,
	});
}
