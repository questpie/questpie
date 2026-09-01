import {
	principal,
	type ContextDefinition,
	type ContextInputOf,
	type Principal,
	type QuestpieObservability,
} from "questpie";

import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { createApplicationRuntime } from "../execution";
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
	committedResultUnavailableFrame,
	DeclaredOperationError,
	declaredErrorFrame,
	decodeOperationWireRequest,
	encodeDeclaredOperationError,
	failureFrame,
	isOperationCallId,
	normalizeOperationError,
	OperationFailure,
	operationFailureStatus,
	operationMediaType,
	operationPath,
	operationWireResponse,
	type PreparedOperation,
	readBoundedRequestBody,
	rejectionFrame,
	resultFrame,
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
import {
	matchesRetainedClientPair,
	retainClientPairs,
	type RetainedClientPair,
} from "./retained-clients";
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
		retainedClients?: readonly RetainedClientPair[];
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
	const retainedClients = retainClientPairs(input.retainedClients);
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
	const networkOperations = new Set(
		artifacts.wireContract.operations.map(({ identity }) => identity),
	);
	const networkActionContracts = new Map(
		artifacts.wireContract.operations
			.filter((contract) => contract.identity.startsWith("action:"))
			.map((contract) => [contract.identity, contract]),
	);
	if (networkActionContracts.size > 0 && !input.program.invokeAction)
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
	const nowMilliseconds = () => (input.now?.() ?? new Date()).getTime();
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
		const controlled = controlledRoot({ ...root, now: nowMilliseconds });
		const observedExecution = beginApplicationExecution(
			observation,
			root.observationEntry,
			root.principal.kind,
		);
		let committedMutation = false;
		rootControllers.add(controlled.controller);
		const observedOutcome = (error: unknown) =>
			applicationObservationFailure(error, {
				committedMutation,
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
										committedMutation = invocation.committed;
										result = invocation.value;
									} else {
										result = await operationEngine.invokePrepared(
											operation,
											view.operation,
										);
									}
									if (controlled.deadlineExpired && !committedMutation)
										throw new OperationFailure("DEADLINE_EXCEEDED", true);
									if (
										controlled.controller.signal.aborted &&
										!committedMutation
									)
										throw controlled.controller.signal.reason;
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
			if (controlled.deadlineExpired && !committedMutation) {
				executionEnd = { kind: "execution", outcome: "deadline" };
				if (root.completionOwnsAbort) return result;
				throw new OperationFailure("DEADLINE_EXCEEDED", true);
			}
			if (controlled.controller.signal.aborted && !committedMutation) {
				executionEnd = { kind: "execution", outcome: "cancelled" };
				if (root.completionOwnsAbort) return result;
				throw controlled.controller.signal.reason;
			}
			return result;
		} catch (error) {
			executionEnd = { kind: "execution", ...observedOutcome(error) };
			if (error instanceof CommittedResultUnavailable) throw error;
			if (controlled.deadlineExpired && !committedMutation)
				throw new OperationFailure("DEADLINE_EXCEEDED", true);
			if (controlled.controller.signal.aborted && !committedMutation)
				throw controlled.controller.signal.reason;
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

	const fetch = async (request: Request): Promise<Response> => {
		if (realtime) {
			const response = await realtime.fetch(request);
			if (response) return response;
		}
		if (new URL(request.url).pathname !== operationPath)
			return operationWireResponse(rejectionFrame("NOT_FOUND"), 404);
		if (request.method !== "POST")
			return operationWireResponse(rejectionFrame("PROTOCOL_UNSUPPORTED"), 405);
		if (request.headers.get("content-type") !== operationMediaType)
			return operationWireResponse(rejectionFrame("PROTOCOL_UNSUPPORTED"), 415);
		const body = await readBoundedRequestBody(
			request,
			artifacts.wireContract.limits.requestBytes,
		);
		if (body.kind === "tooLarge")
			return operationWireResponse(rejectionFrame("RESOURCE_LIMIT"), 413);
		if (body.kind === "invalid")
			return operationWireResponse(rejectionFrame("PROTOCOL_UNSUPPORTED"), 400);
		let rawFrame: unknown;
		try {
			rawFrame = JSON.parse(body.text);
		} catch {
			return operationWireResponse(rejectionFrame("PROTOCOL_UNSUPPORTED"), 400);
		}
		const frame = decodeOperationWireRequest(rawFrame);
		if (!frame)
			return operationWireResponse(rejectionFrame("PROTOCOL_UNSUPPORTED"), 400);
		if (frame.application !== artifacts.runtimeBuild.application)
			return operationWireResponse(rejectionFrame("APPLICATION_MISMATCH"), 409);
		const current =
			frame.clientContractDigest ===
				artifacts.runtimeBuild.clientContractDigest &&
			frame.wireDigest === artifacts.wireContract.digest;
		const currentV2 =
			artifacts.wireContract.version === 3 &&
			frame.clientContractDigest ===
				artifacts.wireContract.compatibility.clientContractDigest &&
			frame.wireDigest === artifacts.wireContract.compatibility.wireV2Digest;
		const currentV1 =
			artifacts.wireContract.version !== 1 &&
			frame.clientContractDigest ===
				artifacts.wireContract.compatibility.clientContractDigest &&
			frame.wireDigest === artifacts.wireContract.compatibility.wireV1Digest;
		const retainedLegacy =
			!current &&
			!currentV2 &&
			(currentV1 ||
				matchesRetainedClientPair(
					retainedClients,
					frame.clientContractDigest,
					frame.wireDigest,
				));
		if (!current && !currentV2 && !retainedLegacy)
			return operationWireResponse(rejectionFrame("CLIENT_OUTDATED"), 409);
		const actionRequest = frame.operation.startsWith("action:");
		if (actionRequest && (!current || artifacts.wireContract.version !== 3))
			return operationWireResponse(rejectionFrame("CLIENT_OUTDATED"), 409);
		if (
			(actionRequest && !Object.hasOwn(frame, "effectKey")) ||
			(!actionRequest && Object.hasOwn(frame, "effectKey"))
		)
			return operationWireResponse(rejectionFrame("PROTOCOL_UNSUPPORTED"), 400);
		if (retainedLegacy) {
			const binding = queryBindings.find(
				(candidate) => candidate.identity === frame.operation,
			);
			if (binding?.kind !== "query")
				return operationWireResponse(rejectionFrame("CLIENT_OUTDATED"), 409);
		}
		if (!networkOperations.has(frame.operation))
			return operationWireResponse(
				failureFrame(frame, "NOT_FOUND"),
				operationFailureStatus("NOT_FOUND"),
			);
		let prepared: PreparedOperation<OperationView> | undefined;
		const actionContract = actionRequest
			? networkActionContracts.get(frame.operation)
			: undefined;
		let contextInput: ContextInputOf<Context>;
		try {
			if (actionRequest) {
				if (!actionContract) throw new OperationFailure("NOT_FOUND");
			} else prepared = operationEngine.prepare(frame.operation, frame.input);
			contextInput = decodeRuntimeCodec<ContextInputOf<Context>>(
				input.program.context.input as never,
				frame.context,
				"$context",
			);
		} catch (error) {
			const failure =
				error instanceof OperationFailure
					? error
					: error instanceof RuntimeCodecError
						? new OperationFailure("PROTOCOL_UNSUPPORTED")
						: new OperationFailure("INTERNAL");
			return operationWireResponse(
				failureFrame(frame, failure.code, failure.retryable),
				operationFailureStatus(failure.code),
			);
		}
		if (state !== "ready")
			return operationWireResponse(
				failureFrame(frame, "RUNTIME_UNAVAILABLE", true),
				503,
			);
		let resolvedPrincipal: Principal | null;
		try {
			resolvedPrincipal = await input.program.resolvePrincipal(request);
		} catch (error) {
			if (request.signal.aborted) throw request.signal.reason;
			if (error instanceof OperationFailure)
				return operationWireResponse(
					failureFrame(frame, error.code, error.retryable),
					operationFailureStatus(error.code),
				);
			return operationWireResponse(failureFrame(frame, "INTERNAL"), 500);
		}
		if (!resolvedPrincipal || !principal.is(resolvedPrincipal))
			return operationWireResponse(failureFrame(frame, "NOT_FOUND"), 404);
		try {
			const payload = await executeRoot(
				{
					principal: resolvedPrincipal,
					context: contextInput,
					signal: request.signal,
					deadline:
						actionRequest || frame.timeoutMilliseconds === null
							? undefined
							: nowMilliseconds() + frame.timeoutMilliseconds,
					observationEntry: "fetch",
				},
				async ({ invoke, view }) => {
					if (!actionRequest) return invoke(prepared!, frame.callId);
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
							const nested = operationEngine.prepare(identity, operationInput);
							if (nested.binding.kind === "mutation") {
								const callId = options?.callId ?? crypto.randomUUID();
								if (!isOperationCallId(callId))
									throw new OperationFailure("PROTOCOL_UNSUPPORTED");
								return invoke(nested, callId, options);
							}
							callSequence += 1;
							return invoke(nested, `action:${callSequence}`, options);
						},
					});
					return input.program.invokeAction!({
						identity: frame.operation,
						input: frame.input,
						effectKey: frame.effectKey!,
						callId: frame.callId,
						...(frame.timeoutMilliseconds === null
							? {}
							: { timeoutMilliseconds: frame.timeoutMilliseconds }),
						execution: await view.execution(),
						operations,
					});
				},
			);
			const framed = resultFrame(
				frame,
				encodeRuntimeCodec((actionContract ?? prepared!).output, payload),
			);
			const bytes = JSON.stringify(framed);
			if (
				Buffer.byteLength(bytes) > artifacts.wireContract.limits.responseBytes
			)
				return operationWireResponse(
					failureFrame(frame, "RESOURCE_LIMIT", true),
					500,
				);
			return operationWireResponse(framed, 200);
		} catch (error) {
			if (error instanceof CommittedResultUnavailable)
				return operationWireResponse(
					committedResultUnavailableFrame(frame, error),
					500,
				);
			if (request.signal.aborted) throw request.signal.reason;
			if (isOperationAbort(error)) throw error;
			let operationError: unknown = error;
			if (error instanceof DeclaredOperationError) {
				try {
					const declared = encodeDeclaredOperationError(
						(actionContract
							? { declaredErrors: actionContract.declaredErrors }
							: prepared!) as PreparedOperation<OperationView>,
						error,
					);
					return operationWireResponse(
						declaredErrorFrame(frame, declared),
						declared.status,
					);
				} catch (caught) {
					operationError = caught;
				}
			}
			const normalized = normalizeOperationError(operationError);
			if (normalized instanceof CommittedResultUnavailable)
				return operationWireResponse(
					committedResultUnavailableFrame(frame, normalized),
					500,
				);
			const failure =
				normalized instanceof OperationFailure
					? normalized
					: new OperationFailure("INTERNAL");
			return operationWireResponse(
				failureFrame(frame, failure.code, failure.retryable),
				operationFailureStatus(failure.code),
			);
		}
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
		fetch: observeApplicationFetch(observation, operationPath, fetch),
		route,
		close,
	});
}
