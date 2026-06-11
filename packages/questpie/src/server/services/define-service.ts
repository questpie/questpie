import type { AppContext } from "#questpie/server/config/app-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

/**
 * Service lifecycle determines when a service is created and destroyed.
 */
export type ServiceLifecycle = "singleton" | "request";

export type ServiceNamespace = string | null | undefined;

declare global {
	namespace Questpie {
		/**
		 * Augmentable service-create context. Empty by default — generated code
		 * extends it with the typed app surface (`interface ServiceCreateContext
		 * extends _AppCoreContext {}`). No index signature: unknown keys must be
		 * compile errors, not silent `any`.
		 */
		interface ServiceCreateContext {}

		/**
		 * Names-only marker set by codegen alongside `ServiceCreateContext`.
		 * The fallback conditional below probes THIS interface's keys instead of
		 * `keyof ServiceCreateContext` — the real interface extends the app's
		 * core context, whose key set resolves through module service
		 * definitions and would circularly reference the conditional (TS2456).
		 */
		interface ServiceCreateContextGenerated {}
	}
}

/**
 * Context passed to `service().create()` factories.
 *
 * Pre-codegen (no augmentation yet) it falls back to {@link AppContext} plus
 * the `app` instance, which the service container always provides at runtime
 * (framework core services bootstrap from it before any codegen exists).
 */
export type ServiceCreateContext = [
	keyof Questpie.ServiceCreateContextGenerated,
] extends [never]
	? AppContext & { app: Questpie<QuestpieConfig> }
	: Questpie.ServiceCreateContext;

export interface ServiceBuilderState<
	TInstance = unknown,
	TNamespace extends ServiceNamespace = undefined,
	TLifecycle extends ServiceLifecycle | undefined = undefined,
> {
	lifecycle?: TLifecycle;
	create?: (
		ctx: ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: TNamespace;
}

export class ServiceBuilder<
	TInstance = unknown,
	TNamespace extends ServiceNamespace = undefined,
	TLifecycle extends ServiceLifecycle | undefined = undefined,
> {
	readonly state: ServiceBuilderState<TInstance, TNamespace, TLifecycle>;

	constructor(
		state: ServiceBuilderState<TInstance, TNamespace, TLifecycle> = {},
	) {
		this.state = state;
	}

	create<T>(
		factory: (ctx: ServiceCreateContext) => T | Promise<T>,
	): ServiceBuilder<T, TNamespace, TLifecycle> {
		return new ServiceBuilder<T, TNamespace, TLifecycle>({
			...(this.state as unknown as ServiceBuilderState<
				T,
				TNamespace,
				TLifecycle
			>),
			create: factory,
		});
	}

	dispose(
		fn: (instance: TInstance) => void | Promise<void>,
	): ServiceBuilder<TInstance, TNamespace, TLifecycle> {
		return new ServiceBuilder<TInstance, TNamespace, TLifecycle>({
			...this.state,
			dispose: fn,
		});
	}

	lifecycle<TNextLifecycle extends ServiceLifecycle>(
		lifecycle: TNextLifecycle,
	): ServiceBuilder<TInstance, TNamespace, TNextLifecycle> {
		return new ServiceBuilder<TInstance, TNamespace, TNextLifecycle>({
			...this.state,
			lifecycle,
		});
	}

	namespace<TNextNamespace extends string | null>(
		namespace: TNextNamespace,
	): ServiceBuilder<TInstance, TNextNamespace, TLifecycle> {
		return new ServiceBuilder<TInstance, TNextNamespace, TLifecycle>({
			...this.state,
			namespace,
		});
	}
}

export function service(): ServiceBuilder<unknown>;
export function service<
	TInstance,
	TNamespace extends ServiceNamespace = undefined,
	TLifecycle extends ServiceLifecycle = ServiceLifecycle,
>(state: {
	create: (
		ctx: ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	lifecycle?: TLifecycle;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: TNamespace;
}): ServiceBuilder<TInstance, TNamespace, TLifecycle>;
export function service<TInstance>(state?: {
	create?: (
		ctx: ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	lifecycle?: ServiceLifecycle;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: ServiceNamespace;
}): ServiceBuilder<TInstance | unknown> {
	return new ServiceBuilder<TInstance | unknown>(
		(state ?? {}) as ServiceBuilderState<TInstance | unknown>,
	);
}

export type ServiceInstanceOf<T> =
	T extends ServiceBuilder<infer I, any, any>
		? I
		: T extends { create: (...args: any[]) => infer I }
			? I
			: unknown;

export type ServiceNamespaceOf<T> =
	T extends ServiceBuilder<any, infer TNamespace, any>
		? TNamespace
		: T extends { state: { namespace?: infer TNamespace } }
			? TNamespace
			: T extends { namespace?: infer TNamespace }
				? TNamespace
				: undefined;
