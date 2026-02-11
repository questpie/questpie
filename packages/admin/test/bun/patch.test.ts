/**
 * Admin Patches Tests (Bun)
 *
 * Tests for the admin runtime monkey-patching system:
 * 1. Patches are applied correctly to builder prototypes
 * 2. QuestpieBuilder.use() propagates admin extension state
 * 3. CollectionBuilder.merge() preserves admin extension state
 * 4. adminModule composition works end-to-end
 */

import { describe, expect, test } from "bun:test";
import {
	CollectionBuilder,
	collection,
	QuestpieBuilder,
	q,
	questpie,
	starterModule,
} from "questpie";
// Side-effect imports: apply patches and augmentation
import "#questpie/admin/server/augmentation.js";
import "#questpie/admin/server/patch.js";
import { adminModule } from "#questpie/admin/server/modules/admin/index.js";

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Base builder with component and view registrations for testing.
 * Collections need to be bound to a builder with registrations
 * to use `c.*` and `v.*` helpers in admin config callbacks.
 */
const testBuilder = q({ name: "test" })
	.listViews({
		table: q.listView("table"),
	})
	.editViews({
		form: q.editView("form"),
	})
	.components({
		icon: q.component("icon"),
		badge: q.component("badge"),
	});

/**
 * Create a collection bound to the test builder.
 * This allows the collection to use `c.*` and `v.*` helpers.
 */
function createTestCollection(name: string) {
	return testBuilder.collection(name);
}

// ============================================================================
// Patch Application
// ============================================================================

describe("Admin Patches - Application", () => {
	test("should add .admin() to CollectionBuilder prototype", () => {
		expect(typeof (CollectionBuilder.prototype as any).admin).toBe("function");
	});

	test("should add .list() to CollectionBuilder prototype", () => {
		expect(typeof (CollectionBuilder.prototype as any).list).toBe("function");
	});

	test("should add .form() to CollectionBuilder prototype", () => {
		expect(typeof (CollectionBuilder.prototype as any).form).toBe("function");
	});

	test("should add .preview() to CollectionBuilder prototype", () => {
		expect(typeof (CollectionBuilder.prototype as any).preview).toBe(
			"function",
		);
	});

	test("should add .actions() to CollectionBuilder prototype", () => {
		expect(typeof (CollectionBuilder.prototype as any).actions).toBe(
			"function",
		);
	});

	test("should add .sidebar() to QuestpieBuilder prototype", () => {
		expect(typeof (QuestpieBuilder.prototype as any).sidebar).toBe("function");
	});

	test("should add .dashboard() to QuestpieBuilder prototype", () => {
		expect(typeof (QuestpieBuilder.prototype as any).dashboard).toBe(
			"function",
		);
	});

	test("should add .branding() to QuestpieBuilder prototype", () => {
		expect(typeof (QuestpieBuilder.prototype as any).branding).toBe("function");
	});

	test("should add .blocks() to QuestpieBuilder prototype", () => {
		expect(typeof (QuestpieBuilder.prototype as any).blocks).toBe("function");
	});

	test("should add .adminLocale() to QuestpieBuilder prototype", () => {
		expect(typeof (QuestpieBuilder.prototype as any).adminLocale).toBe(
			"function",
		);
	});
});

// ============================================================================
// CollectionBuilder Admin Methods
// ============================================================================

describe("CollectionBuilder - Admin Methods", () => {
	test(".admin() should store admin config on state", () => {
		const col = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.admin(({ c }: any) => ({
				label: { en: "Posts" },
				icon: c.icon("ph:article"),
			}));

		expect((col.state as any).admin).toEqual({
			label: { en: "Posts" },
			icon: { type: "icon", props: { name: "ph:article" } },
		});
	});

	test(".admin() with plain object should store config", () => {
		const col = collection("posts")
			.fields({ title: { type: "text" } } as any)
			.admin({ hidden: true } as any);

		expect((col.state as any).admin).toEqual({ hidden: true });
	});

	test(".list() should store adminList config on state", () => {
		const col = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.list(({ v, f }: any) =>
				v.table({
					columns: [f.title],
					defaultSort: { field: f.title, direction: "asc" },
				}),
			);

		expect((col.state as any).adminList).toEqual({
			view: "table",
			columns: ["title"],
			defaultSort: { field: "title", direction: "asc" },
		});
	});

	test(".form() should store adminForm config on state", () => {
		const col = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.form(({ v, f }: any) =>
				v.form({
					sections: [{ label: { en: "Content" }, fields: [f.title] }],
				}),
			);

		expect((col.state as any).adminForm).toEqual({
			view: "form",
			sections: [{ label: { en: "Content" }, fields: ["title"] }],
		});
	});

	test("chaining .admin().list().form() preserves all configs", () => {
		const col = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.admin(({ c }: any) => ({
				label: { en: "Posts" },
				icon: c.icon("ph:article"),
			}))
			.list(({ v, f }: any) => v.table({ columns: [f.title] }))
			.form(({ v, f }: any) => v.form({ sections: [{ fields: [f.title] }] }));

		expect((col.state as any).admin).toBeDefined();
		expect((col.state as any).adminList).toBeDefined();
		expect((col.state as any).adminForm).toBeDefined();
	});
});

// ============================================================================
// QuestpieBuilder.use() - Extension State Propagation
// ============================================================================

describe("QuestpieBuilder.use() - Extension Propagation", () => {
	test("should propagate sidebar from used module", () => {
		const module = questpie({ name: "mod" }).sidebar(({ s }: any) =>
			s.sidebar({
				sections: [
					s.section({
						id: "test",
						title: { en: "Test" },
						items: [],
					}),
				],
			}),
		);

		const result = questpie({ name: "app" }).use(module);

		expect((result.state as any).sidebar).toBeDefined();
		expect((result.state as any).sidebar.sections).toHaveLength(1);
		expect((result.state as any).sidebar.sections[0].id).toBe("test");
	});

	test("should propagate dashboard from used module", () => {
		const module = questpie({ name: "mod" }).dashboard(({ d }: any) =>
			d.dashboard({
				title: { en: "My Dashboard" },
				items: [],
			}),
		);

		const result = questpie({ name: "app" }).use(module);

		expect((result.state as any).dashboard).toBeDefined();
		expect((result.state as any).dashboard.title).toEqual({
			en: "My Dashboard",
		});
	});

	test("should propagate branding from used module", () => {
		const module = questpie({ name: "mod" }).branding({
			name: { en: "My App" },
		});

		const result = questpie({ name: "app" }).use(module);

		expect((result.state as any).branding).toEqual({
			name: { en: "My App" },
		});
	});

	test("should propagate adminLocale from used module", () => {
		const module = questpie({ name: "mod" }).adminLocale({
			locales: ["en", "sk"],
			defaultLocale: "en",
		});

		const result = questpie({ name: "app" }).use(module);

		expect((result.state as any).adminLocale).toEqual({
			locales: ["en", "sk"],
			defaultLocale: "en",
		});
	});

	test("consumer's extension should override module's (last-wins)", () => {
		const module = questpie({ name: "mod" }).sidebar(({ s }: any) =>
			s.sidebar({
				sections: [
					s.section({ id: "module", title: { en: "Module" }, items: [] }),
				],
			}),
		);

		const result = questpie({ name: "app" })
			.sidebar(({ s }: any) =>
				s.sidebar({
					sections: [s.section({ id: "app", title: { en: "App" }, items: [] })],
				}),
			)
			.use(module);

		// Module's sidebar should override app's (last-wins)
		expect((result.state as any).sidebar.sections[0].id).toBe("module");
	});

	test("base sidebar should be preserved if module has none", () => {
		const base = questpie({ name: "app" }).sidebar(({ s }: any) =>
			s.sidebar({
				sections: [s.section({ id: "app", title: { en: "App" }, items: [] })],
			}),
		);

		const emptyModule = questpie({ name: "mod" });

		const result = base.use(emptyModule);

		expect((result.state as any).sidebar).toBeDefined();
		expect((result.state as any).sidebar.sections[0].id).toBe("app");
	});

	test("should propagate multiple extension properties at once", () => {
		const module = questpie({ name: "mod" })
			.sidebar(({ s }: any) =>
				s.sidebar({
					sections: [s.section({ id: "s1", title: { en: "S1" }, items: [] })],
				}),
			)
			.branding({ name: { en: "Brand" } })
			.adminLocale({ locales: ["en"], defaultLocale: "en" });

		const result = questpie({ name: "app" }).use(module);

		expect((result.state as any).sidebar).toBeDefined();
		expect((result.state as any).branding).toBeDefined();
		expect((result.state as any).adminLocale).toBeDefined();
	});

	test("should propagate extensions through chained .use() calls", () => {
		const module1 = questpie({ name: "mod1" }).sidebar(({ s }: any) =>
			s.sidebar({
				sections: [s.section({ id: "m1", title: { en: "M1" }, items: [] })],
			}),
		);

		const module2 = questpie({ name: "mod2" }).branding({
			name: { en: "Brand2" },
		});

		const result = questpie({ name: "app" }).use(module1).use(module2);

		// sidebar from module1 should be preserved
		expect((result.state as any).sidebar).toBeDefined();
		expect((result.state as any).sidebar.sections[0].id).toBe("m1");
		// branding from module2 should be added
		expect((result.state as any).branding).toEqual({
			name: { en: "Brand2" },
		});
	});

	test("should propagate collection admin config through .use()", () => {
		const module = questpie({ name: "mod" }).collections({
			posts: createTestCollection("posts")
				.fields({ title: { type: "text" } } as any)
				.admin(({ c }: any) => ({
					label: { en: "Posts" },
					icon: c.icon("ph:article"),
				}))
				.list(({ v, f }: any) => v.table({ columns: [f.title] })),
		});

		const result = questpie({ name: "app" }).use(module);

		// Collection state should carry admin config
		const postsState = (result.state.collections.posts as any).state;
		expect(postsState.admin).toEqual({
			label: { en: "Posts" },
			icon: { type: "icon", props: { name: "ph:article" } },
		});
		expect(postsState.adminList).toEqual({
			view: "table",
			columns: ["title"],
		});
	});

	test("core properties (collections, globals, fields) still merge correctly", () => {
		const module = questpie({ name: "mod" }).collections({
			posts: collection("posts").fields({ title: { type: "text" } } as any),
		});

		const result = questpie({ name: "app" })
			.collections({
				pages: collection("pages").fields({
					slug: { type: "text" },
				} as any),
			})
			.use(module);

		// Both collections should exist
		expect(result.state.collections.posts).toBeDefined();
		expect(result.state.collections.pages).toBeDefined();
	});
});

// ============================================================================
// CollectionBuilder.merge() - Admin Extension Preservation
// ============================================================================

describe("CollectionBuilder.merge() - Admin Extensions", () => {
	test("should preserve admin config from base when merging", () => {
		const base = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.admin(({ c }: any) => ({
				label: { en: "Posts" },
				icon: c.icon("ph:article"),
			}));

		const extension = collection("posts").fields({
			content: { type: "text" },
		} as any);

		const merged = base.merge(extension);

		expect((merged.state as any).admin).toEqual({
			label: { en: "Posts" },
			icon: { type: "icon", props: { name: "ph:article" } },
		});
		// Extension field should be merged
		expect(merged.state.fields.content).toBeDefined();
		expect(merged.state.fields.title).toBeDefined();
	});

	test("should preserve adminList config from base when merging", () => {
		const base = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.list(({ v, f }: any) => v.table({ columns: [f.title] }));

		const extension = collection("posts").fields({
			content: { type: "text" },
		} as any);

		const merged = base.merge(extension);

		expect((merged.state as any).adminList).toEqual({
			view: "table",
			columns: ["title"],
		});
	});

	test("should preserve adminForm config from base when merging", () => {
		const base = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.form(({ v, f }: any) => v.form({ sections: [{ fields: [f.title] }] }));

		const extension = collection("posts").fields({
			content: { type: "text" },
		} as any);

		const merged = base.merge(extension);

		expect((merged.state as any).adminForm).toBeDefined();
	});

	test("extension's admin config should override base (last-wins)", () => {
		const base = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.admin(({ c }: any) => ({
				label: { en: "Posts" },
				icon: c.icon("ph:article"),
			}));

		const extension = createTestCollection("posts")
			.fields({ content: { type: "text" } } as any)
			.admin(({ c }: any) => ({
				label: { en: "Articles" },
				icon: c.icon("ph:newspaper"),
			}));

		const merged = base.merge(extension);

		expect((merged.state as any).admin.label).toEqual({ en: "Articles" });
	});

	test("should preserve all admin configs when merging with plain fields", () => {
		const base = createTestCollection("posts")
			.fields({ title: { type: "text" } } as any)
			.admin(({ c }: any) => ({
				label: { en: "Posts" },
				icon: c.icon("ph:article"),
			}))
			.list(({ v, f }: any) => v.table({ columns: [f.title] }))
			.form(({ v, f }: any) => v.form({ sections: [{ fields: [f.title] }] }));

		const extension = collection("posts").fields({
			content: { type: "text" },
		} as any);

		const merged = base.merge(extension);

		expect((merged.state as any).admin).toBeDefined();
		expect((merged.state as any).adminList).toBeDefined();
		expect((merged.state as any).adminForm).toBeDefined();
	});
});

// ============================================================================
// adminModule Composition
// ============================================================================

describe("adminModule - Composition", () => {
	test("adminModule should have sidebar configured", () => {
		expect((adminModule.state as any).sidebar).toBeDefined();
		expect((adminModule.state as any).sidebar.sections).toBeDefined();
	});

	test("adminModule should have user collection with admin config", () => {
		const userState = (adminModule.state.collections.user as any).state;
		expect(userState.admin).toBeDefined();
		expect(userState.admin.label).toEqual({ key: "defaults.users.label" });
	});

	test("adminModule should have user collection with list config", () => {
		const userState = (adminModule.state.collections.user as any).state;
		expect(userState.adminList).toBeDefined();
		expect(userState.adminList.view).toBe("table");
	});

	test("adminModule should have user collection with form config", () => {
		const userState = (adminModule.state.collections.user as any).state;
		expect(userState.adminForm).toBeDefined();
		expect(userState.adminForm.view).toBe("form");
	});

	test("adminModule should have assets collection with admin config", () => {
		const assetsState = (adminModule.state.collections.assets as any).state;
		expect(assetsState.admin).toBeDefined();
		expect(assetsState.admin.label).toEqual({ key: "defaults.assets.label" });
	});

	test("adminModule should have hidden internal collections", () => {
		const sessionState = (adminModule.state.collections.session as any).state;
		expect(sessionState.admin).toEqual({ hidden: true });

		const accountState = (adminModule.state.collections.account as any).state;
		expect(accountState.admin).toEqual({ hidden: true });
	});

	test(".use(adminModule) should propagate sidebar to consumer", () => {
		const app = questpie({ name: "test" }).use(adminModule);

		expect((app.state as any).sidebar).toBeDefined();
		expect((app.state as any).sidebar.sections.length).toBeGreaterThan(0);
	});

	test(".use(adminModule) should propagate collection admin configs", () => {
		const app = questpie({ name: "test" }).use(adminModule);

		const userState = (app.state.collections.user as any).state;
		expect(userState.admin).toBeDefined();
		expect(userState.adminList).toBeDefined();
		expect(userState.adminForm).toBeDefined();
	});

	test("consumer sidebar should override adminModule sidebar", () => {
		const app = questpie({ name: "test" })
			.use(adminModule)
			.sidebar(({ s }: any) =>
				s.sidebar({
					sections: [
						s.section({
							id: "custom",
							title: { en: "Custom" },
							items: [],
						}),
					],
				}),
			);

		expect((app.state as any).sidebar.sections[0].id).toBe("custom");
	});

	test("consumer can extend collections while preserving admin config", () => {
		const app = questpie({ name: "test" })
			.use(adminModule)
			.collections({
				posts: createTestCollection("posts")
					.fields({ title: { type: "text" } } as any)
					.admin(({ c }: any) => ({
						label: { en: "Posts" },
						icon: c.icon("ph:article"),
					})),
			});

		// Custom collection should be added
		expect(app.state.collections.posts).toBeDefined();
		// adminModule collections should still exist
		expect(app.state.collections.user).toBeDefined();
		expect(app.state.collections.assets).toBeDefined();
	});

	test("chained .use() from adminModule through intermediate builder", () => {
		// This mimics the barbershop pattern:
		// baseInstance = q(...).use(adminModule).sidebar(...).branding(...)
		// cms = q(...).use(baseInstance).build(...)
		const baseInstance = questpie({ name: "base" })
			.use(adminModule)
			.sidebar(({ s }: any) =>
				s.sidebar({
					sections: [
						s.section({
							id: "custom-sidebar",
							title: { en: "Custom" },
							items: [],
						}),
					],
				}),
			)
			.branding({ name: { en: "My App" } })
			.adminLocale({ locales: ["en", "sk"], defaultLocale: "en" });

		// Second .use() should propagate all extensions
		const app = questpie({ name: "final" }).use(baseInstance);

		expect((app.state as any).sidebar).toBeDefined();
		expect((app.state as any).sidebar.sections[0].id).toBe("custom-sidebar");
		expect((app.state as any).branding).toEqual({
			name: { en: "My App" },
		});
		expect((app.state as any).adminLocale).toEqual({
			locales: ["en", "sk"],
			defaultLocale: "en",
		});
		// Core state should also be propagated
		expect(app.state.collections.user).toBeDefined();
		expect(app.state.collections.assets).toBeDefined();
	});
});
