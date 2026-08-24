import {
	principal,
	type Principal,
	type ServiceDefinition,
	type ServiceDependencyMap,
	type ServiceInstance,
} from "questpie";

import {
	assertOperationAdmission,
	CommittedResultUnavailable,
	type OperationAdmission,
	OperationAdmissionError,
	OperationFailure,
	operationFailureStatus,
} from "../operation";
import type { ApplicationRuntime, RouteExecutionScope } from "./index";

type AnyCredentialService = ServiceDefinition<
	string,
	"application",
	"external",
	ServiceDependencyMap,
	unknown
>;

type MaybePromise<Value> = Value | Promise<Value>;

export type RuntimeCredentialOutcome =
	| Readonly<{ kind: "anonymous" }>
	| Readonly<{ kind: "resolved"; principal: Principal }>
	| Readonly<{ kind: "unavailable" }>;

export type RuntimeCredentialBinding<
	Service extends AnyCredentialService = AnyCredentialService,
> = Readonly<{
	service: Service;
	resolve(
		input: Readonly<{
			request: Request;
			service: ServiceInstance<Service>;
		}>,
	): MaybePromise<RuntimeCredentialOutcome>;
}>;

export type RuntimeRouteBinding<View> = Readonly<{
	identity: `route:${string}`;
	method: "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";
	path: `/${string}`;
	credentials: "application" | "none";
	admission: OperationAdmission;
	execute(
		input: Readonly<{
			request: Request;
			ctx: View;
		}>,
	): MaybePromise<Response>;
}>;

export interface RuntimeRouteExecutor {
	fetch(request: Request): Promise<Response | null>;
	direct(
		identity: `route:${string}`,
		input: Readonly<{
			request: Request;
			execution: Readonly<{ principal: Principal }>;
		}>,
	): Promise<Response>;
}

function failureResponse(
	code: string,
	status: number,
	retryable = false,
): Response {
	return Response.json(
		{ error: { code, retryable } },
		{ status, headers: { "cache-control": "no-store" } },
	);
}

function executionFailureResponse(error: unknown): Response {
	if (error instanceof CommittedResultUnavailable)
		return failureResponse(
			error.code,
			operationFailureStatus(error.code),
			error.retryable,
		);
	if (error instanceof OperationFailure)
		return failureResponse(
			error.code,
			operationFailureStatus(error.code),
			error.retryable,
		);
	return failureResponse("INTERNAL", 500);
}

export function createRuntimeRouteExecutor<
	Input,
	ExecutionView,
	RouteView,
	CredentialService extends AnyCredentialService = AnyCredentialService,
>(
	input: Readonly<{
		runtime: Pick<
			ApplicationRuntime<Input, ExecutionView>,
			"applicationService" | "route"
		>;
		bindings: readonly RuntimeRouteBinding<RouteView>[];
		credentials?: RuntimeCredentialBinding<CredentialService>;
		project(
			scope: RouteExecutionScope<Input, ExecutionView>,
		): MaybePromise<RouteView>;
	}>,
): RuntimeRouteExecutor {
	const bindings = input.bindings.map((binding) =>
		Object.freeze({ ...binding }),
	);
	const byIdentity = new Map(
		bindings.map((binding) => [binding.identity, binding]),
	);
	const byMount = new Map(
		bindings.map((binding) => [`${binding.method} ${binding.path}`, binding]),
	);
	const allowedMethodsByPath = new Map<string, Set<string>>();
	for (const binding of bindings) {
		const methods = allowedMethodsByPath.get(binding.path) ?? new Set<string>();
		methods.add(binding.method);
		allowedMethodsByPath.set(binding.path, methods);
	}
	if (byIdentity.size !== bindings.length)
		throw new TypeError("Runtime Route binding identity is duplicate");
	if (byMount.size !== bindings.length)
		throw new TypeError("Runtime Route binding mount is duplicate");

	const execute = async (
		binding: RuntimeRouteBinding<RouteView>,
		request: Request,
		caller: Principal,
	): Promise<Response> => {
		if (!principal.is(caller))
			throw new TypeError("Route requires a trusted Principal");
		try {
			assertOperationAdmission(binding.admission, {
				authority: { kind: "ordinary" },
				principal: caller,
			});
		} catch (error) {
			if (error instanceof OperationAdmissionError)
				return error.code === "unauthenticated"
					? failureResponse("UNAUTHENTICATED", 401)
					: failureResponse("FORBIDDEN", 403);
			throw error;
		}
		return input.runtime.route(
			{ principal: caller, signal: request.signal },
			async (scope) => {
				const response = await binding.execute({
					request,
					ctx: await input.project(scope),
				});
				if (!(response instanceof Response))
					throw new TypeError("Route handler must return a Response");
				return response;
			},
		);
	};

	const resolveFetchPrincipal = async (
		binding: RuntimeRouteBinding<RouteView>,
		request: Request,
	): Promise<Principal | Response> => {
		if (binding.credentials === "none" || !input.credentials)
			return principal.anonymous();
		let outcome: RuntimeCredentialOutcome;
		try {
			const service = await input.runtime.applicationService(
				input.credentials.service,
			);
			outcome = await input.credentials.resolve({ request, service });
		} catch {
			if (request.signal.aborted) throw request.signal.reason;
			return failureResponse("INTERNAL", 500);
		}
		if (outcome.kind === "unavailable")
			return failureResponse("CREDENTIALS_UNAVAILABLE", 503, true);
		if (outcome.kind === "anonymous") return principal.anonymous();
		if (!principal.is(outcome.principal))
			return failureResponse("INTERNAL", 500);
		return outcome.principal;
	};

	return Object.freeze({
		fetch: async (request: Request): Promise<Response | null> => {
			const pathname = new URL(request.url).pathname;
			const binding = byMount.get(`${request.method} ${pathname}`);
			if (!binding) {
				const allowed = allowedMethodsByPath.get(pathname);
				if (!allowed) return null;
				return new Response(null, {
					status: 405,
					headers: {
						allow: [...allowed].sort().join(", "),
						"cache-control": "no-store",
					},
				});
			}
			const caller = await resolveFetchPrincipal(binding, request);
			if (caller instanceof Response) return caller;
			try {
				return await execute(binding, request, caller);
			} catch (error) {
				if (request.signal.aborted) throw request.signal.reason;
				return executionFailureResponse(error);
			}
		},
		direct: (
			identity: `route:${string}`,
			routeInput: Readonly<{
				request: Request;
				execution: Readonly<{ principal: Principal }>;
			}>,
		) => {
			const binding = byIdentity.get(identity);
			if (!binding)
				return Promise.reject(new TypeError("Route binding not found"));
			return execute(
				binding,
				routeInput.request,
				routeInput.execution.principal,
			);
		},
	});
}
