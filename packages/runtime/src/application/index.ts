import {
	principal,
	type ContextDefinition,
	type ContextInputOf,
	type Principal,
} from "questpie";

import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { createApplicationRuntime, type RuntimeProgram } from "../execution";
import type { LiveQueryObservation } from "../live-query";
import type { MutationInvoker } from "../mutation";
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
import { decodeRuntimeArtifacts, type RuntimeArtifactsV1 } from "./artifacts";
import {
	validateRuntimeExecutableBindings,
	type RuntimeExecutableBindings,
} from "./bindings";
import { createEventEmitter, type ExecutionEventV1 } from "./events";
import type {
	LiveQueryCoordinator,
	RealtimeCarrierObservedPlan,
} from "./realtime";
import {
	matchesRetainedClientPair,
	retainClientPairs,
	type RetainedClientPair,
} from "./retained-clients";
import { controlledRoot } from "./root";
import type { RuntimeRealtimeFactory } from "./runtime-realtime";
import { studioArtifactResponse, studioBundleResponse } from "./studio-mount";

export type { ExecutionEventV1 } from "./events";
export type {
	RuntimeExecutableBindings,
	RuntimeExecutableInventoryBinding,
	RuntimeReactionBinding,
} from "./bindings";

type MaybePromise<Value> = Value | Promise<Value>;

export interface RuntimeApplicationProgram<
	Context extends ContextDefinition,
	OperationView,
	ExecutionView = OperationView,
> extends RuntimeProgram<Context, OperationView> {
	readonly projectExecution?: RuntimeProgram<Context, ExecutionView>["project"];
	readonly projectMutation?: (
		scope: Parameters<RuntimeProgram<Context, OperationView>["project"]>[0],
	) => MaybePromise<MutationInvoker<OperationView>>;
	readonly resolvePrincipal: (
		request: Request,
	) => MaybePromise<Principal | null>;
	readonly verifyReadiness?: (
		artifacts: RuntimeArtifactsV1,
	) => MaybePromise<void>;
	readonly onLiveQueryObserved?: (
		input: RealtimeCarrierObservedPlan,
	) => MaybePromise<void>;
	readonly liveQueryCoordinator?: LiveQueryCoordinator;
	readonly createRealtime?: RuntimeRealtimeFactory<ContextInputOf<Context>>;
}

export interface RuntimeOperations {
	invoke(
		operation: string,
		input: unknown,
		options?: Readonly<{
			callId?: string;
			signal?: AbortSignal;
			deadline?: number;
		}>,
	): Promise<unknown>;
}

export interface RuntimeApplication<Input, ExecutionView> {
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Input;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (
			scope: RuntimeOperations & Readonly<{ execution: ExecutionView }>,
		) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	fetch(request: Request): Promise<Response>;
	close(): Promise<void>;
}

type RuntimeState = "closed" | "draining" | "ready" | "verifying";

function principalIdentity(value: Principal): string {
	return `${value.kind}:${value.id}`;
}

function isAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
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
		retainedClients?: readonly RetainedClientPair[];
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
	const artifacts = decodeRuntimeArtifacts(input.artifacts);
	verifyRuntimeArtifactFiles(artifacts, input.artifactFiles);
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
		artifacts.operationContracts.operations,
	);
	const networkOperations = new Set(
		artifacts.wireContract.operations.map(({ identity }) => identity),
	);
	await input.program.verifyReadiness?.(artifacts);
	try {
		await input.program.liveQueryCoordinator?.start();
	} catch (error) {
		await input.program.liveQueryCoordinator?.drain().catch(() => {});
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
	const drainMilliseconds = input.drainMilliseconds ?? 30_000;
	const nowMilliseconds = () => (input.now?.() ?? new Date()).getTime();
	let rootSequence = 0;
	let callSequence = 0;
	let closePromise: Promise<void> | undefined;
	const emit = createEventEmitter({
		application: artifacts.runtimeBuild.application,
		deploymentDigest: artifacts.runtimeBuild.runtimeExecutablesDigest,
		sink: input.events,
		now: input.now,
	});
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
		const controlled = controlledRoot({ ...root, now: nowMilliseconds });
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
						emit(
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
							emit(
								{
									family: "operation",
									kind: "result",
									operation: operation.binding.identity,
								},
								eventFacts,
							);
							return result;
						} catch (error) {
							emit(
								{
									family: "operation",
									kind: "failed",
									operation: operation.binding.identity,
								},
								eventFacts,
							);
							if (isAbort(error)) throw error;
							throw normalizeOperationError(error);
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
			const scope = Object.freeze({
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
				execution: await view.execution(),
			});
			return use(scope);
		});
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

	const fetch = async (request: Request): Promise<Response> => {
		if (realtime) {
			const response = await realtime.fetch(request);
			if (response) return response;
		}
		// The same-origin Studio shell. It claims one path and returns null for
		// every other, so the Operation wire below is unaffected.
		const studio = await studioBundleResponse(request);
		if (studio) return studio;
		const studioArtifacts = await studioArtifactResponse(
			request,
			input.artifactFiles,
		);
		if (studioArtifacts) return studioArtifacts;
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
		const currentV2 =
			frame.clientContractDigest ===
				artifacts.runtimeBuild.clientContractDigest &&
			frame.wireDigest === artifacts.wireContract.digest;
		const currentV1 =
			artifacts.wireContract.version === 2 &&
			frame.clientContractDigest ===
				artifacts.wireContract.compatibility.clientContractDigest &&
			frame.wireDigest === artifacts.wireContract.compatibility.wireV1Digest;
		const retainedV1 =
			!currentV2 &&
			(currentV1 ||
				matchesRetainedClientPair(
					retainedClients,
					frame.clientContractDigest,
					frame.wireDigest,
				));
		if (!currentV2 && !retainedV1)
			return operationWireResponse(rejectionFrame("CLIENT_OUTDATED"), 409);
		if (retainedV1) {
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
		let prepared: PreparedOperation<OperationView>;
		let contextInput: ContextInputOf<Context>;
		try {
			prepared = operationEngine.prepare(frame.operation, frame.input);
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
		} catch {
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
						frame.timeoutMilliseconds === null
							? undefined
							: nowMilliseconds() + frame.timeoutMilliseconds,
				},
				({ invoke }) => invoke(prepared, frame.callId),
			);
			const framed = resultFrame(
				frame,
				encodeRuntimeCodec(prepared.output, payload),
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
			if (isAbort(error)) throw error;
			let operationError: unknown = error;
			if (error instanceof DeclaredOperationError) {
				try {
					const declared = encodeDeclaredOperationError(prepared, error);
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

	const close = (): Promise<void> => {
		if (closePromise) return closePromise;
		state = "draining";
		realtime?.beginDrain();
		emit({ family: "runtime", kind: "drainStarted" });
		closePromise = (async () => {
			let timedOut = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			if (activeRoots.size > 0) {
				await Promise.race([
					Promise.allSettled(activeRoots),
					new Promise<void>((resolve) => {
						timer = setTimeout(() => {
							timedOut = true;
							resolve();
						}, drainMilliseconds);
					}),
				]);
			}
			if (timer !== undefined) clearTimeout(timer);
			if (timedOut) {
				emit({ family: "runtime", kind: "drainTimedOut" });
				for (const controller of rootControllers)
					controller.abort(new DOMException("Runtime draining", "AbortError"));
				await Promise.allSettled(activeRoots);
			}
			await realtime?.drain();
			await input.program.liveQueryCoordinator?.drain();
			await core.close();
			state = "closed";
			emit({ family: "runtime", kind: "stopped" });
		})();
		return closePromise;
	};

	return Object.freeze({ execution, fetch, close });
}
