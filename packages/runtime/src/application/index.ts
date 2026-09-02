import {
	principal,
	type ContextDefinition,
	type ContextInputOf,
	type Principal,
} from "questpie";

import { createApplicationRuntime } from "../execution";
import type { LiveQueryObservation } from "../live-query";
import type { MutationInvoker } from "../mutation";
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
	RuntimeApplication,
	RuntimeApplicationProgram,
	RuntimeOperations,
} from "./contracts";
import { createEventEmitter, type ExecutionEventV1 } from "./events";
import { createCanonicalPostHttp } from "./http-post";
import { createCanonicalQueryHttp } from "./http-query";
import {
	isOperationAbort,
	normalizeExecutedOperationError,
} from "./operation-error";
import { controlledRoot } from "./root";

export type { ExecutionEventV1 } from "./events";
export type {
	RuntimeExecutableBindings,
	RuntimeExecutableInventoryBinding,
	RuntimeReactionBinding,
} from "./bindings";
export type {
	RuntimeApplication,
	RuntimeApplicationProgram,
	RuntimeOperations,
} from "./contracts";

type MaybePromise<Value> = Value | Promise<Value>;

type RuntimeState = "closed" | "draining" | "ready" | "verifying";

function principalIdentity(value: Principal): string {
	return `${value.kind}:${value.id}`;
}

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
		events?: (event: ExecutionEventV1) => void;
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
	const deadlineNow = () => performance.timeOrigin + performance.now();
	let rootSequence = 0;
	let callSequence = 0;
	let closePromise: Promise<void> | undefined;
	const emit = createEventEmitter({
		application: artifacts.runtimeBuild.application,
		deploymentDigest: artifacts.runtimeBuild.runtimeExecutablesDigest,
		sink: input.events,
		now: input.now,
	});
	const emitBeforeStopped = (...event: Parameters<typeof emit>): void => {
		if (state !== "closed") emit(...event);
	};
	state = "ready";
	emit(
		{ family: "runtime", kind: "ready" },
		{
			links: [
				{
					kind: "artifact",
					id: artifacts.runtimeBuild.runtimeExecutablesDigest,
				},
			],
		},
	);

	const executeRoot = async <Result>(
		root: Readonly<{
			principal: Principal;
			context: ContextInputOf<Context>;
			signal?: AbortSignal;
			deadline?: number;
			liveQueryObservation?: LiveQueryObservation;
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
		if (state !== "ready")
			throw new OperationFailure("RUNTIME_UNAVAILABLE", true);
		if (!principal.is(root.principal)) throw new OperationFailure("NOT_FOUND");
		const principalKey = principalIdentity(root.principal);
		const active = activeByPrincipal.get(principalKey) ?? 0;
		if (active >= maximumRoots)
			throw new OperationFailure("RESOURCE_LIMIT", true);
		activeByPrincipal.set(principalKey, active + 1);
		rootSequence += 1;
		const executionId = `execution:${rootSequence}`;
		const controlled = controlledRoot({ ...root, now: deadlineNow });
		let committedMutation = false;
		rootControllers.add(controlled.controller);
		const pending = core.execution(
			{
				principal: root.principal,
				context: root.context,
				signal: controlled.controller.signal,
				deadline: root.deadline,
				liveQueryObservation: root.liveQueryObservation,
			},
			(view) =>
				use({
					view,
					invoke: async (operation, callId, options) => {
						const eventFacts = {
							executionId,
							correlationId: callId,
							principalRef: principalKey,
							links: [
								{
									kind: "operation" as const,
									id: operation.binding.identity,
								},
								{ kind: "operationCall" as const, id: callId },
							],
						};
						emitBeforeStopped(
							{
								family: "operation",
								kind: "accepted",
								operation: operation.binding.identity,
							},
							eventFacts,
						);
						try {
							let result: unknown;
							if (operation.binding.kind === "mutation") {
								if (view.mutation === undefined)
									throw new OperationFailure("INTERNAL");
								const invocation = await view.mutation(
									operation,
									callId,
									options,
								);
								committedMutation = invocation.committed;
								result = invocation.value;
							} else {
								result = await operationEngine.invokePrepared(
									operation,
									view.operation,
								);
							}
							if (controlled.deadlineExpired)
								if (!committedMutation)
									throw new OperationFailure("DEADLINE_EXCEEDED", true);
							if (controlled.controller.signal.aborted)
								if (!committedMutation)
									throw controlled.controller.signal.reason;
							emitBeforeStopped(
								{
									family: "operation",
									kind: "result",
									operation: operation.binding.identity,
								},
								eventFacts,
							);
							return result;
						} catch (error) {
							emitBeforeStopped(
								{
									family: "operation",
									kind: "failed",
									operation: operation.binding.identity,
								},
								eventFacts,
							);
							if (isOperationAbort(error)) throw error;
							throw normalizeExecutedOperationError(operation, error);
						}
					},
				}),
		);
		activeRoots.add(pending);
		try {
			const result = await pending;
			if (controlled.deadlineExpired && !committedMutation)
				throw new OperationFailure("DEADLINE_EXCEEDED", true);
			if (controlled.controller.signal.aborted && !committedMutation)
				throw controlled.controller.signal.reason;
			return result;
		} catch (error) {
			if (error instanceof CommittedResultUnavailable) throw error;
			if (controlled.deadlineExpired && !committedMutation)
				throw new OperationFailure("DEADLINE_EXCEEDED", true);
			if (controlled.controller.signal.aborted && !committedMutation)
				throw controlled.controller.signal.reason;
			throw error;
		} finally {
			activeRoots.delete(pending);
			rootControllers.delete(controlled.controller);
			controlled.dispose();
			const remaining = (activeByPrincipal.get(principalKey) ?? 1) - 1;
			if (remaining === 0) activeByPrincipal.delete(principalKey);
			else activeByPrincipal.set(principalKey, remaining);
		}
	};
	const execution: RuntimeApplication<
		ContextInputOf<Context>,
		ExecutionView
	>["execution"] = (root, use) =>
		executeRoot(root, async ({ invoke, view }) => {
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
		});
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
					execution,
				}),
			),
		);
	let realtimeCallSequence = 0;
	const realtime =
		input.program.createRealtime?.({
			artifacts,
			artifactFiles: input.artifactFiles,
			contextInput: input.program.context.input,
			resolvePrincipal: input.program.resolvePrincipal,
			evaluate: async ({
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
					},
					({ invoke }) => invoke(prepared, `realtime:${realtimeCallSequence}`),
				);
			},
			onObservedPlan: input.program.onLiveQueryObserved,
			coordinator: input.program.liveQueryCoordinator,
		}) ?? null;
	const canonicalQuery = createCanonicalQueryHttp<
		ContextInputOf<Context>,
		OperationView
	>({
		application: artifacts.runtimeBuild.application,
		clientContractDigest: artifacts.runtimeBuild.clientContractDigest,
		httpContractDigest: artifacts.httpContract.digest,
		maximumResponseBytes: artifacts.httpContract.limits.responseBytes,
		contextCodec: input.program.context.input as never,
		operations: artifacts.httpContract.operations,
		prepare: operationEngine.prepare,
		resolvePrincipal: async (request, signal) =>
			input.program.resolvePrincipal(request, signal),
		execute: ({
			principal: caller,
			context,
			operation,
			callId,
			signal,
			deadline,
		}) =>
			executeRoot(
				{ principal: caller, context, signal, deadline },
				({ invoke }) => invoke(operation, callId),
			),
		now: deadlineNow,
	});
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
		executeMutation: ({
			principal: caller,
			context,
			operation,
			callId,
			signal,
			deadline,
		}) =>
			executeRoot(
				{ principal: caller, context, signal, deadline },
				({ invoke }) => invoke(operation, callId),
			),
		executeAction: ({
			principal: caller,
			context,
			identity,
			operationInput,
			effectKey,
			callId,
			signal,
			timeoutMilliseconds,
			deadline,
		}) =>
			executeRoot(
				{ principal: caller, context, signal, deadline },
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
							const nested = operationEngine.prepare(
								nestedIdentity,
								nestedInput,
							);
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
						identity,
						input: operationInput,
						effectKey,
						callId,
						...(timeoutMilliseconds === undefined
							? {}
							: { timeoutMilliseconds }),
						execution: await view.execution(),
						operations,
					});
				},
			),
		now: deadlineNow,
	});

	const fetch = async (request: Request): Promise<Response> => {
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
		emit({ family: "runtime", kind: "drainStarted" });
		closePromise = (async () => {
			let timedOut = false;
			let timeoutEmitted = false;
			let shutdownFailure: unknown;
			const settle = async (work: Promise<unknown>): Promise<void> => {
				const remaining = Math.max(0, deadlineAt - Date.now());
				if (remaining === 0) {
					timedOut = true;
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
					timedOut = true;
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
				emit({ family: "runtime", kind: "drainTimedOut" });
				timeoutEmitted = true;
				for (const controller of rootControllers)
					controller.abort(new DOMException("Runtime draining", "AbortError"));
			}
			if (realtime) await settlePhase(realtime.drain(closeInput));
			if (input.program.liveQueryCoordinator)
				await settlePhase(input.program.liveQueryCoordinator.drain(closeInput));
			await settlePhase(core.close());
			state = "closed";
			if (timedOut && !timeoutEmitted)
				emit({ family: "runtime", kind: "drainTimedOut" });
			emit({ family: "runtime", kind: "stopped" });
			if (shutdownFailure !== undefined) throw shutdownFailure;
		})();
		return closePromise;
	};

	return Object.freeze({
		applicationService: core.applicationService,
		execution,
		fetch,
		route,
		close,
	});
}
