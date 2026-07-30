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

const news = collection("news")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		views: f.number().default(0),
		author: f.relation("authors").required().relationName("author"),
	}))
	.options({ softDelete: true });
const locked = collection("locked")
	.fields(({ f }) => ({
		title: f.text(255).required(),
	}))
	.options({
		softDelete: true,
		optimisticConcurrency: true,
	});

const settings = global("settings").fields(({ f }) => ({
	siteName: f.text(255).required(),
}));

type App = {
	collections: {
		authors: typeof authors;
		news: typeof news;
		locked: typeof locked;
	};
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
		const findOne = () => q.collections.news.findOne({ where: { title: "x" } });
		type OneResult = DataOf<ReturnType<typeof findOne>>;
		type _nullable = Expect<Equal<null extends OneResult ? true : false, true>>;
		type _oneTitle = Expect<Equal<NonNullable<OneResult>["title"], string>>;

		// global get is narrowed too
		const getSettings = () => q.globals.settings.get();
		type Settings = DataOf<ReturnType<typeof getSettings>>;
		type _siteName = Expect<Equal<Settings["siteName"], string>>;

		// purge stays a separately named, typed by-id mutation
		type Purge = ReturnType<(typeof q.collections.news)["purgeById"]>;
		const purge = null as unknown as Purge;
		type PurgeVariables =
			NonNullable<typeof purge.mutationFn> extends (
				variables: infer TVariables,
				...args: any[]
			) => any
				? TVariables
				: never;
		type _purgeId = Expect<Equal<PurgeVariables, { id: string }>>;
		type _hardDeleteHasNoPurge = Expect<
			Equal<
				"purgeById" extends keyof typeof q.collections.authors ? true : false,
				false
			>
		>;
		const lockedPurge = () => q.collections.locked.purgeById();
		type LockedPurgeVariables =
			NonNullable<ReturnType<typeof lockedPurge>["mutationFn"]> extends (
				variables: infer TVariables,
				...args: any[]
			) => any
				? TVariables
				: never;
		const safeLockedPurge: LockedPurgeVariables = {
			id: "record-1",
			expectedRevision: 2,
		};
		// @ts-expect-error TanStack purge requires the current tombstone version
		const unsafeLockedPurge: LockedPurgeVariables = { id: "record-1" };

		type LockedUpdate = ReturnType<(typeof q.collections.locked)["update"]>;
		type LockedUpdateVariables =
			NonNullable<LockedUpdate["mutationFn"]> extends (
				variables: infer TVariables,
				...args: any[]
			) => any
				? TVariables
				: never;
		const lockedUpdate: LockedUpdateVariables = {
			id: "record-1",
			expectedRevision: 1,
			data: { title: "Updated" },
		};
		// @ts-expect-error TanStack mutations require the configured version
		const unsafeLockedUpdate: LockedUpdateVariables = {
			id: "record-1",
			data: { title: "Unsafe" },
		};
		const lockedMany = () => q.collections.locked.updateMany();
		type LockedManyVariables =
			NonNullable<ReturnType<typeof lockedMany>["mutationFn"]> extends (
				variables: infer TVariables,
				...args: any[]
			) => any
				? TVariables
				: never;
		const lockedBulk: LockedManyVariables = {
			where: { id: "record-1" },
			expectedRevisions: [{ id: "record-1", expectedRevision: 1 }],
			data: { title: "Updated" },
		};
		const lockedRevert = () => q.collections.locked.revertToVersion();
		type LockedRevertVariables =
			NonNullable<ReturnType<typeof lockedRevert>["mutationFn"]> extends (
				variables: infer TVariables,
				...args: any[]
			) => any
				? TVariables
				: never;
		const safeLockedRevert: LockedRevertVariables = {
			id: "record-1",
			version: 1,
			expectedRevision: 2,
		};
		// @ts-expect-error TanStack revert requires the configured version
		const unsafeLockedRevert: LockedRevertVariables = {
			id: "record-1",
			version: 1,
		};

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
			() => purge,
			() => safeLockedPurge,
			() => unsafeLockedPurge,
			() => lockedUpdate,
			() => unsafeLockedUpdate,
			() => lockedBulk,
			() => safeLockedRevert,
			() => unsafeLockedRevert,
			lockedMany,
			lockedRevert,
			lockedPurge,
		];
		expect(builders.length).toBe(18);
	});
});
