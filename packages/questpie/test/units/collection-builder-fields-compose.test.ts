import { describe, expect, test } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import starterModule from "../../src/server/modules/starter/.generated/module.js";

/**
 * Regression tests for cumulative .fields() composition.
 *
 * .fields() previously REPLACED builder state, so the documented starter-user
 * extension recipe (merge first, fields after) silently wiped all starter
 * fields and broke auth at runtime. .fields() now adds to prior state and
 * overrides by key — the same semantics as .merge().
 */

const STARTER_USER_FIELDS = [
	"name",
	"email",
	"emailVerified",
	"image",
	"avatar",
	"role",
	"banned",
	"banReason",
	"banExpires",
];

describe("CollectionBuilder.fields() cumulative composition", () => {
	test("documented starter-user extension recipe keeps starter fields", () => {
		// Exactly the recipe from docs/production/authentication.mdx
		const user: any = collection("user")
			.merge(starterModule.collections.user as any)
			.fields(({ f }) => ({
				isAnonymous: f.boolean().default(false),
			}));

		expect(user.state.fields.isAnonymous).toBeDefined();
		expect(user.state.fieldDefinitions.isAnonymous).toBeDefined();

		for (const key of STARTER_USER_FIELDS) {
			expect(user.state.fields[key]).toBeDefined();
			expect(user.state.fieldDefinitions[key]).toBeDefined();
		}
	});

	test("reversed order (.fields() first, .merge() after) keeps both too", () => {
		const user: any = collection("user")
			.fields(({ f }) => ({
				isAnonymous: f.boolean().default(false),
			}))
			.merge(starterModule.collections.user as any);

		expect(user.state.fields.isAnonymous).toBeDefined();
		for (const key of STARTER_USER_FIELDS) {
			expect(user.state.fields[key]).toBeDefined();
		}
	});

	test("later .fields() adds and overrides by key without wiping", () => {
		const posts: any = collection("posts")
			.fields(({ f }) => ({
				title: f.text(255).required(),
				summary: f.text(500).localized(),
			}))
			.fields(({ f }) => ({
				body: f.textarea(),
				// redefined: no longer localized
				summary: f.text(500),
			}));

		expect(posts.state.fields.title).toBeDefined();
		expect(posts.state.fields.body).toBeDefined();
		expect(posts.state.fields.summary).toBeDefined();
		expect(posts.state.fieldDefinitions.title).toBeDefined();

		// the redefined key dropped its stale localized flag
		expect(posts.state.localized).not.toContain("summary");
		expect(posts.state.localized).toHaveLength(0);
	});

	test("later .fields() keeps prior pending relations", () => {
		const posts: any = collection("posts")
			.fields(({ f }) => ({
				author: f.relation("user"),
			}))
			.fields(({ f }) => ({
				title: f.text(255),
			}));

		const names = (posts.state._pendingRelations ?? []).map(
			(rel: any) => rel.name,
		);
		expect(names).toContain("author");
	});

	test("merge() keeps pending relations from both sides", () => {
		const a: any = collection("posts").fields(({ f }) => ({
			author: f.relation("user"),
		}));
		const b: any = collection("posts").fields(({ f }) => ({
			category: f.relation("categories"),
		}));

		const merged: any = a.merge(b);
		const names = (merged.state._pendingRelations ?? []).map(
			(rel: any) => rel.name,
		);
		expect(names).toContain("author");
		expect(names).toContain("category");
	});
});

describe("GlobalBuilder.fields() cumulative composition", () => {
	test("later .fields() adds and overrides by key without wiping", () => {
		const settings: any = global("settings")
			.fields(({ f }) => ({
				siteName: f.text(255).required(),
				tagline: f.text(500).localized(),
			}))
			.fields(({ f }) => ({
				footer: f.text(500),
				// redefined: no longer localized
				tagline: f.text(500),
			}));

		expect(settings.state.fields.siteName).toBeDefined();
		expect(settings.state.fields.footer).toBeDefined();
		expect(settings.state.fields.tagline).toBeDefined();
		expect(settings.state.localized).not.toContain("tagline");
	});
});
