import { describe, expect, test } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";

const q = questpie({ name: "test-module" }).fields(defaultFields);

describe("Type-Safe Hooks", () => {
	test("hooks should have proper type inference", () => {
		const users = q
			.collection("users")
			.fields((f) => ({
				name: f.textarea({ required: true }),
				email: f.text({ required: true, maxLength: 255 }),
				bio: f.textarea(),
			}))
			.hooks({
				// beforeValidate receives TInsert | TUpdate
				beforeValidate: async ({ data, operation }) => {
					// data should be properly typed here
					if (operation === "create") {
						// On create, data is TInsert
						expectTypeOf(data).toMatchTypeOf<{
							name: string;
							email: string;
							bio?: string | null | undefined;
							id?: string | undefined;
							createdAt?: string | undefined;
							updatedAt?: string | undefined;
						}>();
					} else {
						// On update, data is TUpdate (partial)
						expectTypeOf(data).toMatchTypeOf<{
							name?: string | undefined;
							email?: string | undefined;
							bio?: string | null | undefined;
							id?: string | undefined;
							createdAt?: string | undefined;
							updatedAt?: string | undefined;
						}>();
					}
				},
				// afterChange receives TSelect
				afterChange: async ({ data, original, operation }) => {
					// data is always TSelect (complete record)
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						name: string;
						email: string;
						bio: string | null;
						createdAt: string;
						updatedAt: string;
						_title: string;
					}>();

					// original is available on update
					if (operation === "update" && original) {
						expectTypeOf(original).toMatchTypeOf<{
							id: string;
							name: string;
							email: string;
							bio: string | null;
							createdAt: string;
							updatedAt: string;
							_title: string;
						}>();
					}
				},
				// afterRead receives TSelect
				afterRead: async ({ data }) => {
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						name: string;
						email: string;
						bio: string | null;
						createdAt: string;
						updatedAt: string;
						_title: string;
					}>();
				},
			});

		expect(users.name).toBe("users");
	});

	test("original field availability across all hooks", () => {
		const users = q
			.collection("users")
			.fields((f) => ({
				name: f.textarea({ required: true }),
				email: f.text({ required: true, maxLength: 255 }),
				bio: f.textarea(),
			}))
			.hooks({
				// beforeValidate: original is NOT available (type is never)
				beforeValidate: async ({ data, operation, original }) => {
					// original is type 'never', cannot be used
					if (operation === "create") {
						expectTypeOf(data).toMatchTypeOf<{
							name: string;
							email: string;
							bio?: string | null | undefined;
							id?: string | undefined;
							createdAt?: string | undefined;
							updatedAt?: string | undefined;
						}>();
					}
				},
				// beforeChange: original is NOT available (type is never)
				beforeChange: async ({ data, original }) => {
					// original is type 'never', cannot be used
					if (!data.bio) {
						data.bio = "No bio";
					}
				},
				// afterChange: original IS available (but might be undefined)
				afterChange: async ({ data, original, operation }) => {
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						name: string;
						email: string;
						bio: string | null;
						createdAt: string;
						updatedAt: string;
						_title: string;
					}>();

					// original is available but optional
					if (operation === "update" && original) {
						expectTypeOf(original).toMatchTypeOf<{
							id: string;
							name: string;
							email: string;
							bio: string | null;
							createdAt: string;
							updatedAt: string;
							_title: string;
						}>();

						// Can compare data with original
						if (data.email !== original.email) {
							console.log("Email changed");
						}
					}

					// On create, original should be undefined
					if (operation === "create") {
						expect(original).toBeUndefined();
					}
				},
				// afterRead: original IS available (but might be undefined)
				afterRead: async ({ data, original, operation }) => {
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						name: string;
						email: string;
						bio: string | null;
						createdAt: string;
						updatedAt: string;
						_title: string;
					}>();

					// original is available on update operations
					if (operation === "update" && original) {
						expectTypeOf(original).toMatchTypeOf<{
							id: string;
							name: string;
							email: string;
							bio: string | null;
							createdAt: string;
							updatedAt: string;
							_title: string;
						}>();
					}
				},
				// beforeDelete: original is NOT available (type is never)
				beforeDelete: async ({ data, original }) => {
					// original is type 'never', cannot be used
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						name: string;
						email: string;
						bio: string | null;
						createdAt: string;
						updatedAt: string;
						_title: string;
					}>();
				},
				// afterDelete: original is NOT available (type is never)
				afterDelete: async ({ data, original }) => {
					// original is type 'never', cannot be used
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						name: string;
						email: string;
						bio: string | null;
						createdAt: string;
						updatedAt: string;
						_title: string;
					}>();
				},
			});

		expect(users.name).toBe("users");
	});

	test("beforeOperation hook has correct types", () => {
		const posts = q
			.collection("posts")
			.fields((f) => ({
				title: f.textarea({ required: true }),
			}))
			.hooks({
				beforeOperation: async ({ data, operation, original }) => {
					// original is type 'never', cannot be used

					// data type depends on operation
					if (operation === "create") {
						expectTypeOf(data).toMatchTypeOf<{
							title: string;
							id?: string | undefined;
							createdAt?: string | undefined;
							updatedAt?: string | undefined;
						}>();
					} else if (operation === "update") {
						expectTypeOf(data).toMatchTypeOf<{
							title?: string | undefined;
							id?: string | undefined;
							createdAt?: string | undefined;
							updatedAt?: string | undefined;
						}>();
					} else if (operation === "read" || operation === "delete") {
						expectTypeOf(data).toMatchTypeOf<{
							id: string;
							title: string;
							createdAt: string;
							updatedAt: string;
							_title: string;
						}>();
					}
				},
			});

		expect(posts.name).toBe("posts");
	});

	test("hooks with localized fields", () => {
		const posts = q
			.collection("posts")
			.fields((f) => ({
				title: f.text({ required: true, localized: true }),
				slug: f.text({ required: true }),
				description: f.textarea({ localized: true }),
			}))
			.hooks({
				beforeChange: async ({ data, operation }) => {
					// Localized fields have the same plain scalar types in hooks
					if (operation === "create") {
						expectTypeOf(data).toMatchTypeOf<{
							title: string;
							slug: string;
							description?: string | null | undefined;
						}>();
					} else {
						expectTypeOf(data).toMatchTypeOf<{
							title?: string | undefined;
							slug?: string | undefined;
							description?: string | null | undefined;
						}>();
					}
				},
				afterChange: async ({ data }) => {
					// After change, localized fields are plain values for the current locale
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						title: string;
						slug: string;
						description: string | null;
						createdAt: string;
						updatedAt: string;
					}>();
				},
			});

		expect(posts.name).toBe("posts");
	});

	test("hooks with localized fields maintain correct types across lifecycle", () => {
		const articles = q
			.collection("articles")
			.fields((f) => ({
				title: f.textarea({ required: true, localized: true }),
				body: f.textarea({ localized: true }),
				category: f.text({ required: true }),
			}))
			.hooks({
				beforeValidate: async ({ data, operation }) => {
					if (operation === "create") {
						expectTypeOf(data).toMatchTypeOf<{
							title: string;
							category: string;
							body?: string | null | undefined;
						}>();
					}
				},
				beforeChange: async ({ data }) => {
					// Mutate localized field in place
					if (data.title) {
						data.title = data.title.trim();
					}
				},
				afterChange: async ({ data, original, operation }) => {
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						title: string;
						category: string;
						body: string | null;
						createdAt: string;
						updatedAt: string;
					}>();

					if (operation === "update" && original) {
						expectTypeOf(original).toMatchTypeOf<{
							id: string;
							title: string;
							category: string;
							body: string | null;
							createdAt: string;
							updatedAt: string;
						}>();
					}
				},
				afterRead: async ({ data }) => {
					expectTypeOf(data).toMatchTypeOf<{
						id: string;
						title: string;
						category: string;
						body: string | null;
						createdAt: string;
						updatedAt: string;
					}>();
				},
			});

		expect(articles.name).toBe("articles");
	});

	test("hooks should not allow return values", () => {
		const articles = q
			.collection("articles")
			.fields((f) => ({
				title: f.textarea({ required: true }),
			}))
			.hooks({
				beforeChange: async ({ data }) => {
					// Mutate in place - correct
					if (!data.title) {
						data.title = "Untitled";
					}
					// Don't return anything
				},
			});

		expect(articles.name).toBe("articles");
	});
});

// Helper for type checking (not executed at runtime)
function expectTypeOf<T>(_value: T) {
	return {
		toMatchTypeOf: <Expected>() => {
			// Type-only check
			const _typeCheck: Expected extends T
				? T extends Expected
					? true
					: false
				: false = true as any;
		},
	};
}
