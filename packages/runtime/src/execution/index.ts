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
import { decodeContextInput } from "./context-input";
import {
	type AnyApplicationService,
	type AnyService,
	createServiceOwner,
} from "./services";
import { decodeOperationWireRoot } from "./wire";

type MaybePromise<Value> = Value | Promise<Value>;

const trustedExecutionFacts = new WeakSet<object>();
const trustedExecutionScopes = new WeakSet<object>();

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

export interface RuntimeProgram<Context extends ContextDefinition, View> {
	readonly services: readonly AnyService[];
	readonly context: Context;
	readonly bootstrap: RuntimeContextBootstrapFactory;
	readonly project: (
		scope: RuntimeExecutionScope<ContextResolvedOf<Context>>,
	) => MaybePromise<View>;
}

export type { OperationWireRootFrame } from "./wire";

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
		}>,
		use: (view: View) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	operationWire<Result>(
		input: Readonly<{
			principal: Principal;
			frame: unknown;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (view: View) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	route<Result>(
		input: Readonly<{
			principal: Principal;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (scope: RouteExecutionScope<Input, View>) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
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
		}>,
		use: (view: View) => MaybePromise<Result>,
	): Promise<Awaited<Result>> {
		if (!principal.is(input.principal))
			throw new Error("Execution requires a trusted Principal");
		return services.execution(
			{ signal: input.signal },
			async ({ service, signal }) => {
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
				const scope = Object.freeze({ facts, service });
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
		operationWire: <Result>(
			input: Readonly<{
				principal: Principal;
				frame: unknown;
				signal?: AbortSignal;
				deadline?: number;
			}>,
			use: (view: View) => MaybePromise<Result>,
		) => {
			const decoded = decodeOperationWireRoot(input.frame, input.principal);
			return execution(
				{
					principal: decoded.principal,
					context: decoded.context as ContextInputOf<Context>,
					signal: input.signal,
					deadline: input.deadline,
				},
				use,
			);
		},
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

export { createRuntimeRouteExecutor } from "./routes";
export type {
	RuntimeCredentialBinding,
	RuntimeCredentialOutcome,
	RuntimeRouteBinding,
	RuntimeRouteExecutor,
} from "./routes";
