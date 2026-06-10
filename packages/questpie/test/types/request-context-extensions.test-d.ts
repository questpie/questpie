/**
 * Request-context extensions — type-level guarantees:
 *
 * 1. `ContextResolver` params pick up the codegen-emitted
 *    `Questpie.ContextResolverContext` global augmentation.
 * 2. `InferContextExtensionsFromApp` reads the `"~contextExtensions"` phantom
 *    from a generated app's config.
 * 3. `getContext<App>()` exposes resolver-derived keys flat on its result.
 */
import type {
	InferContextExtensionsFromApp,
	getContext,
} from "#questpie/server/config/context.js";
import { appConfig } from "#questpie/server/config/factories.js";
import type { ContextResolver } from "#questpie/server/config/types.js";

import type { Equal, Expect, Extends, HasKey } from "./type-test-utils.js";

// ── 1. Resolver params include the global augmentation ─────────────────────

// Simulates the root codegen template's emission:
// interface ContextResolverContext { collections: _CollectionsAPI; ... }
declare global {
	namespace Questpie {
		interface ContextResolverContext {
			collections: {
				probe_items: { count(options?: unknown): Promise<number> };
			};
		}
	}
}

type ResolverParams = Parameters<ContextResolver>[0];

type _paramsHaveRequest = Expect<Equal<ResolverParams["request"], Request>>;
type _paramsHaveCollections = Expect<
	Equal<
		ResolverParams["collections"]["probe_items"]["count"],
		(options?: unknown) => Promise<number>
	>
>;

// appConfig({ context }) resolvers get the augmented params contextually
const config = appConfig({
	context: async ({ request, collections }) => ({
		tenantId: request.headers.get("x-tenant"),
		probeCount: await collections.probe_items.count(),
	}),
});

// ── 2. InferContextExtensionsFromApp reads the config phantom ──────────────

// Shape of a generated app: Questpie instance exposing `config` with the
// codegen-set "~contextExtensions" phantom (always Partial — honest
// optionality for non-HTTP contexts).
type FakeExtensions = Partial<{ tenantId: string | null; probeCount: number }>;
type FakeApp = {
	config: { "~contextExtensions": FakeExtensions };
	db: { __brand: "db" };
};

type _inferredExtensions = Expect<
	Equal<InferContextExtensionsFromApp<FakeApp>, FakeExtensions>
>;

// Apps without the phantom (no codegen / plain Questpie) → no extension keys
type BareApp = { config: {}; db: unknown };
type _bareHasNoTenant = Expect<
	Equal<HasKey<InferContextExtensionsFromApp<BareApp>, "tenantId">, false>
>;

// ── 3. getContext<App>() exposes extensions flat, typed ────────────────────

type GetContextResult = ReturnType<typeof getContext<FakeApp>>;

type _getContextTenant = Expect<
	Equal<GetContextResult["tenantId"], string | null | undefined>
>;
type _getContextDb = Expect<Extends<GetContextResult["db"], { __brand: "db" }>>;
type _getContextKeepsBase = Expect<
	Equal<GetContextResult["locale"], string | undefined>
>;

export type { config };
