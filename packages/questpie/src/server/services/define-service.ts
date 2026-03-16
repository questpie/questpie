/**
 * Service lifecycle determines when a service is created and destroyed.
 */
export type ServiceLifecycle = "singleton" | "request";

export type ServiceNamespace = string | null | undefined;

declare global {
	namespace Questpie {
		interface ServiceCreateContext {
			[key: string]: any;
		}
	}
}

export interface ServiceBuilderState<
	TInstance = unknown,
	TNamespace extends ServiceNamespace = undefined,
	TLifecycle extends ServiceLifecycle | undefined = undefined,
> {
	lifecycle?: TLifecycle;
	create?: (
		ctx: Questpie.ServiceCreateContext,
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
		factory: (ctx: Questpie.ServiceCreateContext) => T | Promise<T>,
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
		ctx: Questpie.ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	lifecycle?: TLifecycle;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: TNamespace;
}): ServiceBuilder<TInstance, TNamespace, TLifecycle>;
export function service<TInstance>(state?: {
	create?: (
		ctx: Questpie.ServiceCreateContext,
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
