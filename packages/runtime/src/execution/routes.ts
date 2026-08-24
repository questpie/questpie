import {
	principal,
	type CredentialResolution,
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

export type RuntimeCredentialOutcome = CredentialResolution;

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
	limits?: Readonly<{ bodyBytes: number; durationMs: number }>;
	execute(
		input: Readonly<{
			request: Request;
			ctx: View &
				Readonly<{
					params: Readonly<Record<string, string>>;
					deadline: number;
				}>;
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
	if (error instanceof RouteResourceLimitError)
		return failureResponse(
			"RESOURCE_LIMIT",
			error.status === 429 ? 429 : 413,
			error.status === 429,
		);
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

class RouteResourceLimitError extends Error {
	readonly status: 413 | 429;

	constructor(status: 413 | 429) {
		super("Route resource limit exceeded");
		this.name = "RouteResourceLimitError";
		this.status = status;
	}
}

type RoutePathSegment =
	| Readonly<{ kind: "literal"; value: string }>
	| Readonly<{ kind: "parameter"; name: string }>
	| Readonly<{ kind: "wildcard"; name: string }>;

function parseRoutePath(path: string): readonly RoutePathSegment[] {
	if (path === "/") return [];
	return path
		.slice(1)
		.split("/")
		.map((segment) =>
			segment.startsWith(":")
				? { kind: "parameter" as const, name: segment.slice(1) }
				: segment.startsWith("*")
					? {
							kind: "wildcard" as const,
							name: segment.slice(1) || "wildcard",
						}
					: { kind: "literal" as const, value: segment },
		);
}

function matchRoutePath(
	segments: readonly RoutePathSegment[],
	pathname: string,
): Readonly<Record<string, string>> | null {
	const values = pathname === "/" ? [] : pathname.slice(1).split("/");
	const params: Record<string, string> = {};
	let index = 0;
	for (const segment of segments) {
		if (segment.kind === "wildcard") {
			try {
				params[segment.name] = values
					.slice(index)
					.map((value) => decodeURIComponent(value))
					.join("/");
			} catch {
				return null;
			}
			return Object.freeze(params);
		}
		const value = values[index];
		if (value === undefined) return null;
		if (segment.kind === "literal") {
			if (segment.value !== value) return null;
		} else {
			try {
				params[segment.name] = decodeURIComponent(value);
			} catch {
				return null;
			}
		}
		index += 1;
	}
	return index === values.length ? Object.freeze(params) : null;
}

function routeSpecificity(segments: readonly RoutePathSegment[]): string {
	return segments
		.map((segment) =>
			segment.kind === "literal"
				? "2"
				: segment.kind === "parameter"
					? "1"
					: "0",
		)
		.join("");
}

function boundedRouteRequest(
	request: Request,
	limit: number,
): Readonly<{ request: Request; exceeded(): boolean }> {
	const contentLength = request.headers.get("content-length");
	if (
		contentLength !== null &&
		/^\d+$/.test(contentLength) &&
		Number(contentLength) > limit
	)
		throw new RouteResourceLimitError(413);
	if (!request.body) return { request, exceeded: () => false };
	const reader = request.body.getReader();
	let bytes = 0;
	let exceeded = false;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			const next = await reader.read();
			if (next.done) {
				controller.close();
				return;
			}
			bytes += next.value.byteLength;
			if (bytes > limit) {
				exceeded = true;
				await reader.cancel(new RouteResourceLimitError(413));
				controller.error(new RouteResourceLimitError(413));
				return;
			}
			controller.enqueue(next.value);
		},
		cancel: (reason) => reader.cancel(reason),
	});
	return {
		request: new Request(request, { body, duplex: "half" } as RequestInit),
		exceeded: () => exceeded,
	};
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
	const bindings = input.bindings
		.map((binding) => {
			const segments = parseRoutePath(binding.path);
			return Object.freeze({
				...binding,
				segments,
				specificity: routeSpecificity(segments),
			});
		})
		.sort((left, right) => right.specificity.localeCompare(left.specificity));
	const byIdentity = new Map(
		bindings.map((binding) => [binding.identity, binding]),
	);
	const mounts = new Set(
		bindings.map((binding) => `${binding.method} ${binding.path}`),
	);
	if (byIdentity.size !== bindings.length)
		throw new TypeError("Runtime Route binding identity is duplicate");
	if (mounts.size !== bindings.length)
		throw new TypeError("Runtime Route binding mount is duplicate");

	const execute = async (
		binding: RuntimeRouteBinding<RouteView>,
		request: Request,
		caller: Principal,
		params: Readonly<Record<string, string>>,
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
		const limits = binding.limits ?? {
			bodyBytes: Number.MAX_SAFE_INTEGER,
			durationMs: Number.MAX_SAFE_INTEGER,
		};
		const deadline = Date.now() + limits.durationMs;
		const controller = new AbortController();
		const onAbort = () => controller.abort(request.signal.reason);
		if (request.signal.aborted) onAbort();
		else request.signal.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(
			() => controller.abort(new RouteResourceLimitError(429)),
			Math.min(limits.durationMs, 2_147_483_647),
		);
		const bounded = boundedRouteRequest(
			new Request(request, { signal: controller.signal }),
			limits.bodyBytes,
		);
		try {
			return await input.runtime.route(
				{ principal: caller, signal: controller.signal, deadline },
				async (scope) => {
					const projected = await input.project(scope);
					const response = await binding.execute({
						request: bounded.request,
						ctx: Object.freeze({ ...projected, params, deadline }),
					});
					if (bounded.exceeded()) throw new RouteResourceLimitError(413);
					if (!(response instanceof Response))
						throw new TypeError("Route handler must return a Response");
					return response;
				},
			);
		} finally {
			clearTimeout(timer);
			request.signal.removeEventListener("abort", onAbort);
		}
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
			const matches = bindings
				.map((binding) => ({
					binding,
					params: matchRoutePath(binding.segments, pathname),
				}))
				.filter((match) => match.params !== null);
			const match = matches.find(
				({ binding }) => binding.method === request.method,
			);
			if (!match) {
				if (matches.length === 0) return null;
				const allowed = new Set(matches.map(({ binding }) => binding.method));
				return new Response(null, {
					status: 405,
					headers: {
						allow: [...allowed].sort().join(", "),
						"cache-control": "no-store",
					},
				});
			}
			const caller = await resolveFetchPrincipal(match.binding, request);
			if (caller instanceof Response) return caller;
			try {
				return await execute(match.binding, request, caller, match.params!);
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
			const params = matchRoutePath(
				binding.segments,
				new URL(routeInput.request.url).pathname,
			);
			if (!params)
				return Promise.reject(
					new TypeError("Direct Route request path does not match"),
				);
			return execute(
				binding,
				routeInput.request,
				routeInput.execution.principal,
				params,
			);
		},
	});
}
