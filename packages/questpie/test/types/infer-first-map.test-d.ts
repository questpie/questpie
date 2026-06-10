/**
 * Infer-First Map Type Tests (P0)
 *
 * Compile-time only — run with: tsc --noEmit
 *
 * Covers the package-level pieces of the infer-first map:
 * - `KnownCollectionKey` / `KnownGlobalKey` / `KnownJobKey` consume the
 *   names-only `Questpie.CollectionKeys` registry (codegen-emitted) and keep
 *   the `(string & {})` fallback so plain strings always compile.
 * - `relation()` targets accept known keys AND arbitrary strings (autocomplete,
 *   not strictness).
 * - `InferRouteInput` / `InferRouteOutput` / `InferRouteParams` round-trip a
 *   route definition (tRPC parity — exported from `questpie/types`).
 * - `ContextResolverParams` degrades gracefully pre-codegen.
 */

import { z } from "zod";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type {
	KnownCollectionKey,
	KnownGlobalKey,
	KnownJobKey,
} from "#questpie/server/config/app-context.js";
import type { ContextResolverParams } from "#questpie/server/config/types.js";
import { route } from "#questpie/server/routes/define-route.js";
import type {
	InferRouteInput,
	InferRouteOutput,
	InferRouteParams,
	RouteParamsFromKey,
	RouteWithParams,
} from "#questpie/server/routes/types.js";

import type { Equal, Expect, Extends } from "./type-test-utils.js";

// ============================================================================
// Names-only key registry — simulates the codegen-emitted augmentation
// (factories.ts / module.ts emit exactly this shape: zero type references)
// ============================================================================

declare global {
	namespace Questpie {
		interface CollectionKeys {
			posts: unknown;
			authors: unknown;
		}
		interface GlobalKeys {
			settings: unknown;
		}
		interface JobKeys {
			sendNewsletter: unknown;
		}
	}
}

// Known keys are part of the union…
type _postsKnown = Expect<Extends<"posts", KnownCollectionKey>>;
type _authorsKnown = Expect<Extends<"authors", KnownCollectionKey>>;
type _settingsKnown = Expect<Extends<"settings", KnownGlobalKey>>;
type _jobKnown = Expect<Extends<"sendNewsletter", KnownJobKey>>;

// …and arbitrary strings still pass (names only — never strict).
type _anyStringStillWorks = Expect<Extends<"not_generated", KnownCollectionKey>>;
type _anyGlobalString = Expect<Extends<"whatever", KnownGlobalKey>>;

// ============================================================================
// relation() — known keys autocomplete, plain strings keep compiling
// ============================================================================

const withRelations = collection("articles").fields(({ f }) => ({
	// Known key from the registry
	author: f.relation("authors").required(),
	// Arbitrary string — must stay legal (no-codegen / library contexts)
	anything: f.relation("some_custom_collection"),
	// Polymorphic map — keys/values accept known keys and plain strings
	subject: f.relation({ posts: "posts", custom: "custom_target" }),
	// Junction via known key
	tags: f.relation("posts").manyToMany({ through: "post_tags" }),
}));

// Literal target inference is preserved through the constraint
type ArticlesFields = (typeof withRelations)["state"]["fieldDefinitions"];
type AuthorRelTo = ArticlesFields["author"]["_"]["relationTo"];
type _literalPreserved = Expect<Equal<AuthorRelTo, "authors">>;

// ============================================================================
// InferRouteInput / InferRouteOutput / InferRouteParams — standalone one-liners
// ============================================================================

const createPost = route()
	.post()
	.schema(
		z.object({
			title: z.string(),
			tags: z.array(z.string()).optional(),
		}),
	)
	.handler(async ({ input }) => {
		return { id: "1", title: input.title, tagCount: input.tags?.length ?? 0 };
	});

type CreatePostInput = InferRouteInput<typeof createPost>;
type CreatePostOutput = InferRouteOutput<typeof createPost>;

type _inputRoundTrip = Expect<
	Equal<CreatePostInput, { title: string; tags?: string[] | undefined }>
>;
type _outputRoundTrip = Expect<
	Equal<CreatePostOutput, { id: string; title: string; tagCount: number }>
>;

// Params flow through RouteWithParams (the generated AppRoutes shape)
type KeyedRoute = RouteWithParams<
	typeof createPost,
	RouteParamsFromKey<"posts/[postId]/comments">
>;
type KeyedParams = InferRouteParams<KeyedRoute>;
type _paramsRoundTrip = Expect<Equal<KeyedParams["postId"], string>>;

// ============================================================================
// ContextResolverParams — lazy off AppContext, loose fallback pre-codegen
// ============================================================================

// Pre-codegen (AppContext not augmented in this package) the fallbacks apply:
type ResolverSession = ContextResolverParams["session"];
type _sessionFallback = Expect<
	Extends<{ user: { id: string }; session: {} } | null, ResolverSession>
>;
type _dbFallbackIsAny = Expect<Equal<ContextResolverParams["db"], any>>;
