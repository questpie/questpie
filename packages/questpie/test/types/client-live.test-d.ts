/**
 * Client Live Query Type Tests
 *
 * Verifies that `live()` / `liveIter()` mirror `find()` / `get()` typing:
 * same Where/With aliases on the way in, same result type on the way out.
 *
 * Run with: tsc --noEmit
 */

import type { QuestpieClient } from "#questpie/client/index.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import { global } from "#questpie/server/global/builder/global-builder.js";

import type { Equal, Expect } from "./type-test-utils.js";

// ============================================================================
// Test fixtures
// ============================================================================

const users = collection("users").fields(({ f }) => ({
	name: f.text(255).required(),
}));

const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).required(),
	status: f.text(64).required(),
	views: f.number().default(0),
	author: f.relation("users").required().relationName("author"),
}));

const settings = global("settings").fields(({ f }) => ({
	siteName: f.text(255).required(),
	owner: f.relation("users").relationName("owner"),
}));

type App = {
	collections: { users: typeof users; posts: typeof posts };
	globals: { settings: typeof settings };
};

declare const client: QuestpieClient<App>;

// ============================================================================
// Collection live() — snapshot type equals find() result type
// ============================================================================

type Query = { where: { status: string }; with: { author: true }; limit: 10 };

type FindResultFor<TQuery extends Query> = Awaited<
	ReturnType<typeof client.collections.posts.find<TQuery>>
>;

declare const liveForQuery: typeof client.collections.posts.live<Query>;
type LiveSnapshot = Parameters<Parameters<typeof liveForQuery>[1]>[0];

type _liveSnapshotEqualsFindResult = Expect<
	Equal<LiveSnapshot, FindResultFor<Query>>
>;

// Unsubscribe function
declare const stop: ReturnType<typeof client.collections.posts.live>;
type _stopIsUnsubscribe = Expect<Equal<typeof stop, () => void>>;

// Snapshot is `with`-aware: loaded relation replaces the FK column
client.collections.posts.live(
	{ where: { status: "published" }, with: { author: true } },
	(snapshot) => {
		const doc = snapshot.docs[0];
		type _authorLoaded = Expect<Equal<typeof doc.author.name, string>>;
	},
);

// Without `with`, the FK column stays a plain id
client.collections.posts.live(
	{ where: { status: "published" } },
	(snapshot) => {
		const doc = snapshot.docs[0];
		type _authorIsFk = Expect<Equal<typeof doc.author, string>>;
	},
);

// ============================================================================
// Collection live() — rejects invalid queries
// ============================================================================

// Note: unknown `where` keys are accepted by both find() and live() (select
// types carry an index signature) — live() mirrors find() exactly, so only
// wrong-typed values on known fields are asserted here.

// @ts-expect-error wrong value type for views (number field)
client.collections.posts.live({ where: { views: "not-a-number" } }, () => {});

// @ts-expect-error unknown relation in with
client.collections.posts.live({ with: { comments: true } }, () => {});

// @ts-expect-error groupBy is not part of the live wire contract (would change result shape)
client.collections.posts.live({ groupBy: "status" }, () => {});

// @ts-expect-error columns is not part of the live wire contract (snapshots are full results)
client.collections.posts.live({ columns: { title: true } }, () => {});

// ============================================================================
// Collection liveIter() — yields the same snapshot type
// ============================================================================

declare const liveIterForQuery: ReturnType<
	typeof client.collections.posts.liveIter<Query>
>;
type LiveIterYield =
	typeof liveIterForQuery extends AsyncGenerator<infer TYield, any, any>
		? TYield
		: never;

type _liveIterYieldsFindResult = Expect<
	Equal<LiveIterYield, FindResultFor<Query>>
>;

// ============================================================================
// Global live() — snapshot type equals get() result type
// ============================================================================

type GlobalQuery = { with: { owner: true } };

type GetResultFor<TQuery extends GlobalQuery> = Awaited<
	ReturnType<typeof client.globals.settings.get<TQuery>>
>;

declare const globalLiveForQuery: typeof client.globals.settings.live<GlobalQuery>;
type GlobalLiveSnapshot = Parameters<
	Parameters<typeof globalLiveForQuery>[1]
>[0];

type _globalLiveEqualsGetResult = Expect<
	Equal<GlobalLiveSnapshot, GetResultFor<GlobalQuery>>
>;

client.globals.settings.live(undefined, (snapshot) => {
	type _siteName = Expect<Equal<typeof snapshot.siteName, string>>;
});

// @ts-expect-error unknown relation in global with
client.globals.settings.live({ with: { nonExistent: true } }, () => {});
