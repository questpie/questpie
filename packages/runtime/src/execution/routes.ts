import {
	principal,
	type Principal,
	type ServiceDefinition,
	type ServiceDependencyMap,
	type ServiceInstance,
} from "questpie";

import {
	assertOperationAdmission,
	type OperationAdmission,
	OperationAdmissionError,
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
			params: Readonly<Record<string, string>>;
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
	code:
		| "CREDENTIALS_UNAVAILABLE"
		| "FORBIDDEN"
		| "INTERNAL"
		| "UNAUTHENTICATED",
	status: 401 | 403 | 500 | 503,
	retryable = false,
): Response {
	return Response.json(
		{ error: { code, retryable } },
		{ status, headers: { "cache-control": "no-store" } },
	);
}

export function createRuntimeRouteExecutor<
	Input,
	ExecutionView,
	RouteView,
	CredentialService extends AnyCredentialService = AnyCredentialService,
>(
	input: Readonly<{
		runtime: ApplicationRuntime<Input, ExecutionView>;
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
					params: Object.freeze({}),
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
			if (!binding) return null;
			const caller = await resolveFetchPrincipal(binding, request);
			if (caller instanceof Response) return caller;
			try {
				return await execute(binding, request, caller);
			} catch {
				return failureResponse("INTERNAL", 500);
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
