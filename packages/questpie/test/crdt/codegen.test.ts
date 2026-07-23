import { describe, expect, it } from "bun:test";

import { z } from "zod";

import {
	coreCodegenPlugin,
	resolveTargetGraph,
} from "../../src/cli/codegen/index.js";
import { generateTemplate } from "../../src/cli/codegen/template.js";
import type {
	DiscoveredFile,
	DiscoveryResult,
} from "../../src/cli/codegen/types.js";
import { collection, global } from "../../src/exports/index.js";
import {
	createCrdtRegistry,
	type CrdtRegistry,
} from "../../src/server/modules/core/integrated/crdt/registry.js";

describe("CRDT registry", () => {
	it("derives one deterministic collection/global aggregate registry", () => {
		const awareness = z
			.object({ activeField: z.enum(["title", "tags", "content"]).optional() })
			.strict();
		const articles = collection("articles")
			.fields(({ f }) => ({
				title: f
					.text({ mode: "text" })
					.default("")
					.required()
					.crdt({ format: "text" }),
				tags: f
					.text({ mode: "text" })
					.array()
					.default([])
					.required()
					.crdt({ format: "set", conflict: "add-wins" }),
				content: f.textarea().default("").required().crdt({ format: "text" }),
			}))
			.collaborative({ awareness });
		const siteSettings = global("site-settings")
			.fields(({ f }) => ({
				content: f.textarea().default("").required().crdt({ format: "text" }),
			}))
			.collaborative();

		const registry = createCrdtRegistry({
			collections: { zArticles: articles.build() },
			globals: { aSettings: siteSettings.build() },
		});

		expect(registry).toEqual({
			collections: {
				zArticles: {
					ownerName: "articles",
					awarenessSchema: awareness,
					fields: {
						content: { format: "text" },
						tags: { format: "set", conflict: "add-wins" },
						title: { format: "text" },
					},
				},
			},
			globals: {
				aSettings: {
					ownerName: "site-settings",
					fields: {
						content: { format: "text" },
					},
				},
			},
		} satisfies CrdtRegistry);
		expect(Object.isFrozen(registry)).toBe(true);
		expect(Object.isFrozen(registry.collections.zArticles)).toBe(true);
		expect(Object.isFrozen(registry.collections.zArticles.fields)).toBe(true);
	});

	it("omits ordinary owners and rejects orphan/empty capabilities", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text().required(),
		}));

		expect(
			createCrdtRegistry({
				collections: { posts: posts.build() },
				globals: {},
			}),
		).toEqual({ collections: {}, globals: {} });

		const orphan = collection("orphan").fields(({ f }) => ({
			content: f.textarea().default("").required().crdt({ format: "text" }),
		}));
		expect(() =>
			createCrdtRegistry({
				collections: { orphan: orphan.build() },
				globals: {},
			}),
		).toThrow(
			'QUESTPIE CRDT owner "collections.orphan" has field markers but is not collaborative',
		);

		const empty = collection("empty")
			.fields(({ f }) => ({ title: f.text().required() }))
			.collaborative();
		expect(() =>
			createCrdtRegistry({
				collections: { empty: empty.build() },
				globals: {},
			}),
		).toThrow(
			'QUESTPIE collaborative owner "collections.empty" has no CRDT fields',
		);
	});

	it("fails app registration for an ineligible marked field", () => {
		const invalid = collection("invalid")
			.fields(({ f }) => ({
				content: f.textarea().required().crdt({ format: "text" }),
			}))
			.collaborative();

		expect(() =>
			createCrdtRegistry({
				collections: { invalid: invalid.build() },
				globals: {},
			}),
		).toThrow(
			'Invalid QUESTPIE CRDT field "collections.invalid.content": missing-empty-default',
		);
	});

	it("uses other-wins owner config on merge and later fluent override", () => {
		const firstAwareness = z.object({ source: z.literal("first") });
		const secondAwareness = z.object({ source: z.literal("second") });
		const base = collection("articles")
			.fields(({ f }) => ({
				content: f.textarea().default("").required().crdt({ format: "text" }),
			}))
			.collaborative({ awareness: firstAwareness });
		const extension = collection("articles").collaborative({
			awareness: secondAwareness,
		});
		const merged = base.merge(extension);
		const overridden = merged.collaborative({ awareness: firstAwareness });

		expect(
			createCrdtRegistry({
				collections: { articles: merged.build() },
				globals: {},
			}).collections.articles.awarenessSchema,
		).toBe(secondAwareness);
		expect(
			createCrdtRegistry({
				collections: { articles: overridden.build() },
				globals: {},
			}).collections.articles.awarenessSchema,
		).toBe(firstAwareness);
	});
});

describe("CRDT codegen", () => {
	it("emits exact CRDT registry and client/server aliases in AppConfig", () => {
		const modulesFile: DiscoveredFile = {
			absolutePath: "/root/modules.ts",
			key: "modules",
			varName: "_modules",
			importPath: "../modules",
			exportType: "default",
			source: "modules.ts",
		};
		const discovered: DiscoveryResult = {
			categories: new Map(),
			singles: new Map([["modules", modulesFile]]),
			spreads: new Map(),
		};
		const target = resolveTargetGraph([coreCodegenPlugin()]).get("server")!;
		const generated = generateTemplate({
			configImportPath: "../questpie.config",
			discovered,
			categories: target.categories,
			singletonFactories: target.registries.singletonFactories,
		});
		const code = [
			generated.code,
			...generated.extraFiles.map((file) => file.code),
		].join("\n");

		expect(code).toContain(
			"export type AppCrdt = CrdtRegistryFromApp<{ collections: AppCollections; globals: AppGlobals }>;",
		);
		expect(code).toContain(
			"export type AppCrdtClient = CrdtClientAPI<AppCrdt>;",
		);
		expect(code).toContain(
			"export type AppCrdtServer = CrdtServerAPI<AppCrdt>;",
		);
		expect(code).toContain("\tcrdt: AppCrdt;");
	});
});
