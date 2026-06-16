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
// Names-only key registry — populated-registry semantics via a LOCAL lens.
//
// A `declare global { namespace Questpie { interface CollectionKeys {…} } }`
// here would be WHOLE-PROGRAM: it pollutes every other package test file and
// makes the strict `StrictCollectionKey` finite across the entire framework
// build (breaking all relation surfaces that target names outside this set).
// The registry is populated PER-APP by codegen, never in a shared package
// fixture — so the populated-key semantics for the LOOSE `Known*Key` types are
// proven over a local fake-registry mirror (the same isolation strategy CL-06
// uses for `StrictCollectionKey`), keeping the real registry EMPTY in-package.
// ============================================================================

/** The loose `Known*Key` body, parameterized over a fake registry lens. */
type KnownOver<R> = [keyof R] extends [never]
	? string & {}
	: (keyof R & string) | (string & {});

interface FakeCollectionKeys {
	posts: unknown;
	authors: unknown;
}
interface FakeGlobalKeys {
	settings: unknown;
}
interface FakeJobKeys {
	sendNewsletter: unknown;
}

// The real loose aliases bind to exactly the `KnownOver<registry>` formula.
type _knownColMatchesFormula = Expect<
	Equal<KnownCollectionKey, KnownOver<Questpie.CollectionKeys>>
>;
type _knownGlobalMatchesFormula = Expect<
	Equal<KnownGlobalKey, KnownOver<Questpie.GlobalKeys>>
>;
type _knownJobMatchesFormula = Expect<
	Equal<KnownJobKey, KnownOver<Questpie.JobKeys>>
>;

// Known keys are part of the union (proven over the populated lens)…
type _postsKnown = Expect<Extends<"posts", KnownOver<FakeCollectionKeys>>>;
type _authorsKnown = Expect<Extends<"authors", KnownOver<FakeCollectionKeys>>>;
type _settingsKnown = Expect<Extends<"settings", KnownOver<FakeGlobalKeys>>>;
type _jobKnown = Expect<Extends<"sendNewsletter", KnownOver<FakeJobKeys>>>;

// …and arbitrary strings still pass (names only — never strict).
type _anyStringStillWorks = Expect<
	Extends<"not_generated", KnownOver<FakeCollectionKeys>>
>;
type _anyGlobalString = Expect<Extends<"whatever", KnownOver<FakeGlobalKeys>>>;

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

// Field-level assertions — the inferred object's exact shape (intersections,
// modifier normalization) may differ across zod/TS versions; what matters is
// that each field round-trips with the right type.
type _inputTitle = Expect<Equal<CreatePostInput["title"], string>>;
type _inputTags = Expect<Equal<CreatePostInput["tags"], string[] | undefined>>;
type _inputShape = Expect<
	Extends<{ title: string; tags: string[] }, CreatePostInput>
>;
// Output is a union (handlers may also return Response/error envelopes) —
// the practical guarantee is that the success shape is one of the arms.
type _outputHasSuccessShape = Expect<
	Extends<{ id: string; title: string; tagCount: number }, CreatePostOutput>
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

// Pre-codegen (the `Questpie.ContextResolverBase` seam not yet filled) the
// loose-but-NOT-`any` fallback applies (CL-05 cyc-4): `session`/`db` route
// through the dedicated `ResolvedContextResolverBase` seam — no longer the full
// augmented `AppContext` (which held a live re-cycle) and no longer the old
// blanket `any`. Pre-codegen they degrade to `unknown`, never `any`.
type ResolverSession = ContextResolverParams["session"];
type _sessionFallback = Expect<
	Extends<{ user: { id: string }; session: {} } | null, ResolverSession>
>;
type _dbFallbackIsUnknownNotAny = Expect<
	Equal<ContextResolverParams["db"], unknown>
>;
