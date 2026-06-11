/**
 * Compile-time contracts for the typed query-options proxy.
 *
 * `find` / `findOne` / `get` are generic per call — results must match the
 * direct client's narrowing (relations loaded via `with`, field typos
 * rejected) instead of collapsing to `PaginatedResult<{}>`.
 */

import { describe, expect, it } from "bun:test";

import type { UseQueryOptions } from "@tanstack/react-query";
import { collection, global } from "questpie";

import type { QuestpieQueryOptionsProxy } from "./index.js";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;

const authors = collection("authors").fields(({ f }) => ({
	name: f.text(255).required(),
}));

const news = collection("news").fields(({ f }) => ({
	title: f.text(255).required(),
	views: f.number().default(0),
	author: f.relation("authors").required().relationName("author"),
}));

const settings = global("settings").fields(({ f }) => ({
	siteName: f.text(255).required(),
}));

type App = {
	collections: { authors: typeof authors; news: typeof news };
	globals: { settings: typeof settings };
};

type DataOf<T> = T extends UseQueryOptions<infer TData> ? TData : never;

describe("typed query options proxy", () => {
	it("narrows find/findOne/get results per call", () => {
		const q = {} as QuestpieQueryOptionsProxy<App>;

		// find with a loaded relation — docs are NOT `{}`
		const findWith = () => q.collections.news.find({ with: { author: true } });
		type WithDoc = DataOf<ReturnType<typeof findWith>>["docs"][number];
		type _titleTyped = Expect<Equal<WithDoc["title"], string>>;
		type _authorLoaded = Expect<Equal<WithDoc["author"]["name"], string>>;

		// find without `with` — the FK column stays a plain id
		const findPlain = () => q.collections.news.find({ limit: 1 });
		type PlainDoc = DataOf<ReturnType<typeof findPlain>>["docs"][number];
		type _authorIsFk = Expect<Equal<PlainDoc["author"], string>>;

		// findOne result is nullable and narrowed the same way
		const findOne = () =>
			q.collections.news.findOne({ where: { title: "x" } });
		type OneResult = DataOf<ReturnType<typeof findOne>>;
		type _nullable = Expect<Equal<null extends OneResult ? true : false, true>>;
		type _oneTitle = Expect<
			Equal<NonNullable<OneResult>["title"], string>
		>;

		// global get is narrowed too
		const getSettings = () => q.globals.settings.get();
		type Settings = DataOf<ReturnType<typeof getSettings>>;
		type _siteName = Expect<Equal<Settings["siteName"], string>>;

		// relation typos in `with` are compile errors (direct-client parity)
		// @ts-expect-error unknown relation in with must not typecheck
		const badWith = () => q.collections.news.find({ with: { nope: true } });

		// column typos are compile errors (direct-client parity)
		const badColumns = () =>
			// @ts-expect-error unknown column must not typecheck
			q.collections.news.find({ columns: { nope: true } });

		// fabricated collection names are compile errors
		// @ts-expect-error unknown collection must not typecheck
		const badCollection = () => q.collections.newz.find({ limit: 1 });

		const builders = [
			findWith,
			findPlain,
			findOne,
			getSettings,
			badWith,
			badColumns,
			badCollection,
		];
		expect(builders.length).toBe(7);
	});
});
