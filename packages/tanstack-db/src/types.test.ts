import { describe, expect, it } from "bun:test";

import type { Collection } from "@tanstack/db";
import { collection } from "questpie";

import type {
	CollectionRowOf,
	FindOptionsOf,
	IdOf,
	QuestpieDb,
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

		expect(checkTypes).toBeInstanceOf(Function);
	});
});
