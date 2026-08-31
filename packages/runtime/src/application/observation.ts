import type { QuestpieObservability } from "questpie";

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
		observability?: QuestpieObservability;
		events?: (event: ExecutionEventV2) => void;
		wallClock?: () => Date;
	}>,
) {
	if (input.observability === undefined && input.events === undefined)
		return null;
	return createObservationKernel({
		applicationIdentity: input.applicationIdentity,
		runtimeBuildDigest: input.runtimeBuildDigest,
		...(input.observability === undefined
			? {}
			: { adapter: resolveObservationHandle(input.observability) }),
		events: input.events,
		wallClock: input.wallClock,
	});
}

export function beginApplicationExecution(
	observation: ObservationKernel | null,
	entry: ExecutionEntry | undefined,
	principalKind: PrincipalKind,
) {
	if (observation === null || entry === undefined) return null;
	return observation.beginExecution({
		entry,
		kind: "execution",
		principalKind,
		trace: { kind: entry === "fetch" ? "active-parent" : "root" },
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
	if (
		!input.committedMutation &&
		(input.aborted || isOperationAbort(error))
	)
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

export function observeApplicationFetch(
	observation: ObservationKernel | null,
	operationPath: string,
	execute: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
	if (observation === null) return execute;
	return async (request) => {
		const url = new URL(request.url);
		const scheme =
			url.protocol === "http:"
				? ("http" as const)
				: url.protocol === "https:"
					? ("https" as const)
					: null;
		if (scheme === null) return execute(request);
		const ingressTrace = observation.extract({
			traceparent: request.headers.get("traceparent"),
			tracestate: request.headers.get("tracestate"),
		});
		const method = request.method.toUpperCase();
		const scope = observation.beginScope(null, {
			kind: "fetch",
			method: HTTP_METHODS.has(method as HttpMethod)
				? (method as HttpMethod)
				: "_OTHER",
			principalKind: null,
			requestKind:
				method === "POST" && url.pathname === operationPath
					? "generated_operation"
					: "unmatched",
			scheme,
			suppressHttp: true,
			trace: ingressTrace ?? { kind: "root" },
		});
		try {
			const response = await scope.run(() => execute(request));
			return retainScopeThroughResponse(
				scope,
				response,
				"fetch",
				request.signal,
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
				kind: "fetch",
				outcome,
			});
			throw error;
		}
	};
}
