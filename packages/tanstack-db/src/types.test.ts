import { describe, expect, it } from "bun:test";

import type { Collection } from "@tanstack/db";
import type { QueryClient } from "@tanstack/react-query";
import { collection } from "questpie";
import type { QuestpieClient } from "questpie/client";

import { eq, useLiveQuery } from "./exports/index.js";
import {
	createQuestpieCollections,
	SNAPSHOT_UNSUPPORTED_FIND_OPTIONS,
} from "./factory.js";
import type {
	CollectionRowOf,
	FindOptionsOf,
	IdOf,
	QuestpieDb,
	SnapshotFindOptionsOf,
} from "./types.js";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;

const authors = collection("authors").fields(({ f }) => ({
	name: f.text(255).required(),
}));

const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).required(),
	author: f.relation("authors").required().relationName("author"),
}));

type App = {
	collections: { authors: typeof authors; posts: typeof posts };
};

describe("tanstack-db types", () => {
	it("maps each QUESTPIE collection to one base-select row collection", () => {
		type Post = CollectionRowOf<App, "posts">;
		const directFind = (client: QuestpieClient<App>) =>
			client.collections.posts.find();
		type DirectPost = Awaited<ReturnType<typeof directFind>>["docs"][number];
		type _sameAsClientFind = Expect<Equal<Post, DirectPost>>;
		type _title = Expect<Equal<Post["title"], string>>;
		type _foreignKey = Expect<Equal<Post["author"], string>>;
		type _id = Expect<Equal<IdOf<Post>, string>>;
		type _whereTitle = Expect<
			Equal<
				NonNullable<FindOptionsOf<App, "posts">["where"]> extends {
					title?: unknown;
				}
					? true
					: false,
				true
			>
		>;

		const checkTypes = (db: QuestpieDb<App>) => {
			const typed: Collection<Post, string> = db.collections.posts;
			// @ts-expect-error unknown collections must not be fabricated
			const unknown = db.collections.comments;
			return [typed, unknown];
		};
		const checkFindOptions = (options: FindOptionsOf<App, "posts">) => options;
		// @ts-expect-error projections can remove the required id
		checkFindOptions({ columns: { title: true } });
		// @ts-expect-error relation expansion changes the base-row shape
		checkFindOptions({ with: { author: true } });

		expect(checkTypes).toBeInstanceOf(Function);
	});

	it("narrows snapshot find options to what the realtime topic carries", () => {
		type SnapshotKeys = keyof SnapshotFindOptionsOf<App, "posts">;
		type _topicFields = Expect<
			Equal<SnapshotKeys, "where" | "orderBy" | "limit" | "offset" | "locale">
		>;
		// The runtime guard and the type must name the same options.
		type _guardMatchesType = Expect<
			Equal<
				Exclude<keyof FindOptionsOf<App, "posts">, SnapshotKeys>,
				(typeof SNAPSHOT_UNSUPPORTED_FIND_OPTIONS)[number]
			>
		>;

		const checkSnapshotFindOptions = (
			options: SnapshotFindOptionsOf<App, "posts">,
		) => options;
		// @ts-expect-error a live subscription cannot carry search
		checkSnapshotFindOptions({ search: "questpie" });

		const checkSnapshotRegistry = (
			client: QuestpieClient<App>,
			queryClient: QueryClient,
		) =>
			createQuestpieCollections(client, {
				queryClient,
				syncMode: "snapshot",
				// @ts-expect-error a live subscription cannot carry includeDeleted
				find: { posts: { includeDeleted: true } },
			});

		expect(checkSnapshotRegistry).toBeInstanceOf(Function);
	});

	it("keeps live-query where and join fields typed", () => {
		const buildTypedQuery = (db: QuestpieDb<App>) =>
			useLiveQuery((q) =>
				q
					.from({ post: db.collections.posts })
					.join({ author: db.collections.authors }, ({ post, author }) =>
						eq(post.author, author.id),
					)
					.where(({ post }) => eq(post.title, "Published"))
					.select(({ post, author }) => ({
						postTitle: post.title,
						authorName: author?.name,
					})),
			);

		expect(buildTypedQuery).toBeInstanceOf(Function);
	});
});
