import {
	principal,
	type Authority,
	ContextBootstrap,
	ContextDefinition,
	ContextInputOf,
	ContextResolvedOf,
	Principal,
	ServiceInstance,
} from "questpie";

import type { LiveQueryObservation } from "../live-query";
import type {
	ExecutionEntry,
	RuntimeExecutionObservation,
} from "../observation";
import { retainScopeThroughResponse } from "../observation/response";
import { decodeContextInput } from "./context-input";
import {
	type AnyApplicationService,
	type AnyService,
	createServiceOwner,
} from "./services";

export { awaitExecutionPhase } from "./abort";

type MaybePromise<Value> = Value | Promise<Value>;

const trustedExecutionFacts = new WeakSet<object>();
const trustedExecutionScopes = new WeakSet<object>();
const executionObservation = Symbol("questpie.execution.observation");

export type RuntimeExecutionObservationBinding = Readonly<{
	entry: ExecutionEntry;
	execution: RuntimeExecutionObservation;
}>;

export type RuntimeContextBootstrapFactory = (
	signal: AbortSignal,
) => ContextBootstrap;

export type ExecutionFacts<Resolved> = Readonly<{
	principal: Principal;
	authority: Authority;
	/** The decoded Context input this root resolved from, never the resolution. */
	contextInput: unknown;
	tenant: Resolved extends Readonly<{ tenant: infer Tenant }> ? Tenant : never;
	values: Resolved extends Readonly<{ values: infer Values }> ? Values : never;
	signal: AbortSignal;
	deadline: number | null;
	liveQueryObservation: LiveQueryObservation | null;
}>;

export function isRuntimeExecutionFacts(
	value: unknown,
): value is ExecutionFacts<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
> {
	return Boolean(
		value &&
		typeof value === "object" &&
		trustedExecutionFacts.has(value) &&
		principal.is((value as Readonly<{ principal?: unknown }>).principal),
	);
}

export type RuntimeExecutionScope<Resolved> = Readonly<{
	facts: ExecutionFacts<Resolved>;
	service<Definition extends AnyService>(
		definition: Definition,
	): Promise<ServiceInstance<Definition>>;
	child<Result>(
		input: Readonly<{
			detachedTerminalCleanup?: boolean;
			signal?: AbortSignal;
			settledUseWinsAbort?: boolean;
		}>,
		use: (
			scope: Readonly<{
				signal: AbortSignal;
				executionService<Definition extends AnyService>(
					definition: Definition,
				): Promise<ServiceInstance<Definition>>;
				service<Definition extends AnyService>(
					definition: Definition,
				): Promise<ServiceInstance<Definition>>;
			}>,
		) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
}>;

export function isRuntimeExecutionScope(
	value: unknown,
): value is RuntimeExecutionScope<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
> {
	return Boolean(
		value &&
		typeof value === "object" &&
		trustedExecutionScopes.has(value) &&
		isRuntimeExecutionFacts((value as Readonly<{ facts?: unknown }>).facts),
	);
}

export function executionObservationOf(
	scope: RuntimeExecutionScope<
		Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
	>,
): RuntimeExecutionObservationBinding | null {
	if (!trustedExecutionScopes.has(scope)) return null;
	return (
		(
			scope as RuntimeExecutionScope<never> & {
				readonly [executionObservation]?: RuntimeExecutionObservationBinding;
			}
		)[executionObservation] ?? null
	);
}

export interface RuntimeProgram<Context extends ContextDefinition, View> {
	readonly services: readonly AnyService[];
	readonly context: Context;
	readonly bootstrap: RuntimeContextBootstrapFactory;
	readonly project: (
		scope: RuntimeExecutionScope<ContextResolvedOf<Context>>,
	) => MaybePromise<View>;
}

export interface ApplicationRuntime<Input, View> {
	applicationService<Definition extends AnyApplicationService>(
		definition: Definition,
	): Promise<ServiceInstance<Definition>>;
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Input;
			signal?: AbortSignal;
			deadline?: number;
			liveQueryObservation?: LiveQueryObservation;
			observation?: RuntimeExecutionObservationBinding;
			settledUseWinsAbort?: boolean;
		}>,
		use: (view: View) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	route<Result>(
		input: Readonly<{
			principal: Principal;
			signal?: AbortSignal;
			deadline?: number;
			entry?: "direct" | "fetch";
		}>,
		use: (scope: RouteExecutionScope<Input, View>) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	observeRoute(
		request: Request,
		routeTemplate: string,
		use: () => Promise<
			Readonly<{
				outcome: "ok" | "framework_error" | "deadline";
				response: Response;
				signal: AbortSignal;
				finalize(): void;
				retainControl: boolean;
			}>
		>,
	): Promise<Response>;
	observeUnmatchedFetch(
		request: Request,
		use: () => Promise<Response>,
	): Promise<Response>;
	close(): Promise<void>;
}

export type RouteExecutionScope<Input, View> = Readonly<{
	principal: Principal;
	signal: AbortSignal;
	deadline: number | null;
	service<Definition extends AnyService>(
		definition: Definition,
	): Promise<ServiceInstance<Definition>>;
	execution: ApplicationRuntime<Input, View>["execution"];
}>;

function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== "object") return value;
	const pending: object[] = [value];
	const seen = new Set<object>();
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || seen.has(current)) continue;
		seen.add(current);
		for (const child of Object.values(current))
			if (child && typeof child === "object" && !(child instanceof AbortSignal))
				pending.push(child);
		Object.freeze(current);
	}
	return value;
}

function copiedFrozen<Value>(value: Value): Value {
	return deepFreeze(structuredClone(value));
}

export function createApplicationRuntime<
	Context extends ContextDefinition,
	View,
>(
	program: RuntimeProgram<Context, View>,
): ApplicationRuntime<ContextInputOf<Context>, View> {
	const services = createServiceOwner(program.services);

	async function execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: ContextInputOf<Context>;
			signal?: AbortSignal;
			deadline?: number;
			liveQueryObservation?: LiveQueryObservation;
			observation?: RuntimeExecutionObservationBinding;
			settledUseWinsAbort?: boolean;
		}>,
		use: (view: View) => MaybePromise<Result>,
	): Promise<Awaited<Result>> {
		if (!principal.is(input.principal))
			throw new Error("Execution requires a trusted Principal");
		return services.execution(
			{
				signal: input.signal,
				settledUseWinsAbort: input.settledUseWinsAbort,
			},
			async ({ child, service, signal }) => {
				const decoded = deepFreeze(
					decodeContextInput(program.context.input, input.context),
				);
				const bootstrap = program.bootstrap(signal);
				const resolved = copiedFrozen(
					await program.context.resolve({
						input: decoded,
						principal: input.principal,
						bootstrap:
							input.liveQueryObservation === undefined
								? bootstrap
								: {
										get: async (collection, request) => {
											const value = await bootstrap.get(collection, request);
											input.liveQueryObservation!.recordContext(
												`context:${program.context.name}`,
												[
													{
														kind: "contextBootstrapPoint",
														collection: `collection:${collection.name}`,
														detail: { key: request.key },
													},
												],
											);
											return value;
										},
									},
					}),
				);
				signal.throwIfAborted();
				const facts = Object.freeze({
					principal: input.principal,
					authority: Object.freeze({ kind: "ordinary" as const }),
					contextInput: decoded,
					tenant: resolved.tenant,
					values: resolved.values,
					signal,
					deadline: input.deadline ?? null,
					liveQueryObservation: input.liveQueryObservation ?? null,
				}) as ExecutionFacts<ContextResolvedOf<Context>>;
				trustedExecutionFacts.add(facts);
				const scope = { child, facts, service };
				if (input.observation !== undefined)
					Object.defineProperty(scope, executionObservation, {
						configurable: false,
						enumerable: false,
						value: Object.freeze({ ...input.observation }),
						writable: false,
					});
				Object.freeze(scope);
				trustedExecutionScopes.add(scope);
				try {
					const view = await program.project(scope);
					signal.throwIfAborted();
					return await use(view);
				} finally {
					trustedExecutionScopes.delete(scope);
					trustedExecutionFacts.delete(facts);
				}
			},
		);
	}

	return Object.freeze({
		applicationService: services.application,
		execution,
		observeRoute: async (
			_request: Request,
			_routeTemplate: string,
			use: () => Promise<
				Readonly<{
					outcome: "ok" | "framework_error" | "deadline";
					response: Response;
					signal: AbortSignal;
					finalize(): void;
					retainControl: boolean;
				}>
			>,
		) => {
			const owned = await use();
			if (!owned.retainControl) return owned.response;
			return retainScopeThroughResponse(
				null,
				owned.response,
				"route",
				owned.signal,
				owned.finalize,
				owned.outcome,
			);
		},
		observeUnmatchedFetch: (_request: Request, use: () => Promise<Response>) =>
			use(),
		route: <Result>(
			input: Readonly<{
				principal: Principal;
				signal?: AbortSignal;
				deadline?: number;
			}>,
			use: (
				scope: RouteExecutionScope<ContextInputOf<Context>, View>,
			) => MaybePromise<Result>,
		) => {
			if (!principal.is(input.principal))
				return Promise.reject(
					new TypeError("Route requires a trusted Principal"),
				);
			return services.execution(
				{ signal: input.signal, abortUse: true },
				({ service, signal }) =>
					use(
						Object.freeze({
							principal: input.principal,
							signal,
							deadline: input.deadline ?? null,
							service,
							execution,
						}),
					),
			);
		},
		close: services.close,
	});
}

export {
	createRuntimeRouteExecutor,
	decodeRuntimeCredentialOutcome,
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "./routes";
export { runtimeMonotonicNow } from "./clock";
export type {
	RuntimeCredentialBinding,
	RuntimeCredentialOutcome,
	RuntimeRouteBinding,
	RuntimeRouteExecutor,
} from "./routes";
