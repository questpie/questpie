/**
 * Service Definition
 *
 * First-class convention for user services (Stripe, geocoding, email templates, etc.).
 * Services are discovered from `services/*.ts` by codegen and auto-injected into AppContext.
 *
 * @see RFC-CONTEXT-FIRST §5 (Services Convention)
 */

// ============================================================================
// Service Lifecycle
// ============================================================================

/**
 * Service lifecycle determines when a service is created and destroyed.
 *
 * - `singleton` — Created once at app startup, destroyed at app shutdown.
 *   Use for external clients, connection pools, SDK instances.
 *
 * - `request` — Created fresh per request, disposed at end of request.
 *   Use for tenant-scoped DB, user-specific config, request-scoped caches.
 */
export type ServiceLifecycle = "singleton" | "request";

// ============================================================================
// Service Definition
// ============================================================================

/**
 * Service definition — describes how to create and manage a service instance.
 *
 * @example
 * ```ts
 * // services/stripe.ts
 * import { defineService } from "questpie";
 * import Stripe from "stripe";
 *
 * export default defineService({
 *   lifecycle: "singleton",
 *   deps: ["logger"] as const,
 *   create: ({ logger }) => {
 *     logger.info("Stripe initialized");
 *     return new Stripe(process.env.STRIPE_SECRET_KEY!);
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // services/tenant-db.ts — request-scoped
 * export default defineService({
 *   lifecycle: "request",
 *   deps: ["db", "session"] as const,
 *   create: ({ db, session }) => {
 *     return createScopedDb(db, session?.user?.tenantId);
 *   },
 * });
 * ```
 */
export interface ServiceDefinition<
	TDeps extends readonly string[] = readonly string[],
	TInstance = unknown,
> {
	/**
	 * Service lifecycle.
	 * @default "singleton"
	 */
	lifecycle?: ServiceLifecycle;

	/**
	 * Dependencies — names of other services or infrastructure this service needs.
	 * These are resolved from AppContext before calling `create()`.
	 *
	 * Use `as const` for type-safe dependency injection:
	 * ```ts
	 * deps: ["db", "logger"] as const,
	 * ```
	 */
	deps?: TDeps;

	/**
	 * Factory function that creates the service instance.
	 * Receives resolved dependencies as an object.
	 */
	create: (deps: Record<TDeps[number], any>) => TInstance;

	/**
	 * Optional cleanup function called when the service is destroyed.
	 * Only meaningful for singleton services (called at app shutdown)
	 * or request services (called at end of request).
	 */
	dispose?: (instance: TInstance) => void | Promise<void>;
}

/**
 * Define a service with type-safe dependency injection.
 *
 * Services are first-class citizens in QuestPie — discovered from `services/*.ts`
 * by codegen and automatically available in hook/function context.
 *
 * @param definition - Service definition with lifecycle, deps, and create factory.
 * @returns The service definition (identity function for type inference).
 *
 * @example
 * ```ts
 * // services/stripe.ts
 * import { defineService } from "questpie";
 * import Stripe from "stripe";
 *
 * export default defineService({
 *   lifecycle: "singleton",
 *   create: () => new Stripe(process.env.STRIPE_SECRET_KEY!),
 * });
 * ```
 */
export function service<
	const TDeps extends readonly string[],
	TInstance,
>(
	definition: ServiceDefinition<TDeps, TInstance>,
): ServiceDefinition<TDeps, TInstance> {
	return definition;
}

/** @deprecated Use service() instead */
export const defineService = service;

/**
 * Extract the instance type from a service definition.
 * Used by codegen to generate typed AppContext.
 *
 * @example
 * ```ts
 * type StripeInstance = ServiceInstanceOf<typeof stripeService>;
 * // Stripe
 * ```
 */
export type ServiceInstanceOf<T> = T extends ServiceDefinition<any, infer I>
	? I
	: T extends { create: (...args: any[]) => infer I }
		? I
		: unknown;
