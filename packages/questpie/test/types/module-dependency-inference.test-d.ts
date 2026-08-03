/**
 * `module()` must keep its dependency list a tuple.
 *
 * Codegen writes `as const` in modules.ts, so the generated form dodges this.
 * The hand-written form does not. Without it the literal `[dep]` widens to an
 * array, and the folds in codegen-type-utils.ts only match a readonly tuple.
 * Every collection, route and job of every dependency then drops out of the
 * consuming app's types, with no error anywhere.
 *
 * Compile-time only. Run with `tsc --noEmit`.
 */

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type { MergeModuleProp } from "#questpie/server/config/codegen-type-utils.js";
import { module } from "#questpie/server/config/create-app.js";

import type { Equal, Expect, HasKey } from "./type-test-utils.js";

const postsCollection = collection("posts").fields(({ f }) => ({
	title: f.text(255).required(),
}));

const depModule = module({
	name: "dep",
	collections: { posts: postsCollection },
});

const appModule = module({
	name: "app",
	modules: [depModule],
});

// The dependency list survives as a fixed-arity tuple, not as an array.
// Matched against `readonly [...]` on purpose: `ModuleDefinition.modules` is a
// mutable array today, so const inference yields `[dep]`. Making that field
// readonly would yield `readonly [dep]`. Both satisfy this; an array does not.
type _dependencyListIsATuple = Expect<
	Equal<
		typeof appModule.modules extends readonly [infer TOnly] ? TOnly : never,
		typeof depModule
	>
>;

// What the tuple is for: the fold can walk it and reach the dependency's
// contributions. An array collapses this to `{}`.
type AppCollections = MergeModuleProp<typeof appModule.modules, "collections">;

type _dependencyCollectionsSurvive = Expect<HasKey<AppCollections, "posts">>;

type _dependencyCollectionKeepsItsType = Expect<
	Equal<
		AppCollections extends { posts: infer TPosts } ? TPosts : never,
		typeof postsCollection
	>
>;
