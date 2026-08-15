import {
	principal,
	type Authority,
	ContextBootstrap,
	ContextDefinition,
	ContextInputOf,
	ContextResolvedOf,
	Principal,
	ServiceDefinition,
	ServiceDependencyMap,
	ServiceEffect,
	ServiceInstance,
	ServiceLifetime,
} from "questpie";

import { decodeContextInput } from "./context-input";
import { retainResponseLifetime } from "./response";
import { decodeOperationWireRoot } from "./wire";

type AnyService = ServiceDefinition<
	string,
	ServiceLifetime,
	ServiceEffect,
	ServiceDependencyMap,
	unknown
>;

type MaybePromise<Value> = Value | Promise<Value>;

export type ExecutionFacts<Resolved> = Readonly<{
	principal: Principal;
	authority: Authority;
	tenant: Resolved extends Readonly<{ tenant: infer Tenant }> ? Tenant : never;
	values: Resolved extends Readonly<{ values: infer Values }> ? Values : never;
	signal: AbortSignal;
	deadline: number | null;
}>;

export interface RuntimeProgram<Context extends ContextDefinition, View> {
	readonly services: readonly AnyService[];
	readonly context: Context;
	readonly bootstrap: ContextBootstrap;
	readonly project: (
		scope: Readonly<{
			facts: ExecutionFacts<ContextResolvedOf<Context>>;
			service<Definition extends AnyService>(
				definition: Definition,
			): Promise<ServiceInstance<Definition>>;
		}>,
	) => MaybePromise<View>;
}

export type { OperationWireRootFrame } from "./wire";

export interface ApplicationRuntime<Input, View> {
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Input;
			signal?: AbortSignal;
			deadline?: number;
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
	close(): Promise<void>;
}

type OwnedService = Readonly<{
	definition: AnyService;
	instance: unknown;
}>;

function serviceIdentity(definition: AnyService): `service:${string}` {
	return `service:${definition.name}`;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("Execution aborted", "AbortError");
}

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

async function disposeOwned(owned: OwnedService[]): Promise<void> {
	let failure: unknown;
	for (const item of owned.toReversed()) {
		if (!item.definition.dispose) continue;
		try {
			await item.definition.dispose(item.instance);
		} catch (error) {
			failure = failure
				? new SuppressedError(error, failure, "Service disposal failed")
				: error;
		}
	}
	if (failure) throw failure;
}

export function createApplicationRuntime<
	Context extends ContextDefinition,
	View,
>(
	program: RuntimeProgram<Context, View>,
): ApplicationRuntime<ContextInputOf<Context>, View> {
	const definitions = new Map(
		program.services.map((definition) => [
			serviceIdentity(definition),
			definition,
		]),
	);
	const applicationCells = new Map<string, Promise<unknown>>();
	const applicationOwned: OwnedService[] = [];
	const applicationController = new AbortController();
	const activeRoots = new Set<Promise<unknown>>();
	const rootControllers = new Set<AbortController>();
	let state: "open" | "closing" | "closed" = "open";
	let closePromise: Promise<void> | undefined;

	for (const definition of program.services)
		for (const dependency of Object.values(definition.dependencies)) {
			if (!definitions.has(serviceIdentity(dependency)))
				throw new Error(
					`${serviceIdentity(definition)} has an unknown dependency`,
				);
			if (
				definition.lifetime === "application" &&
				dependency.lifetime === "execution"
			)
				throw new Error(
					"application Service cannot depend on execution Service",
				);
			if (definition.effect === "read" && dependency.effect === "external")
				throw new Error("read Service cannot depend on external Service");
		}

	async function execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: ContextInputOf<Context>;
			signal?: AbortSignal;
			deadline?: number;
		}>,
		use: (view: View) => MaybePromise<Result>,
	): Promise<Awaited<Result>> {
		if (state !== "open") throw new Error("Runtime is closing");
		if (!principal.is(input.principal))
			throw new Error("Execution requires a trusted Principal");
		const controller = new AbortController();
		rootControllers.add(controller);
		const onAbort = () => controller.abort(abortReason(input.signal!));
		if (input.signal?.aborted) controller.abort(abortReason(input.signal));
		else input.signal?.addEventListener("abort", onAbort, { once: true });
		const executionCells = new Map<string, Promise<unknown>>();
		const executionOwned: OwnedService[] = [];
		let resolveScope!: () => void;
		let rejectScope!: (error: unknown) => void;
		const scopeDone = new Promise<void>((resolveDone, rejectDone) => {
			resolveScope = resolveDone;
			rejectScope = rejectDone;
		});
		activeRoots.add(scopeDone);
		void scopeDone
			.finally(() => activeRoots.delete(scopeDone))
			.catch(() => undefined);
		let finalizePromise: Promise<void> | undefined;
		const finalize = (): Promise<void> => {
			if (finalizePromise) return finalizePromise;
			finalizePromise = (async () => {
				input.signal?.removeEventListener("abort", onAbort);
				rootControllers.delete(controller);
				await disposeOwned(executionOwned);
			})();
			void finalizePromise.then(resolveScope, rejectScope);
			return finalizePromise;
		};

		const getService = <Definition extends AnyService>(
			definition: Definition,
		): Promise<ServiceInstance<Definition>> => {
			const identity = serviceIdentity(definition);
			const cells =
				definition.lifetime === "application"
					? applicationCells
					: executionCells;
			const existing = cells.get(identity);
			if (existing) return existing as Promise<ServiceInstance<Definition>>;
			const created = (async () => {
				const dependencyEntries = await Promise.all(
					Object.entries(definition.dependencies).map(
						async ([key, dependency]) => [key, await getService(dependency)],
					),
				);
				const instance = await definition.create({
					services: Object.freeze(Object.fromEntries(dependencyEntries)),
					signal:
						definition.lifetime === "application"
							? applicationController.signal
							: controller.signal,
				});
				const owner =
					definition.lifetime === "application"
						? applicationOwned
						: executionOwned;
				owner.push({ definition, instance });
				return instance;
			})();
			cells.set(identity, created);
			return created as Promise<ServiceInstance<Definition>>;
		};

		const root = (async () => {
			let primaryFailure: unknown;
			let result: Awaited<Result> | undefined;
			try {
				if (controller.signal.aborted) throw abortReason(controller.signal);
				const decoded = deepFreeze(
					decodeContextInput(program.context.input, input.context),
				);
				const resolved = copiedFrozen(
					await program.context.resolve({
						input: decoded,
						principal: input.principal,
						bootstrap: program.bootstrap,
					}),
				);
				controller.signal.throwIfAborted();
				const facts = Object.freeze({
					principal: input.principal,
					authority: Object.freeze({ kind: "ordinary" as const }),
					tenant: resolved.tenant,
					values: resolved.values,
					signal: controller.signal,
					deadline: input.deadline ?? null,
				}) as ExecutionFacts<ContextResolvedOf<Context>>;
				const view = await program.project({ facts, service: getService });
				controller.signal.throwIfAborted();
				result = await use(view);
				controller.signal.throwIfAborted();
			} catch (error) {
				primaryFailure = error;
			}
			if (!primaryFailure && result instanceof Response)
				return (await retainResponseLifetime(
					result,
					controller.signal,
					finalize,
				)) as Awaited<Result>;
			let cleanupFailure: unknown;
			try {
				await finalize();
			} catch (error) {
				cleanupFailure = error;
			}
			if (primaryFailure) throw primaryFailure;
			if (cleanupFailure) throw cleanupFailure;
			return result as Awaited<Result>;
		})();
		return (await root) as Awaited<Result>;
	}

	return Object.freeze({
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
		close: () => {
			if (closePromise) return closePromise;
			state = "closing";
			for (const controller of rootControllers)
				controller.abort(new DOMException("Runtime closing", "AbortError"));
			applicationController.abort(
				new DOMException("Runtime closing", "AbortError"),
			);
			closePromise = (async () => {
				await Promise.allSettled(activeRoots);
				await disposeOwned(applicationOwned);
				state = "closed";
			})();
			return closePromise;
		},
	});
}
