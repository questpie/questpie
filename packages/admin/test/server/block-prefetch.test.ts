/**
 * Block Prefetch Tests
 *
 * Tests for the block prefetch system:
 * 1. Block builder .prefetch() method stores configuration correctly
 * 2. Declarative prefetch ({ with: { field: true } }) works
 * 3. Functional prefetch (async fn) works
 * 4. Combined prefetch ({ with, loader }) works
 * 5. expandDeclaredFields correctly processes blocks
 */

import { describe, expect, mock, test } from "bun:test";

import { runWithContext, tryGetContext } from "questpie";

import type { BlocksDocument } from "#questpie/admin/server/fields/blocks.js";
import { block } from "#questpie/admin/server/modules/admin/block/block-builder.js";
import { introspectBlock } from "#questpie/admin/server/modules/admin/block/introspection.js";
import { processBlocksDocument } from "#questpie/admin/server/modules/admin/block/prefetch.js";
import { adminConfigDTOSchema } from "#questpie/admin/server/modules/admin/dto/admin-config.dto.js";

// ============================================================================
// Block Builder - Prefetch Configuration
// ============================================================================

describe("BlockBuilder - Prefetch Configuration", () => {
	test("should have .prefetch() method", () => {
		const b = block("test");
		expect(typeof b.prefetch).toBe("function");
	});

	test(".prefetch(fn) should store function on state", () => {
		const prefetchFn = async () => ({ data: "test" });
		const b = block("test").prefetch(prefetchFn);

		expect(b.state.prefetch).toBe(prefetchFn);
		expect(b.state.prefetchWith).toBeUndefined();
	});

	test(".prefetch({ with }) should store prefetchWith on state", () => {
		const b = block("test").prefetch({ with: { image: true } });

		expect(b.state.prefetchWith).toEqual({ image: true });
		expect(b.state.prefetch).toBeUndefined();
	});

	test(".prefetch({ with, loader }) should store both", () => {
		const loader = async () => ({ extra: "data" });
		const b = block("test").prefetch({
			with: { image: true },
			loader,
		});

		expect(b.state.prefetchWith).toEqual({ image: true });
		expect((b.state as any)._prefetchLoader).toBe(loader);
	});

	test("nested with config should be stored correctly", () => {
		const b = block("test").prefetch({
			with: {
				author: { with: { avatar: true } },
			},
		});

		expect(b.state.prefetchWith).toEqual({
			author: { with: { avatar: true } },
		});
	});
});

// ============================================================================
// Block Definition - Build
// ============================================================================

describe("BlockBuilder - Build", () => {
	test(".build() should create block definition with prefetch", () => {
		const prefetchFn = async () => ({ data: "test" });
		const b = block("hero").prefetch(prefetchFn);
		const def = b.build();

		expect(def.name).toBe("hero");
		expect(def.state.prefetch).toBe(prefetchFn);
	});

	test(".executePrefetch() should call prefetch function", async () => {
		const prefetchFn = mock(async () => ({ posts: [1, 2, 3] }));
		const b = block("featured").prefetch(prefetchFn);
		const def = b.build();

		const result = await def.executePrefetch(
			{ count: 5 },
			{ blockId: "1", blockType: "featured", app: {} as any, db: {} },
		);

		expect(prefetchFn).toHaveBeenCalled();
		expect(result).toEqual({ posts: [1, 2, 3] });
	});

	test(".executePrefetch() returns empty object when no prefetch", async () => {
		const b = block("simple");
		const def = b.build();

		const result = await def.executePrefetch(
			{},
			{ blockId: "1", blockType: "simple", app: {} as any, db: {} },
		);

		expect(result).toEqual({});
	});
});

// ============================================================================
// processBlocksDocument - Declarative Expansion
// ============================================================================

describe("processBlocksDocument - Declarative Expansion", () => {
	// Mock field definition with getMetadata
	const createMockField = (type: string, targetCollection: string) => ({
		getMetadata: () => ({
			type,
			targetCollection,
			relationType: "belongsTo",
		}),
	});

	// Mock block definitions
	const mockBlockDefinitions = {
		hero: {
			name: "hero",
			state: {
				name: "hero",
				prefetchWith: { backgroundImage: true },
				fields: {
					title: createMockField("text", ""),
					backgroundImage: createMockField("relation", "assets"),
				},
			},
			getFieldMetadata: () => ({}),
			executePrefetch: async () => ({}),
		},
		team: {
			name: "team",
			state: {
				name: "team",
				prefetch: async () => ({ barbers: [] }),
				fields: {
					title: createMockField("text", ""),
				},
			},
			getFieldMetadata: () => ({}),
			executePrefetch: async () => ({ barbers: [] }),
		},
	};

	test("should return null/undefined for null/undefined input", async () => {
		const result1 = await processBlocksDocument(null, mockBlockDefinitions, {
			app: {} as any,
			db: {},
		});
		const result2 = await processBlocksDocument(
			undefined,
			mockBlockDefinitions,
			{
				app: {} as any,
				db: {},
			},
		);

		expect(result1).toBeNull();
		expect(result2).toBeUndefined();
	});

	test("should return input unchanged if no _tree", async () => {
		const input = { _values: {} } as any;
		const result = await processBlocksDocument(input, mockBlockDefinitions, {
			app: {} as any,
			db: {},
		});

		expect(result).toBe(input);
	});

	test("should return input unchanged if no _values", async () => {
		const input = { _tree: [] } as any;
		const result = await processBlocksDocument(input, mockBlockDefinitions, {
			app: {} as any,
			db: {},
		});

		expect(result).toBe(input);
	});

	test("should process blocks with prefetch function", async () => {
		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "team-1", type: "team", children: [] }],
			_values: { "team-1": { title: "Our Team" } },
		};

		const result = await processBlocksDocument(
			blocksDoc,
			mockBlockDefinitions,
			{
				app: {} as any,
				db: {},
			},
		);

		expect(result?._data).toBeDefined();
		expect(result?._data?.["team-1"]).toEqual({ barbers: [] });
	});

	test("should resolve block definitions by runtime name", async () => {
		const imageTextBlock = {
			name: "image-text",
			state: {
				name: "image-text",
				prefetch: async () => ({ image: { id: "asset-1" } }),
				fields: {},
			},
			getFieldMetadata: () => ({}),
			executePrefetch: async () => ({ image: { id: "asset-1" } }),
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "image-text-1", type: "image-text", children: [] }],
			_values: { "image-text-1": {} },
		};

		const result = await processBlocksDocument(
			blocksDoc,
			{ imageText: imageTextBlock },
			{
				app: {} as any,
				db: {},
			},
		);

		expect(result?._data?.["image-text-1"]).toEqual({
			image: { id: "asset-1" },
		});
	});

	test("should handle nested blocks", async () => {
		const nestedBlockDefs = {
			...mockBlockDefinitions,
			columns: {
				name: "columns",
				state: {
					name: "columns",
					fields: {},
					allowChildren: true,
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [
				{
					id: "cols-1",
					type: "columns",
					children: [{ id: "team-1", type: "team", children: [] }],
				},
			],
			_values: {
				"cols-1": {},
				"team-1": { title: "Team" },
			},
		};

		const result = await processBlocksDocument(blocksDoc, nestedBlockDefs, {
			app: {} as any,
			db: {},
		});

		// Nested team block should be processed
		expect(result?._data?.["team-1"]).toEqual({ barbers: [] });
	});

	test("should handle prefetch errors gracefully", async () => {
		const errorBlockDefs = {
			broken: {
				name: "broken",
				state: {
					name: "broken",
					prefetch: async () => {
						throw new Error("Prefetch failed");
					},
					fields: {},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => {
					throw new Error("Prefetch failed");
				},
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "broken-1", type: "broken", children: [] }],
			_values: { "broken-1": {} },
		};

		const result = await processBlocksDocument(blocksDoc, errorBlockDefs, {
			app: {} as any,
			db: {},
		});

		// Should have error marker instead of crashing
		expect(result?._data?.["broken-1"]).toEqual({ _error: "Prefetch failed" });
	});

	test("stamps inherit-access marker on upload field expansion only", async () => {
		// Upload fields populate through the parent row's read decision (the
		// blocks doc came from a readable row); plain relations keep normal
		// target-collection access. The marker is the internal questpie symbol.
		const INHERIT_ACCESS = Symbol.for("questpie.internal.inheritAccess");

		const findAssets = mock(async (_options: any) => ({
			docs: [{ id: "asset-1", url: "/api/assets/files/key-1" }],
		}));
		const findPosts = mock(async (_options: any) => ({
			docs: [{ id: "post-1" }],
		}));

		const uploadBlockDefs = {
			hero: {
				name: "hero",
				state: {
					name: "hero",
					prefetchWith: { image: true, related: true },
					fields: {
						image: {
							getMetadata: () => ({
								type: "relation",
								targetCollection: "assets",
								relationType: "belongsTo",
								isUpload: true,
							}),
						},
						related: {
							getMetadata: () => ({
								type: "relation",
								targetCollection: "posts",
								relationType: "belongsTo",
							}),
						},
					},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "hero-1", type: "hero", children: [] }],
			_values: { "hero-1": { image: "asset-1", related: "post-1" } },
		};

		const result = await processBlocksDocument(
			blocksDoc,
			uploadBlockDefs as any,
			{
				app: {
					collections: {
						assets: { find: findAssets },
						posts: { find: findPosts },
					},
				} as any,
				db: {},
				session: null,
				accessMode: "user",
			},
		);

		expect(findAssets).toHaveBeenCalledTimes(1);
		expect(findPosts).toHaveBeenCalledTimes(1);

		const assetOptions = findAssets.mock.calls[0][0];
		const postOptions = findPosts.mock.calls[0][0];
		expect((assetOptions as any)[INHERIT_ACCESS]).toBe(true);
		expect((postOptions as any)[INHERIT_ACCESS]).toBeUndefined();

		expect(result?._data?.["hero-1"]?.image).toEqual({
			id: "asset-1",
			url: "/api/assets/files/key-1",
		});
	});
});

// ============================================================================
// processBlocksDocument - With Loader
// ============================================================================

describe("processBlocksDocument - With Loader", () => {
	test("passes caller CRUD context to declared field expansion", async () => {
		const db = { marker: "db" };
		const session = { user: { id: "admin-1", role: "admin" } };
		const findContexts: any[] = [];
		const findAssets = mock(async (_options: any, context: any) => {
			findContexts.push(context);
			return {
				docs: [{ id: "asset-123", url: "http://test.com/asset-123" }],
			};
		});

		const blockDefs = {
			hero: {
				name: "hero",
				state: {
					name: "hero",
					prefetchWith: { image: true },
					fields: {
						image: {
							getMetadata: () => ({
								type: "relation",
								targetCollection: "assets",
							}),
						},
					},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "hero-1", type: "hero", children: [] }],
			_values: { "hero-1": { image: "asset-123" } },
		};

		const result = await processBlocksDocument(blocksDoc, blockDefs, {
			app: {},
			db,
			session,
			locale: "sk",
			accessMode: "user",
			collections: { assets: { find: findAssets } },
		});

		expect(findAssets).toHaveBeenCalled();
		expect(findContexts[0]).toMatchObject({
			accessMode: "user",
			locale: "sk",
			session,
			db,
		});
		expect(result?._data?.["hero-1"]?.image).toEqual({
			id: "asset-123",
			url: "http://test.com/asset-123",
		});
	});

	test("runs loader inside caller user context", async () => {
		const session = { user: { id: "admin-1", role: "admin" } };
		const runtimeContexts: unknown[] = [];
		const loaderFn = mock(async ({ ctx }: any) => {
			runtimeContexts.push(tryGetContext());
			return {
				accessMode: ctx.accessMode,
				session: ctx.session,
			};
		});

		const blockDefs = {
			hero: {
				name: "hero",
				state: {
					name: "hero",
					_prefetchLoader: loaderFn,
					fields: {},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "hero-1", type: "hero", children: [] }],
			_values: { "hero-1": {} },
		};

		const result = await processBlocksDocument(blocksDoc, blockDefs, {
			app: {},
			db: { marker: "db" },
			session,
			locale: "en",
			accessMode: "user",
		});

		expect(loaderFn).toHaveBeenCalled();
		expect(result?._data?.["hero-1"]).toEqual({
			accessMode: "user",
			session,
		});
		expect((runtimeContexts[0] as any)?.accessMode).toBe("user");
		expect((runtimeContexts[0] as any)?.session).toBe(session);
	});

	test("preserves explicit unauthenticated session over parent context", async () => {
		const parentSession = { user: { id: "admin-1", role: "admin" } };
		const runtimeContexts: unknown[] = [];
		const loaderFn = mock(async () => {
			runtimeContexts.push(tryGetContext());
			return { ok: true };
		});
		const blockDefs = {
			hero: {
				name: "hero",
				state: {
					name: "hero",
					_prefetchLoader: loaderFn,
					fields: {},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};
		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "hero-1", type: "hero", children: [] }],
			_values: { "hero-1": {} },
		};

		await runWithContext(
			{
				app: {},
				db: {},
				session: parentSession,
				accessMode: "user",
			},
			() =>
				processBlocksDocument(blocksDoc, blockDefs, {
					app: {},
					db: {},
					session: null,
					accessMode: "user",
				}),
		);

		expect((runtimeContexts[0] as any)?.session).toBeNull();
		expect((runtimeContexts[0] as any)?.accessMode).toBe("user");
	});

	test("propagates caller context to nested loader collection and global reads", async () => {
		const session = { user: { id: "admin-1", role: "admin" } };
		const collectionContexts: unknown[] = [];
		const globalContexts: unknown[] = [];
		const collections = {
			restrictedPosts: {
				find: mock(async () => {
					collectionContexts.push(tryGetContext());
					return { docs: [] };
				}),
			},
		};
		const globals = {
			restrictedSettings: {
				get: mock(async () => {
					globalContexts.push(tryGetContext());
					return { id: "settings" };
				}),
			},
		};
		const loaderFn = mock(async ({ ctx }: any) => {
			await ctx.collections.restrictedPosts.find({});
			await ctx.globals.restrictedSettings.get({});
			return { ok: true };
		});

		const blockDefs = {
			hero: {
				name: "hero",
				state: {
					name: "hero",
					_prefetchLoader: loaderFn,
					fields: {},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "hero-1", type: "hero", children: [] }],
			_values: { "hero-1": {} },
		};

		const result = await processBlocksDocument(blocksDoc, blockDefs, {
			app: { collections, globals },
			db: { marker: "db" },
			session,
			accessMode: "user",
		});

		expect(result?._data?.["hero-1"]).toEqual({ ok: true });
		expect((collectionContexts[0] as any)?.accessMode).toBe("user");
		expect((collectionContexts[0] as any)?.session).toBe(session);
		expect((globalContexts[0] as any)?.accessMode).toBe("user");
		expect((globalContexts[0] as any)?.session).toBe(session);
	});

	test("should call loader with expanded data", async () => {
		const loaderFn = mock(async ({ expanded }: any) => ({
			processed: true,
			expandedKeys: Object.keys(expanded),
		}));

		const blockDefs = {
			hero: {
				name: "hero",
				state: {
					name: "hero",
					prefetchWith: { image: true },
					_prefetchLoader: loaderFn,
					fields: {
						image: {
							getMetadata: () => ({
								type: "relation",
								targetCollection: "assets",
							}),
						},
					},
				},
				getFieldMetadata: () => ({}),
				executePrefetch: async () => ({}),
			},
		};

		// Mock app with assets collection
		const mockApp = {
			collections: {
				assets: {
					find: async ({ where }: any) => ({
						docs: where.id.in.map((id: string) => ({
							id,
							url: `http://test.com/${id}`,
						})),
					}),
				},
			},
		};

		const blocksDoc: BlocksDocument = {
			_tree: [{ id: "hero-1", type: "hero", children: [] }],
			_values: { "hero-1": { image: "asset-123" } },
		};

		const result = await processBlocksDocument(blocksDoc, blockDefs, {
			app: mockApp as any,
			db: {},
		});

		// Loader should have been called
		expect(loaderFn).toHaveBeenCalled();
		// Result should include loader output
		expect(result?._data?.["hero-1"]?.processed).toBe(true);
		expect(result?._data?.["hero-1"]?.expandedKeys).toEqual(["image"]);
	});

	test("introspection redacts server prefetch implementation details", () => {
		const loader = async () => ({ processed: true });
		const def = block("hero")
			.fields(({ f }) => ({
				image: f.text().set("admin", {
					filter: ({ data }: any) => ({ owner: data.owner }),
				}),
			}))
			.form(({ f }) => ({
				fields: [
					{
						field: f.image,
						props: {
							filter: ({ data }: any) => ({ owner: data.owner }),
						},
					},
				],
			}))
			.prefetch({ with: { image: true }, loader })
			.build();

		const schema = introspectBlock(def) as Record<string, unknown>;

		expect(schema.hasPrefetch).toBe(true);
		expect(schema.prefetch).toBeUndefined();
		expect(schema.prefetchWith).toBeUndefined();
		expect(schema._prefetchLoader).toBeUndefined();
		expect((schema.fields as any).image.metadata.meta.filter).toMatchObject({
			"~reactive": "prop",
			watch: ["owner"],
		});
		expect((schema.form as any).fields[0].props.filter).toMatchObject({
			"~reactive": "prop",
			watch: ["owner"],
		});
		expect(JSON.stringify(schema)).not.toContain("_prefetchLoader");
		expect(
			adminConfigDTOSchema.parse({ blocks: { hero: schema } }).blocks,
		).toBeDefined();
	});
});

// ============================================================================
// Type Inference (compile-time checks)
// ============================================================================

describe("BlockBuilder - Type Inference", () => {
	test("prefetch data type should be inferred from function return", () => {
		const b = block("test").prefetch(async () => ({
			posts: [{ id: "1", title: "Test" }],
			count: 5,
		}));

		// This is a compile-time check - if types are wrong, this won't compile
		type _DataType = (typeof b.state)["~prefetchData"];

		// Runtime assertion to make test meaningful
		expect(b.state["~prefetchData"]).toBeUndefined(); // Runtime value is undefined
	});

	test("prefetch data type should be inferred from with config", () => {
		const b = block("test").prefetch({
			with: { image: true, author: true },
		});

		// Compile-time: DataType should be { image: ExpandedRecord | null; author: ExpandedRecord | null }
		type _DataType = (typeof b.state)["~prefetchData"];

		expect(b.state.prefetchWith).toEqual({ image: true, author: true });
	});
});
