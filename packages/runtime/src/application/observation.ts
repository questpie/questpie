import { randomUUID } from "node:crypto";

import type { QuestpieObservability } from "questpie";
import { QUESTPIE_OBSERVABILITY_PACKAGE_VERSION } from "questpie/internal/observability";

import {
	createObservationKernel,
	type ExecutionEventV2,
	type ExecutionEntry,
	type HttpMethod,
	type ObservationKernel,
	type ObservationExecution,
	type ObservationEndV1,
	type ObservationScope,
	type PrincipalKind,
	retainScopeThroughResponse,
	resolveObservationHandle,
} from "../observation";
import {
	CommittedResultUnavailable,
	DeclaredOperationError,
	OperationFailure,
} from "../operation";
import { isOperationAbort } from "./operation-error";

export function createApplicationObservation(
	input: Readonly<{
		applicationIdentity: string;
		runtimeBuildDigest: string;
		questpieVersion?: string;
		signalProjectionDigest?: string;
		observability?: QuestpieObservability;
		events?: (event: ExecutionEventV2) => void;
		wallClock?: () => Date;
		createRuntimeInstanceId?: () => string;
	}>,
) {
	if (input.observability === undefined && input.events === undefined)
		return null;
	const runtimeInstanceId = (input.createRuntimeInstanceId ?? randomUUID)();
	const signalProjectionDigest = input.signalProjectionDigest;
	let adapter;
	if (input.observability !== undefined) {
		if (
			signalProjectionDigest === undefined ||
			input.questpieVersion !== QUESTPIE_OBSERVABILITY_PACKAGE_VERSION
		)
			throw new TypeError(
				"Runtime observation artifact binding is unavailable",
			);
		adapter = resolveObservationHandle(input.observability, {
			format: "questpie.observation-runtime-metadata",
			version: 1,
			applicationIdentity: input.applicationIdentity,
			runtimeBuildDigest: input.runtimeBuildDigest,
			runtimeInstanceId,
			signalProjectionDigest,
			questpieVersion: input.questpieVersion,
		});
	}
	return createObservationKernel({
		applicationIdentity: input.applicationIdentity,
		runtimeBuildDigest: input.runtimeBuildDigest,
		...(adapter === undefined ? {} : { adapter }),
		events: input.events,
		wallClock: input.wallClock,
		createRuntimeInstanceId: () => runtimeInstanceId,
	});
}

export function beginApplicationRuntime(
	observation: ObservationKernel | null,
): ObservationScope | null {
	if (observation === null) return null;
	return observation.beginScope(null, {
		kind: "runtime",
		principalKind: "service",
		trace: { kind: "root" },
	});
}

export function endApplicationRuntime(
	scope: ObservationScope | null,
	input: Readonly<{
		deadlineExpired: boolean;
		error?: unknown;
	}>,
): void {
	if (scope === null) return;
	if (!("error" in input)) {
		scope.end({
			kind: "runtime",
			outcome: input.deadlineExpired ? "deadline" : "ok",
		});
		return;
	}
	const failure = applicationObservationFailure(input.error, {
		aborted: false,
		committedMutation: false,
		deadlineExpired: input.deadlineExpired,
	});
	scope.end({
		kind: "runtime",
		...failure,
		outcome:
			failure.outcome === "declared_error"
				? "framework_error"
				: failure.outcome,
	});
}

export function beginApplicationExecution(
	observation: ObservationKernel | null,
	entry: ExecutionEntry,
	principalKind: PrincipalKind,
) {
	if (observation === null) return null;
	return observation.beginExecution({
		entry,
		kind: "execution",
		principalKind,
		trace: { kind: entry === "fetch" ? "active-parent" : "root" },
	});
}

export function bindApplicationExecutionObservation(
	execution: ObservationExecution | null,
	entry: ExecutionEntry,
) {
	if (execution === null) return Object.freeze({});
	return Object.freeze({
		observation: Object.freeze({ entry, execution: execution.observation }),
	});
}

export function applicationObservationFailure(
	error: unknown,
	input: Readonly<{
		committedMutation: boolean;
		deadlineExpired: boolean;
		aborted: boolean;
	}>,
) {
	const errorCode =
		error instanceof DeclaredOperationError || error instanceof OperationFailure
			? error.code
			: undefined;
	const code = errorCode === undefined ? {} : { errorCode };
	if (
		!input.committedMutation &&
		(input.deadlineExpired ||
			(error instanceof OperationFailure && error.code === "DEADLINE_EXCEEDED"))
	)
		return { outcome: "deadline" as const, ...code };
	if (!input.committedMutation && (input.aborted || isOperationAbort(error)))
		return { outcome: "cancelled" as const, ...code };
	if (error instanceof DeclaredOperationError)
		return { outcome: "declared_error" as const, ...code };
	return { outcome: "framework_error" as const, ...code };
}

export async function runApplicationOperation<Result>(
	input: Readonly<{
		execution: ObservationExecution | null;
		entry: ExecutionEntry;
		kind: "mutation" | "query";
		principalKind: PrincipalKind;
		resourceIdentity: string;
		normalizeError(error: unknown): unknown;
		failure(error: unknown): ReturnType<typeof applicationObservationFailure>;
		use(
			observation: Readonly<{
				execution: ObservationExecution["observation"];
				operation: ObservationScope;
			}> | null,
		): Promise<Result>;
	}>,
): Promise<Result> {
	const scope = input.execution
		? input.execution.observation.begin({
				entry: input.entry,
				kind: input.kind,
				principalKind: input.principalKind,
				resourceIdentity: input.resourceIdentity,
				trace: { kind: "active-parent" },
			})
		: null;
	let end: ObservationEndV1 = { kind: input.kind, outcome: "ok" };
	const use = () =>
		input.use(
			scope && input.execution
				? {
						execution: input.execution.observation,
						operation: scope,
					}
				: null,
		);
	try {
		return await (scope ? scope.run(use) : use());
	} catch (error) {
		const normalized = input.normalizeError(error);
		if (
			input.kind === "mutation" &&
			normalized instanceof CommittedResultUnavailable
		) {
			scope?.event({
				kind: "operation.post_commit_ambiguous",
				transactionId: normalized.payload.transactionId,
			});
			end = { kind: "mutation", outcome: "ambiguous" };
		} else end = { kind: input.kind, ...input.failure(normalized) };
		throw normalized;
	} finally {
		scope?.end(end);
	}
}

const HTTP_METHODS = new Set<HttpMethod>([
	"CONNECT",
	"DELETE",
	"GET",
	"HEAD",
	"OPTIONS",
	"PATCH",
	"POST",
	"PUT",
	"TRACE",
]);

function observedHttpRequest(request: Request) {
	const url = new URL(request.url);
	const scheme =
		url.protocol === "http:"
			? ("http" as const)
			: url.protocol === "https:"
				? ("https" as const)
				: null;
	const method = request.method.toUpperCase();
	return Object.freeze({
		method: HTTP_METHODS.has(method as HttpMethod)
			? (method as HttpMethod)
			: ("_OTHER" as const),
		scheme,
		url,
	});
}

type OwnedHttpResponse = Readonly<{
	outcome: "ok" | "framework_error" | "deadline";
	response: Response;
	signal: AbortSignal;
	finalize(): void;
	retainControl: boolean;
	abortOutcome(): "cancelled" | "deadline";
}>;

/** Owns one matched authored Route from ingress through response-body completion. */
export async function observeApplicationRoute(
	observation: ObservationKernel | null,
	request: Request,
	routeTemplate: string,
	execute: () => Promise<OwnedHttpResponse>,
): Promise<Response> {
	if (observation === null) {
		const owned = await execute();
		if (!owned.retainControl) return owned.response;
		return retainScopeThroughResponse(
			null,
			owned.response,
			"route",
			owned.signal,
			owned.finalize,
			{ complete: owned.outcome, abort: owned.abortOutcome },
		);
	}
	const http = observedHttpRequest(request);
	if (http.scheme === null) {
		const owned = await execute();
		if (!owned.retainControl) return owned.response;
		return retainScopeThroughResponse(
			null,
			owned.response,
			"route",
			owned.signal,
			owned.finalize,
			{ complete: owned.outcome, abort: owned.abortOutcome },
		);
	}
	const ingressTrace = observation.extract({
		traceparent: request.headers.get("traceparent"),
		tracestate: request.headers.get("tracestate"),
	});
	const scope = observation.beginScope(null, {
		kind: "route",
		method: http.method,
		principalKind: null,
		routeTemplate,
		scheme: http.scheme,
		suppressHttp: true,
		trace: ingressTrace ?? { kind: "root" },
	});
	try {
		const owned = await scope.run(execute);
		return retainScopeThroughResponse(
			scope,
			owned.response,
			"route",
			owned.signal,
			owned.finalize,
			{ complete: owned.outcome, abort: owned.abortOutcome },
		);
	} catch (error) {
		const failure = applicationObservationFailure(error, {
			aborted: request.signal.aborted,
			committedMutation: false,
			deadlineExpired: false,
		});
		const outcome =
			failure.outcome === "cancelled" || failure.outcome === "deadline"
				? failure.outcome
				: "framework_error";
		scope.end({
			httpResponseStatusCode: null,
			kind: "route",
			outcome,
		});
		throw error;
	}
}

/** Owns a Route-router response that matched no authored method. */
export function observeApplicationUnmatchedFetch(
	observation: ObservationKernel | null,
	request: Request,
	execute: () => Promise<Response>,
): Promise<Response> {
	return observeApplicationHttpFetch(
		observation,
		request,
		() => "unmatched",
		() => execute(),
	);
}

async function observeApplicationHttpFetch(
	observation: ObservationKernel | null,
	request: Request,
	requestKind: (
		http: ReturnType<typeof observedHttpRequest>,
	) => "generated_operation" | "unmatched",
	execute: (request: Request) => Promise<Response>,
): Promise<Response> {
	if (observation === null) return execute(request);
	const http = observedHttpRequest(request);
	if (http.scheme === null) return execute(request);
	const ingressTrace = observation.extract({
		traceparent: request.headers.get("traceparent"),
		tracestate: request.headers.get("tracestate"),
	});
	const scope = observation.beginScope(null, {
		kind: "fetch",
		method: http.method,
		principalKind: null,
		requestKind: requestKind(http),
		scheme: http.scheme,
		suppressHttp: true,
		trace: ingressTrace ?? { kind: "root" },
	});
	try {
		const response = await scope.run(() => execute(request));
		return retainScopeThroughResponse(scope, response, "fetch", request.signal);
	} catch (error) {
		const failure = applicationObservationFailure(error, {
			aborted: request.signal.aborted,
			committedMutation: false,
			deadlineExpired: false,
		});
		const outcome =
			failure.outcome === "cancelled" || failure.outcome === "deadline"
				? failure.outcome
				: "framework_error";
		scope.end({
			httpResponseStatusCode: null,
			kind: "fetch",
			outcome,
		});
		throw error;
	}
}

export function observeApplicationFetch(
	observation: ObservationKernel | null,
	operations: readonly Readonly<{ identity: string }>[],
	execute: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
	const generatedRequests = new Set(
		operations.flatMap(({ identity }) => {
			const separator = identity.indexOf(":");
			const kind = identity.slice(0, separator);
			const name = identity.slice(separator + 1);
			if (kind === "query") return [`GET\0/_questpie/query/${name}`];
			if (kind === "mutation") return [`POST\0/_questpie/mutation/${name}`];
			if (kind === "action") return [`POST\0/_questpie/action/${name}`];
			return [];
		}),
	);
	return (request) =>
		observeApplicationHttpFetch(
			observation,
			request,
			(http) =>
				generatedRequests.has(`${http.method}\0${http.url.pathname}`)
					? "generated_operation"
					: "unmatched",
			execute,
		);
}
