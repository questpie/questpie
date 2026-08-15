import {
	principal,
	type ContextDefinition,
	type ContextInputOf,
	type Principal,
} from "questpie";

import { createApplicationRuntime, type RuntimeProgram } from "../execution";
import {
	createOperationEngine,
	OperationFailure,
	type PreparedOperation,
} from "../operation";
import { readBoundedRequestBody } from "../operation/body";
import {
	decodeOperationWireRequest,
	failureFrame,
	operationMediaType,
	operationFailureStatus,
	operationPath,
	operationWireResponse,
	rejectionFrame,
	resultFrame,
} from "../operation/wire";
import { verifyRuntimeArtifactFiles } from "./artifact-files";
import { decodeRuntimeArtifacts, type RuntimeArtifactsV1 } from "./artifacts";
import {
	validateRuntimeExecutableBindings,
	type RuntimeExecutableBindings,
} from "./bindings";
import { createEventEmitter, type ExecutionEventV1 } from "./events";
import { controlledRoot } from "./root";

export type { ExecutionEventV1 } from "./events";
export type {
	RuntimeExecutableBindings,
	RuntimeExecutableInventoryBinding,
} from "./bindings";

type MaybePromise<Value> = Value | Promise<Value>;

export interface RuntimeApplicationProgram<
	Context extends ContextDefinition,
	View,
> extends RuntimeProgram<Context, View> {
	readonly resolvePrincipal: (
		request: Request,
	) => MaybePromise<Principal | null>;
	readonly verifyReadiness?: (
		artifacts: RuntimeArtifactsV1,
	) => MaybePromise<void>;
}

export interface RuntimeOperations {
	invoke(operation: string, input: unknown): Promise<unknown>;
}

export interface RuntimeApplication<Input> {
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Input;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (operations: RuntimeOperations) => MaybePromise<Result>,
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
	View,
>(
	input: Readonly<{
		artifacts: unknown;
		artifactFiles: Readonly<Record<string, Uint8Array | string>>;
		serverExports: Readonly<Record<string, unknown>>;
		bindings: RuntimeExecutableBindings<View>;
		program: RuntimeApplicationProgram<Context, View>;
		drainMilliseconds?: number;
		maximumActiveRootsPerPrincipal?: number;
		events?: (event: ExecutionEventV1) => void;
		now?: () => Date;
	}>,
): Promise<RuntimeApplication<ContextInputOf<Context>>> {
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
	const queryBindings = validateRuntimeExecutableBindings(
		artifacts,
		input.bindings,
		input.serverExports,
		input.program as RuntimeApplicationProgram<ContextDefinition, View>,
	);
	const operationEngine = createOperationEngine(
		queryBindings,
		artifacts.wireContract.operations,
	);
	await input.program.verifyReadiness?.(artifacts);
	const core = createApplicationRuntime(input.program);
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
		}>,
		use: (
			input: Readonly<{
				invoke(
					operation: PreparedOperation<View>,
					callId: string,
				): Promise<unknown>;
				view: View;
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
		rootControllers.add(controlled.controller);
		const pending = core.execution(
			{
				principal: root.principal,
				context: root.context,
				signal: controlled.controller.signal,
				deadline: root.deadline,
			},
			(view) =>
				use({
					view,
					invoke: async (operation, callId) => {
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
							const result = await operationEngine.invokePrepared(
								operation,
								view,
							);
							if (controlled.deadlineExpired)
								throw new OperationFailure("DEADLINE_EXCEEDED", true);
							if (controlled.controller.signal.aborted)
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
							throw error;
						}
					},
				}),
		);
		activeRoots.add(pending);
		try {
			const result = await pending;
			if (controlled.deadlineExpired)
				throw new OperationFailure("DEADLINE_EXCEEDED", true);
			if (controlled.controller.signal.aborted)
				throw controlled.controller.signal.reason;
			return result;
		} catch (error) {
			if (controlled.deadlineExpired)
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

	const execution: RuntimeApplication<ContextInputOf<Context>>["execution"] = (
		root,
		use,
	) =>
		executeRoot(root, ({ invoke }) => {
			const operations = Object.freeze({
				invoke: (identity: string, operationInput: unknown) => {
					const prepared = operationEngine.prepare(identity, operationInput);
					callSequence += 1;
					return invoke(prepared, `direct:${callSequence}`);
				},
			});
			return use(operations);
		});

	const fetch = async (request: Request): Promise<Response> => {
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
		if (
			frame.clientContractDigest !==
				artifacts.runtimeBuild.clientContractDigest ||
			frame.wireDigest !== artifacts.wireContract.digest
		)
			return operationWireResponse(rejectionFrame("CLIENT_OUTDATED"), 409);
		let prepared: PreparedOperation<View>;
		try {
			prepared = operationEngine.prepare(frame.operation, frame.input);
		} catch (error) {
			const failure =
				error instanceof OperationFailure
					? error
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
					context: frame.context as ContextInputOf<Context>,
					signal: request.signal,
					deadline:
						frame.timeoutMilliseconds === null
							? undefined
							: nowMilliseconds() + frame.timeoutMilliseconds,
				},
				({ invoke }) => invoke(prepared, frame.callId),
			);
			const framed = resultFrame(frame, payload);
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
			if (request.signal.aborted) throw request.signal.reason;
			if (isAbort(error)) throw error;
			const failure =
				error instanceof OperationFailure
					? error
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
			await core.close();
			state = "closed";
			emit({ family: "runtime", kind: "stopped" });
		})();
		return closePromise;
	};

	return Object.freeze({ execution, fetch, close });
}
