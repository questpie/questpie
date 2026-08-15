type MaybePromise<Value> = Value | Promise<Value>;

export type ServiceLifetime = "application" | "execution";
export type ServiceEffect = "read" | "external";

type ServiceBrand = Readonly<{
	category: "definition";
	resourceKind: "service";
}>;

export interface ServiceDefinition<
	Name extends string = string,
	Lifetime extends ServiceLifetime = ServiceLifetime,
	Effect extends ServiceEffect = ServiceEffect,
	Dependencies extends ServiceDependencyMap = ServiceDependencyMap,
	Instance = unknown,
> {
	readonly __questpie: ServiceBrand;
	readonly name: Name;
	readonly lifetime: Lifetime;
	readonly effect: Effect;
	readonly dependencies: Dependencies;
	readonly executableSlots: readonly ("create" | "dispose")[];
	create(
		input: Readonly<{
			services: ServiceInstances<Dependencies>;
			signal: AbortSignal;
		}>,
	): MaybePromise<Instance>;
	dispose?(instance: Instance): MaybePromise<void>;
}

export type ServiceDependencyMap = Readonly<Record<string, ServiceDefinition>>;

export type ServiceInstance<Definition> =
	Definition extends ServiceDefinition<
		string,
		ServiceLifetime,
		ServiceEffect,
		ServiceDependencyMap,
		infer Instance
	>
		? Instance
		: never;

export type ServiceInstances<Dependencies extends ServiceDependencyMap> =
	Readonly<{
		[Key in keyof Dependencies]: ServiceInstance<Dependencies[Key]>;
	}>;

export function defineService<
	const Name extends string,
	const Lifetime extends ServiceLifetime,
	const Effect extends ServiceEffect,
	const Dependencies extends ServiceDependencyMap = Readonly<
		Record<never, never>
	>,
	Instance = unknown,
>(
	input: Readonly<{
		name: Name;
		lifetime: Lifetime;
		effect: Effect;
		dependencies?: Dependencies;
		create: (
			input: Readonly<{
				services: ServiceInstances<Dependencies>;
				signal: AbortSignal;
			}>,
		) => MaybePromise<Instance>;
		dispose?: (instance: Instance) => MaybePromise<void>;
	}>,
): ServiceDefinition<Name, Lifetime, Effect, Dependencies, Instance> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "service",
		}),
		name: input.name,
		lifetime: input.lifetime,
		effect: input.effect,
		dependencies: Object.freeze({ ...(input.dependencies ?? {}) }),
		executableSlots: Object.freeze([
			"create",
			...(input.dispose ? (["dispose"] as const) : []),
		]),
		create: input.create,
		dispose: input.dispose,
	}) as unknown as ServiceDefinition<
		Name,
		Lifetime,
		Effect,
		Dependencies,
		Instance
	>;
}
