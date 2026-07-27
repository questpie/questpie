import { describe, expect, it, mock } from "bun:test";

import { collection } from "../../src/exports/index.js";
import {
	buildIndexParams,
	isSearchableConfigEnabled,
	resolveAutomaticSearchableConfig,
} from "../../src/server/modules/core/integrated/search/index-params.js";
import { reindexCollection } from "../../src/server/modules/core/integrated/search/reindex.js";

describe("Search indexing requires explicit opt-in", () => {
	it("does not build automatic projections for undefined, false, disabled, or manual config", async () => {
		const base = {
			collection: "posts",
			locale: "en",
			app: {},
			defaultLocale: "en",
		};
		const record = { id: "post-1", _title: "Post" };

		for (const searchable of [
			undefined,
			false,
			{ disabled: true },
			{ manual: true },
		] as const) {
			expect(
				await buildIndexParams(record, { ...base, searchable }),
			).toBeNull();
			expect(resolveAutomaticSearchableConfig(searchable)).toBeNull();
		}
	});

	it("uses an explicit empty config for a title-only default projection", async () => {
		const params = await buildIndexParams(
			{ id: "post-1", _title: "Post", body: "Hello" },
			{
				collection: "posts",
				locale: "en",
				searchable: {},
				app: {},
				defaultLocale: "en",
			},
		);

		expect(params).toMatchObject({
			collection: "posts",
			recordId: "post-1",
			title: "Post",
		});
		expect(params?.content).toBeUndefined();
		expect(isSearchableConfigEnabled({})).toBe(true);
		expect(isSearchableConfigEnabled({ manual: true })).toBe(true);
		expect(isSearchableConfigEnabled(undefined)).toBe(false);
	});

	it("indexes content only when the projection declares it explicitly", async () => {
		const params = await buildIndexParams(
			{ id: "post-1", _title: "Post", body: "Hello" },
			{
				collection: "posts",
				locale: "en",
				searchable: { content: (record) => record.body },
				app: {},
				defaultLocale: "en",
			},
		);

		expect(params?.content).toBe("Hello");
	});

	it("skips reindex before reading an implicitly configured collection", async () => {
		const find = mock(async () => ({ docs: [] }));
		const result = await reindexCollection(
			{
				search: { indexBatch: mock(async () => {}) },
				collections: {
					posts: {
						find,
						findOne: mock(async () => null),
					},
				},
				getCollectionConfig: () => ({ state: { searchable: undefined } }),
			},
			"posts",
		);

		expect(result).toEqual({
			collection: "posts",
			indexed: 0,
			skipped: true,
		});
		expect(find).not.toHaveBeenCalled();
	});

	it("supports the documented searchable(false) builder shorthand", () => {
		const disabled = collection("internal").searchable(false);
		expect(disabled.state.searchable).toBe(false);
	});
});
