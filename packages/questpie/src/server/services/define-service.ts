/**
 * Service lifecycle determines when a service is created and destroyed.
 */
export type ServiceLifecycle = "singleton" | "request";

declare global {
	namespace Questpie {
		interface ServiceCreateContext {
			[key: string]: any;
		}
	}
}

export interface ServiceBuilderState<TInstance = unknown> {
	lifecycle?: ServiceLifecycle;
	create?: (
		ctx: Questpie.ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: string | null;
}

export class ServiceBuilder<TInstance = unknown> {
	readonly state: ServiceBuilderState<TInstance>;

	constructor(state: ServiceBuilderState<TInstance> = {}) {
		this.state = state;
	}

	create<T>(
		factory: (ctx: Questpie.ServiceCreateContext) => T | Promise<T>,
	): ServiceBuilder<T> {
		return new ServiceBuilder<T>({
			...(this.state as unknown as ServiceBuilderState<T>),
			create: factory,
		});
	}

	dispose(
		fn: (instance: TInstance) => void | Promise<void>,
	): ServiceBuilder<TInstance> {
		return new ServiceBuilder<TInstance>({
			...this.state,
			dispose: fn,
		});
	}

	lifecycle(lifecycle: ServiceLifecycle): ServiceBuilder<TInstance> {
		return new ServiceBuilder<TInstance>({
			...this.state,
			lifecycle,
		});
	}

	namespace(namespace: string | null): ServiceBuilder<TInstance> {
		return new ServiceBuilder<TInstance>({
			...this.state,
			namespace,
		});
	}
}

export function service(): ServiceBuilder<unknown>;
export function service<TInstance>(state: {
	create: (
		ctx: Questpie.ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	lifecycle?: ServiceLifecycle;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: string | null;
}): ServiceBuilder<TInstance>;
export function service<TInstance>(state?: {
	create?: (
		ctx: Questpie.ServiceCreateContext,
	) => TInstance | Promise<TInstance>;
	lifecycle?: ServiceLifecycle;
	dispose?: (instance: TInstance) => void | Promise<void>;
	namespace?: string | null;
}): ServiceBuilder<TInstance | unknown> {
	return new ServiceBuilder<TInstance | unknown>(
		(state ?? {}) as ServiceBuilderState<TInstance | unknown>,
	);
}

export type ServiceInstanceOf<T> =
	T extends ServiceBuilder<infer I>
		? I
		: T extends { create: (...args: any[]) => infer I }
			? I
			: unknown;
