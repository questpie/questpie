/**
 * `client.transaction()` — the cross-collection write surface.
 *
 * What is guaranteed here: operations are constrained per collection, results
 * are typed per POSITION (a tuple, not an array of a union), and
 * `expectedRevision` is required exactly where `optimisticConcurrency` makes it
 * required on the single-record methods.
 */

import type { QuestpieClient } from "#questpie/client/index.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";

import type { Equal, Expect, NoAny } from "./_assert.js";

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

const comments = collection("comments").fields(({ f }) => ({
	body: f.text().required(),
	upvotes: f.number(),
}));

const versionedDocs = collection("versioned_docs")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({ optimisticConcurrency: true });

type App = {
	collections: {
		posts: typeof posts;
		comments: typeof comments;
		versionedDocs: typeof versionedDocs;
	};
};

declare const client: QuestpieClient<App>;

// ── Results are typed per position ──────────────────────────────────────────

declare const results: Awaited<
	ReturnType<
		typeof client.transaction<
			[
				{ collection: "posts"; operation: "create"; data: { title: string } },
				{
					collection: "comments";
					operation: "update";
					id: string;
					data: { body: string };
				},
				{ collection: "posts"; operation: "delete"; id: string },
			]
		>
	>
>;

// A fixed length is what distinguishes a tuple from an array of a union.
type _ResultsAreATuple = Expect<Equal<(typeof results)["length"], 3>>;
type _CreateReturnsTheRow = Expect<Equal<(typeof results)[0]["title"], string>>;
type _UpdateReturnsTheOtherRow = Expect<
	Equal<(typeof results)[1]["body"], string>
>;
type _DeleteReturnsSuccessAndRow = Expect<
	Equal<(typeof results)[2]["success"], boolean>
>;
type _DeletePayloadIsTheRow = Expect<
	Equal<(typeof results)[2]["data"]["title"], string>
>;
type _NoAnyLeakedIn = NoAny<(typeof results)[0]>;

// A literal call site infers the same tuple without an explicit type argument.
const inferred = client.transaction([
	{ collection: "posts", operation: "create", data: { title: "Hello" } },
	{ collection: "posts", operation: "delete", id: "post-1" },
]);
type _InferredCreateRow = Expect<
	Equal<Awaited<typeof inferred>[0]["title"], string>
>;
type _InferredDeleteResult = Expect<
	Equal<Awaited<typeof inferred>[1]["success"], boolean>
>;

// ── Operations are constrained per collection ───────────────────────────────

client.transaction([
	{ collection: "posts", operation: "create", data: { title: "Hello" } },
	{ collection: "comments", operation: "create", data: { body: "Hi" } },
	{ collection: "comments", operation: "delete", id: "comment-1" },
]);

client.transaction([
	// @ts-expect-error `body` is a comments field, not a posts field
	{ collection: "posts", operation: "create", data: { body: "Hello" } },
]);

client.transaction([
	// @ts-expect-error there is no such collection
	{ collection: "ghosts", operation: "create", data: { title: "Hello" } },
]);

client.transaction([
	// @ts-expect-error bulk verbs have no meaning inside an ordered batch
	{ collection: "posts", operation: "updateMany", where: {}, data: {} },
]);

// ── expectedRevision follows optimisticConcurrency ──────────────────────────

client.transaction([
	{
		collection: "versionedDocs",
		operation: "update",
		id: "doc-1",
		expectedRevision: 3,
		data: { title: "Renamed" },
	},
	{
		collection: "versionedDocs",
		operation: "delete",
		id: "doc-2",
		expectedRevision: 1,
	},
]);

client.transaction([
	// @ts-expect-error an optimistically-concurrent update needs its revision
	{
		collection: "versionedDocs",
		operation: "update",
		id: "doc-1",
		data: { title: "Unsafe" },
	},
]);

client.transaction([
	// @ts-expect-error an optimistically-concurrent delete needs its revision
	{ collection: "versionedDocs", operation: "delete", id: "doc-1" },
]);

// A collection without the option still accepts the plain form.
client.transaction([
	{
		collection: "posts",
		operation: "update",
		id: "post-1",
		data: { title: "x" },
	},
	{ collection: "posts", operation: "delete", id: "post-2" },
]);
