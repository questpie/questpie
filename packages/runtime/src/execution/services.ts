import {
	type ServiceDefinition,
	type ServiceDependencyMap,
	type ServiceEffect,
	type ServiceInstance,
	type ServiceLifetime,
} from "questpie";

import { retainResponseLifetime } from "./response";

type MaybePromise<Value> = Value | Promise<Value>;

export type AnyService = ServiceDefinition<
	string,
	ServiceLifetime,
	ServiceEffect,
	ServiceDependencyMap,
	unknown
>;

export type AnyApplicationService = ServiceDefinition<
	string,
	"application",
	ServiceEffect,
	ServiceDependencyMap,
	unknown
>;

type OwnedService = Readonly<{
	definition: AnyService;
	instance: unknown;
}>;

type ExecutionScope = Readonly<{
	signal: AbortSignal;
	service<Definition extends AnyService>(
		definition: Definition,
	): Promise<ServiceInstance<Definition>>;
}>;

export interface ServiceOwner {
	application<Definition extends AnyApplicationService>(
		definition: Definition,
	): Promise<ServiceInstance<Definition>>;
	execution<Result>(
		input: Readonly<{ signal?: AbortSignal; abortUse?: boolean }>,
		use: (scope: ExecutionScope) => MaybePromise<Result>,
	): Promise<Awaited<Result>>;
	close(): Promise<void>;
}

function serviceIdentity(definition: AnyService): `service:${string}` {
	return `service:${definition.name}`;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("Execution aborted", "AbortError");
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

export function createServiceOwner(
	serviceDefinitions: readonly AnyService[],
): ServiceOwner {
	const registered = new Map(
		serviceDefinitions.map((definition) => [
			serviceIdentity(definition),
			definition,
		]),
	);
	const applicationCells = new Map<string, Promise<unknown>>();
	const applicationOwned: OwnedService[] = [];
	const applicationController = new AbortController();
	const activeScopes = new Set<Promise<void>>();
	const scopeControllers = new Set<AbortController>();
	let state: "open" | "closing" | "closed" = "open";
	let closePromise: Promise<void> | undefined;

	for (const definition of serviceDefinitions)
		for (const dependency of Object.values(definition.dependencies)) {
			if (!registered.has(serviceIdentity(dependency)))
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

	const resolveService = <Definition extends AnyService>(
		definition: Definition,
		execution: Readonly<{
			cells: Map<string, Promise<unknown>>;
			owned: OwnedService[];
			signal: AbortSignal;
		}> | null,
	): Promise<ServiceInstance<Definition>> => {
		const identity = serviceIdentity(definition);
		if (registered.get(identity) !== definition)
			return Promise.reject(
				new TypeError(`${identity} is not registered by this Runtime`),
			);
		const cells =
			definition.lifetime === "application"
				? applicationCells
				: execution?.cells;
		if (!cells)
			throw new TypeError(`${identity} requires an execution Service scope`);
		const existing = cells.get(identity);
		if (existing) return existing as Promise<ServiceInstance<Definition>>;
		const created = (async () => {
			const dependencyEntries = await Promise.all(
				Object.entries(definition.dependencies).map(
					async ([key, dependency]) => [
						key,
						await resolveService(dependency, execution),
					],
				),
			);
			const instance = await definition.create({
				services: Object.freeze(Object.fromEntries(dependencyEntries)),
				signal:
					definition.lifetime === "application"
						? applicationController.signal
						: execution!.signal,
			});
			const owner =
				definition.lifetime === "application"
					? applicationOwned
					: execution!.owned;
			owner.push({ definition, instance });
			return instance;
		})();
		cells.set(identity, created);
		return created as Promise<ServiceInstance<Definition>>;
	};

	const application: ServiceOwner["application"] = (definition) => {
		if (state !== "open")
			return Promise.reject(new Error("Runtime is closing"));
		if (definition.lifetime !== "application")
			return Promise.reject(
				new TypeError(
					`${serviceIdentity(definition)} is not an application Service`,
				),
			);
		return resolveService(definition, null);
	};

	const execution = async <Result>(
		input: Readonly<{ signal?: AbortSignal; abortUse?: boolean }>,
		use: (scope: ExecutionScope) => MaybePromise<Result>,
	): Promise<Awaited<Result>> => {
		if (state !== "open") throw new Error("Runtime is closing");
		const controller = new AbortController();
		scopeControllers.add(controller);
		const onAbort = () => controller.abort(abortReason(input.signal!));
		if (input.signal?.aborted) controller.abort(abortReason(input.signal));
		else input.signal?.addEventListener("abort", onAbort, { once: true });
		const cells = new Map<string, Promise<unknown>>();
		const owned: OwnedService[] = [];
		let resolveScope!: () => void;
		let rejectScope!: (error: unknown) => void;
		const scopeDone = new Promise<void>((resolveDone, rejectDone) => {
			resolveScope = resolveDone;
			rejectScope = rejectDone;
		});
		activeScopes.add(scopeDone);
		void scopeDone
			.finally(() => activeScopes.delete(scopeDone))
			.catch(() => undefined);
		let finalizePromise: Promise<void> | undefined;
		const finalize = (): Promise<void> => {
			if (finalizePromise) return finalizePromise;
			finalizePromise = (async () => {
				input.signal?.removeEventListener("abort", onAbort);
				try {
					await Promise.allSettled(cells.values());
					await disposeOwned(owned);
				} finally {
					scopeControllers.delete(controller);
				}
			})();
			void finalizePromise.then(resolveScope, rejectScope);
			return finalizePromise;
		};

		let failed = false;
		let primaryFailure: unknown;
		let result: Awaited<Result> | undefined;
		let pendingUse: Promise<Awaited<Result>> | undefined;
		try {
			if (controller.signal.aborted) throw abortReason(controller.signal);
			pendingUse = Promise.resolve(
				use({
					signal: controller.signal,
					service: (definition) => {
						if (input.abortUse && controller.signal.aborted)
							return Promise.reject(abortReason(controller.signal));
						return resolveService(definition, {
							cells,
							owned,
							signal: controller.signal,
						});
					},
				}),
			);
			void pendingUse.catch(() => undefined);
			if (input.abortUse) {
				let rejectAbort!: (reason: unknown) => void;
				const rejectOnAbort = () => rejectAbort(abortReason(controller.signal));
				const aborted = new Promise<never>((_resolve, reject) => {
					rejectAbort = reject;
					controller.signal.addEventListener("abort", rejectOnAbort, {
						once: true,
					});
					if (controller.signal.aborted) rejectOnAbort();
				});
				try {
					result = await Promise.race([pendingUse, aborted]);
				} finally {
					controller.signal.removeEventListener("abort", rejectOnAbort);
				}
			} else result = await pendingUse;
			controller.signal.throwIfAborted();
		} catch (error) {
			failed = true;
			primaryFailure = error;
			if (!controller.signal.aborted) controller.abort(error);
		}
		if (failed && input.abortUse && pendingUse)
			void pendingUse
				.then(async (lateResult) => {
					if (lateResult instanceof Response && lateResult.body)
						await lateResult.body.cancel(primaryFailure);
				})
				.catch(() => undefined);
		if (!failed && result instanceof Response)
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
		if (failed) throw primaryFailure;
		if (cleanupFailure) throw cleanupFailure;
		return result as Awaited<Result>;
	};

	return Object.freeze({
		application,
		execution,
		close: () => {
			if (closePromise) return closePromise;
			state = "closing";
			for (const controller of scopeControllers)
				controller.abort(new DOMException("Runtime closing", "AbortError"));
			applicationController.abort(
				new DOMException("Runtime closing", "AbortError"),
			);
			closePromise = (async () => {
				await Promise.allSettled(activeScopes);
				await Promise.allSettled(applicationCells.values());
				await disposeOwned(applicationOwned);
				state = "closed";
			})();
			return closePromise;
		},
	});
}
