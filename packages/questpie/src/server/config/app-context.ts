/**
 * AppContext — the extensible context interface.
 *
 * Empty by default. Generated code augments this via module augmentation:
 *   declare module "questpie" {
 *     interface AppContext { db: ...; queue: ...; session: ...; }
 *   }
 *
 * ALL handler contexts (HookContext, AccessContext, FunctionHandlerArgs,
 * JobHandlerArgs, BlockPrefetchContext) extend AppContext.
 *
 * Plugins can add custom keys:
 *   declare module "questpie" {
 *     interface AppContext { channels: ChannelsService; }
 *   }
 *   → ({ channels }) available in every hook, function, job, etc.
 *
 * User services support namespace placement:
 *   ({ services }) => services.blog.computeReadingTime(text) // default
 *   ({ workflows }) => workflows.run(...)                    // namespace: null
 *   ({ analytics }) => analytics.tracker.track(...)          // namespace: "analytics"
 *
 * @see RFC-CONTEXT-FIRST.md §2
 */
/**
 * Global augmentation namespace.
 * Uses `declare global` so augmentations work correctly with workspace symlinks
 * (where `declare module "questpie"` fails due to module identity mismatch).
 *
 * Augment via: `declare global { namespace Questpie { interface AppContext { ... } } }`
 */
declare global {
	namespace Questpie {
		// biome-ignore lint/suspicious/noEmptyInterface: Designed to be augmented
		interface AppContext {}
		// biome-ignore lint/suspicious/noEmptyInterface: Designed to be augmented
		interface Registry {}
		// biome-ignore lint/suspicious/noEmptyInterface: Designed to be augmented
		interface QuestpieContextExtension {}
	}
}

/**
 * AppContext — the extensible context interface.
 * Augment via `declare global { namespace Questpie { interface AppContext { ... } } }`
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extends global augmentable interface
export interface AppContext extends Questpie.AppContext {}

/**
 * Registry — the app-wide type catalogue.
 * Augment via `declare global { namespace Questpie { interface Registry { ... } } }`
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extends global augmentable interface
export interface Registry extends Questpie.Registry {}

/**
 * Extract known names from a Registry key.
 * When the key exists → union of its keys + (string & {}) for autocomplete.
 * When it doesn't (no codegen) → plain string.
 */
export type RegistryNames<K extends string> =
	Registry extends Record<K, infer R>
		? (keyof R & string) | (string & {})
		: string;

/** Known collection names (includes module collections). @see Registry['collections'] */
export type KnownCollectionNames = RegistryNames<"collections">;

/** Known global names. @see Registry['globals'] */
export type KnownGlobalNames = RegistryNames<"globals">;

/** Known block names. @see Registry['blocks'] */
export type KnownBlockNames = RegistryNames<"blocks">;

/** Known job names (includes module jobs). @see Registry['jobs'] */
export type KnownJobNames = RegistryNames<"jobs">;

/** Known service names. @see Registry['services'] */
export type KnownServiceNames = RegistryNames<"services">;

/** Known email template names. @see Registry['emails'] */
export type KnownEmailNames = RegistryNames<"emails">;

/** Known route names. @see Registry['routes'] */
export type KnownRouteNames = RegistryNames<"routes">;

/** Known view names (from admin modules). @see Registry['views'] */
export type KnownViewNames = RegistryNames<"views">;

/**
 * Known list view names (from admin modules).
 * @deprecated Use KnownViewNames instead — list/form filtering is now type-level.
 */
export type KnownListViewNames = RegistryNames<"views">;

/**
 * Known form view names (from admin modules).
 * @deprecated Use KnownViewNames instead — list/form filtering is now type-level.
 */
export type KnownFormViewNames = RegistryNames<"views">;

/** Known component names (from admin modules). @see Registry['components'] */
export type KnownComponentNames = RegistryNames<"components">;

/**
 * Extract flat AppContext services from a Questpie app instance.
 * Used by all context creation functions (hooks, access, routes, jobs).
 *
 * @param app - Questpie app instance (typed as `any` to avoid circular deps)
 * @param overrides - Optional overrides (e.g. db from transaction, session from request)
 * @returns Flat service object matching AppContext shape
 */
export function extractAppServices(
	app: any,
	overrides?: { db?: any; session?: any; locale?: string },
): Record<string, unknown> {
	if (!app) return { db: overrides?.db };
	const result: Record<string, unknown> = {
		app,
		db: overrides?.db ?? app.db,
		session: overrides?.session ?? null,
		services: {},
		queue: app.queue,
		email: app.email,
		storage: app.storage,
		kv: app.kv,
		logger: app.logger,
		search: app.search,
		realtime: app.realtime,
		collections: app.api?.collections,
		globals: app.api?.globals,
		t: app.t,
	};

	const serviceDefs = app._serviceDefs ?? app.config?.services;
	if (serviceDefs) {
		const services: Record<string, unknown> = {};

		for (const [name, input] of Object.entries(
			serviceDefs as Record<string, any>,
		)) {
			const instance = app.resolveService(name, {
				db: result.db,
				session: result.session,
				locale: overrides?.locale,
			});

			const state =
				input && typeof input === "object" && "state" in input
					? (input.state as Record<string, unknown>)
					: (input as Record<string, unknown>);
			const namespace = state?.namespace as string | null | undefined;

			if (namespace === undefined || namespace === "services") {
				services[name] = instance;
				continue;
			}

			if (namespace === null) {
				result[name] = instance;
				continue;
			}

			if (!(namespace in result) || typeof result[namespace] !== "object") {
				result[namespace] = {};
			}

			(result[namespace] as Record<string, unknown>)[name] = instance;
		}

		result.services = services;
	}

	return result;
}
