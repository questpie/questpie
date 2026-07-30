import { describe, expect, test } from "bun:test";

import { z } from "zod/v4";

import { ApiError } from "../../src/server/errors/index.js";
import { allBackendMessagesEN } from "../../src/server/i18n/messages.js";
import {
	createTranslator,
	mergeTranslationsConfig,
} from "../../src/server/i18n/translator.js";
import type { TranslationsConfig } from "../../src/server/i18n/types.js";
import {
	createZodErrorMap,
	type ZodIssue,
} from "../../src/server/i18n/zod-error-map.js";

describe("i18n", () => {
	describe("createTranslator", () => {
		test("should use default allBackendMessagesEN when no config provided", () => {
			const t = createTranslator(undefined);
			// Uses allBackendMessagesEN by default
			expect(t("error.notFound", {})).toBe("Resource not found");
		});

		test("should use default allBackendMessagesEN when messages empty", () => {
			const t = createTranslator({
				messages: { en: {} },
				fallbackLocale: "en",
			});
			// Falls back to default allBackendMessagesEN
			expect(t("error.notFound", {})).toBe("Resource not found");
		});

		test("should return key when message truly not found", () => {
			const t = createTranslator({
				messages: { en: {} },
				fallbackLocale: "en",
			});
			expect(t("some.nonexistent.key" as any, {})).toBe("some.nonexistent.key");
		});

		test("should use bundled Slovak validation messages", () => {
			const t = createTranslator(undefined);
			expect(t("validation.union.invalid", {}, "sk")).toBe("Neplatný vstup");
		});

		test("should translate simple message", () => {
			const t = createTranslator({
				messages: {
					en: { "error.notFound": "Resource not found" },
				},
				fallbackLocale: "en",
			});
			expect(t("error.notFound", {})).toBe("Resource not found");
		});

		test("should interpolate parameters", () => {
			const t = createTranslator({
				messages: {
					en: {
						"error.notFound.withId": "{{resource}} not found: {{id}}",
					},
				},
				fallbackLocale: "en",
			});
			expect(t("error.notFound.withId", { resource: "User", id: "123" })).toBe(
				"User not found: 123",
			);
		});

		test("should use specified locale", () => {
			const t = createTranslator({
				messages: {
					en: { "error.notFound": "Resource not found" },
					sk: { "error.notFound": "Zdroj nenajdeny" },
				},
				fallbackLocale: "en",
			});
			expect(t("error.notFound", {}, "sk")).toBe("Zdroj nenajdeny");
		});

		test("should fallback to default locale when message not found in requested locale", () => {
			const t = createTranslator({
				messages: {
					en: { "custom.fallbackOnly": "Fallback message" },
					sk: {}, // No translation for custom.fallbackOnly
				},
				fallbackLocale: "en",
			});
			expect(t("custom.fallbackOnly", {}, "sk")).toBe("Fallback message");
		});

		test("should handle plural messages - one", () => {
			const t = createTranslator({
				messages: {
					en: {
						"items.count": {
							one: "{{count}} item",
							other: "{{count}} items",
						},
					},
				},
				fallbackLocale: "en",
			});
			expect(t("items.count" as any, { count: 1 })).toBe("1 item");
		});

		test("should handle plural messages - other", () => {
			const t = createTranslator({
				messages: {
					en: {
						"items.count": {
							one: "{{count}} item",
							other: "{{count}} items",
						},
					},
				},
				fallbackLocale: "en",
			});
			expect(t("items.count" as any, { count: 5 })).toBe("5 items");
		});

		test("should handle plural messages - zero uses other in English", () => {
			const t = createTranslator({
				messages: {
					en: {
						"items.count": {
							zero: "No items",
							one: "{{count}} item",
							other: "{{count}} items",
						},
					},
				},
				fallbackLocale: "en",
			});
			// In English, 0 uses "other" plural form, not "zero"
			// This is correct Intl.PluralRules behavior
			expect(t("items.count" as any, { count: 0 })).toBe("0 items");
		});

		test("should handle plural messages - zero form in languages that support it", () => {
			const t = createTranslator({
				messages: {
					ar: {
						"items.count": {
							zero: "لا عناصر",
							one: "عنصر واحد",
							other: "{{count}} عناصر",
						},
					},
				},
				fallbackLocale: "ar",
			});
			// Arabic has explicit zero form support
			expect(t("items.count" as any, { count: 0 }, "ar")).toBe("لا عناصر");
		});

		test("should handle missing interpolation params gracefully", () => {
			const t = createTranslator({
				messages: {
					en: {
						"error.notFound.withId": "{{resource}} not found: {{id}}",
					},
				},
				fallbackLocale: "en",
			});
			// Missing params should leave placeholders as-is
			expect(t("error.notFound.withId", {})).toBe(
				"{{resource}} not found: {{id}}",
			);
		});

		test("should handle partial interpolation params", () => {
			const t = createTranslator({
				messages: {
					en: {
						"error.notFound.withId": "{{resource}} not found: {{id}}",
					},
				},
				fallbackLocale: "en",
			});
			expect(t("error.notFound.withId", { resource: "User" })).toBe(
				"User not found: {{id}}",
			);
		});
	});

	describe("mergeTranslationsConfig", () => {
		test("should return source when target is undefined", () => {
			const source: TranslationsConfig = {
				messages: { en: { test: "Test" } },
				fallbackLocale: "en",
			};
			const result = mergeTranslationsConfig(undefined, source);
			expect(result).toEqual(source);
		});

		test("should return target when source is undefined", () => {
			const target: TranslationsConfig = {
				messages: { en: { test: "Test" } },
				fallbackLocale: "en",
			};
			const result = mergeTranslationsConfig(target, undefined);
			expect(result).toEqual(target);
		});

		test("should merge messages from both configs", () => {
			const target: TranslationsConfig = {
				messages: { en: { key1: "Value 1" } },
				fallbackLocale: "en",
			};
			const source: TranslationsConfig = {
				messages: { en: { key2: "Value 2" } },
			};
			const result = mergeTranslationsConfig(target, source);
			expect(result!.messages.en).toEqual({
				key1: "Value 1",
				key2: "Value 2",
			});
		});

		test("should merge messages across locales", () => {
			const target: TranslationsConfig = {
				messages: { en: { test: "Test" } },
				fallbackLocale: "en",
			};
			const source: TranslationsConfig = {
				messages: { sk: { test: "Test SK" } },
			};
			const result = mergeTranslationsConfig(target, source);
			expect(result!.messages).toEqual({
				en: { test: "Test" },
				sk: { test: "Test SK" },
			});
		});

		test("should override fallbackLocale from source", () => {
			const target: TranslationsConfig = {
				messages: { en: {} },
				fallbackLocale: "en",
			};
			const source: TranslationsConfig = {
				messages: { sk: {} },
				fallbackLocale: "sk",
			};
			const result = mergeTranslationsConfig(target, source);
			expect(result!.fallbackLocale).toBe("sk");
		});

		test("should keep target fallbackLocale when source doesn't specify", () => {
			const target: TranslationsConfig = {
				messages: { en: {} },
				fallbackLocale: "en",
			};
			const source: TranslationsConfig = {
				messages: { sk: {} },
			};
			const result = mergeTranslationsConfig(target, source);
			expect(result!.fallbackLocale).toBe("en");
		});

		test("should override same keys", () => {
			const target: TranslationsConfig = {
				messages: { en: { key: "Old Value" } },
				fallbackLocale: "en",
			};
			const source: TranslationsConfig = {
				messages: { en: { key: "New Value" } },
			};
			const result = mergeTranslationsConfig(target, source);
			expect(result!.messages.en?.key).toBe("New Value");
		});
	});

	describe("allBackendMessagesEN", () => {
		test("should have required error messages", () => {
			expect(allBackendMessagesEN["error.notFound"]).toBeDefined();
			expect(allBackendMessagesEN["error.forbidden"]).toBeDefined();
			expect(allBackendMessagesEN["error.unauthorized"]).toBeDefined();
			expect(allBackendMessagesEN["error.validation"]).toBeDefined();
			expect(allBackendMessagesEN["error.internal"]).toBeDefined();
		});

		test("should have CRUD error messages", () => {
			expect(allBackendMessagesEN["crud.create.forbidden"]).toBeDefined();
			expect(allBackendMessagesEN["crud.read.forbidden"]).toBeDefined();
			expect(allBackendMessagesEN["crud.update.forbidden"]).toBeDefined();
			expect(allBackendMessagesEN["crud.delete.forbidden"]).toBeDefined();
		});

		test("should have validation messages", () => {
			expect(allBackendMessagesEN["validation.invalidType"]).toBeDefined();
			expect(allBackendMessagesEN["validation.string.email"]).toBeDefined();
			expect(allBackendMessagesEN["validation.string.url"]).toBeDefined();
		});
	});

	describe("createZodErrorMap", () => {
		const t = createTranslator({
			messages: {
				en: allBackendMessagesEN,
			},
			fallbackLocale: "en",
		});

		test("should translate invalid_type error", () => {
			const errorMap = createZodErrorMap(t as any);
			const issue: ZodIssue = {
				code: "invalid_type",
				expected: "string",
				received: "number",
				path: [],
				message: "Original message",
			};
			const result = errorMap(issue);
			// Should use translated message format: "Expected {{expected}}, received {{received}}"
			expect(result?.message).toBe("Expected string, received number");
		});

		test("should translate string too_small error", () => {
			const errorMap = createZodErrorMap(t as any);
			const issue: ZodIssue = {
				code: "too_small",
				type: "string",
				minimum: 5,
				inclusive: true,
				path: [],
				message: "String must be at least 5 characters",
			};
			const result = errorMap(issue);
			expect(result?.message).toContain("5");
		});

		test("should translate string too_big error", () => {
			const errorMap = createZodErrorMap(t as any);
			const issue: ZodIssue = {
				code: "too_big",
				type: "string",
				maximum: 3,
				inclusive: true,
				path: [],
				message: "String must be at most 3 characters",
			};
			const result = errorMap(issue);
			expect(result?.message).toContain("3");
		});

		test("should translate email validation error", () => {
			const errorMap = createZodErrorMap(t as any);
			const issue = {
				code: "invalid_format",
				format: "email",
				path: [],
				message: "Invalid email",
			} as unknown as ZodIssue;
			const result = errorMap(issue);
			expect(result?.message).toContain("email");
		});

		test("should translate url validation error", () => {
			const errorMap = createZodErrorMap(t as any);
			const issue = {
				code: "invalid_format",
				format: "url",
				path: [],
				message: "Invalid URL",
			} as unknown as ZodIssue;
			const result = errorMap(issue);
			expect(result?.message).toContain("URL");
		});

		test("should use locale from parameter when error map is called directly", () => {
			const translatorWithLocales = createTranslator({
				messages: {
					en: {
						"validation.string.email": "Invalid email address",
					},
					sk: {
						"validation.string.email": "Neplatna e-mailova adresa",
					},
				},
				fallbackLocale: "en",
			});

			// Create error map with Slovak locale
			const errorMapSk = createZodErrorMap(translatorWithLocales as any, "sk");

			// Test error map directly (since Zod v4 per-parse errorMap has different behavior)
			const issue = {
				code: "invalid_format",
				format: "email",
				path: [],
				message: "Default",
			} as unknown as ZodIssue;

			const resultSk = errorMapSk(issue);
			expect(resultSk?.message).toBe("Neplatna e-mailova adresa");

			// Create error map with English locale
			const errorMapEn = createZodErrorMap(translatorWithLocales as any, "en");
			const resultEn = errorMapEn(issue);
			expect(resultEn?.message).toBe("Invalid email address");
		});

		test("should translate Zod v4 invalid_type and invalid_value issues", () => {
			const t = createTranslator(undefined);
			const errorMap = createZodErrorMap(t as any, "sk");

			expect(
				errorMap({
					code: "invalid_type",
					expected: "string",
					path: ["name"],
					message: "Invalid input: expected string, received undefined",
				}).message,
			).toBe("Toto pole je povinné");

			expect(
				errorMap({
					code: "invalid_value",
					values: ["draft", "published"],
					path: ["status"],
					message: 'Invalid option: expected one of "draft"|"published"',
				}).message,
			).toBe("Neplatná možnosť. Očakávané: draft, published");
		});

		test("should work with Zod global error map via setErrorMap", () => {
			const translatorWithLocales = createTranslator({
				messages: {
					en: {
						"validation.string.email": "Custom email error",
					},
				},
				fallbackLocale: "en",
			});

			const errorMap = createZodErrorMap(translatorWithLocales as any, "en");

			// Store the default error map to restore later
			const defaultMap = z.getErrorMap();

			// Set global error map using z.setErrorMap (Zod v4 API)
			z.setErrorMap(errorMap as any);

			try {
				const schema = z.email();
				const result = schema.safeParse("not-an-email");

				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error.issues[0]?.message).toBe("Custom email error");
				}
			} finally {
				// Restore default error map
				z.setErrorMap(defaultMap as any);
			}
		});

		test("should fall back to default error for unknown issue types", () => {
			const errorMap = createZodErrorMap(t as any);
			// Test with an unknown issue type
			const issue = {
				code: "unknown_code",
				path: [],
				message: "Default message",
			} as unknown as ZodIssue;
			const result = errorMap(issue);
			expect(result?.message).toBe("Default message");
		});
	});

	describe("ApiError with i18n", () => {
		const t = createTranslator({
			messages: {
				en: allBackendMessagesEN,
				sk: {
					"error.notFound": "Zdroj nenajdeny",
					"error.notFound.withId": "{{resource}} nenajdeny: {{id}}",
					"error.badRequest": "Nespravna poziadavka",
					"error.forbidden": "Pristup zamietnuty",
					"error.unauthorized": "Vyzaduje sa autentifikacia",
				},
			},
			fallbackLocale: "en",
		});

		test("should return original message when no translator provided", () => {
			const error = ApiError.notFound("User", "123");
			const json = error.toJSON();

			expect(json.message).toBe("User not found: 123");
		});

		test("should translate error message when translator provided", () => {
			const error = ApiError.notFound("User", "123");
			const json = error.toJSON(false, t, "sk");

			expect(json.message).toBe("User nenajdeny: 123");
		});

		test("should use getTranslatedMessage method", () => {
			const error = ApiError.unauthorized();
			const message = error.getTranslatedMessage(t, "sk");

			expect(message).toBe("Vyzaduje sa autentifikacia");
		});

		test("should fall back to original message when no messageKey", () => {
			const error = new ApiError({
				code: "BAD_REQUEST",
				message: "Custom message without key",
			});
			const message = error.getTranslatedMessage(t, "sk");

			expect(message).toBe("Custom message without key");
		});

		test("should include messageKey and messageParams in error", () => {
			const error = ApiError.notFound("User", "123");

			expect(error.messageKey).toBe("error.notFound.withId");
			expect(error.messageParams).toEqual({ resource: "User", id: "123" });
		});

		test("should keep custom forbidden reason when translator provided", () => {
			const error = ApiError.forbidden({
				operation: "delete",
				resource: "post",
				reason: "Not authorized",
			});
			const json = error.toJSON(false, t, "sk");

			expect(error.messageKey).toBeUndefined();
			expect(json.message).toBe("Not authorized");
		});

		test("should translate default forbidden reason", () => {
			const error = ApiError.forbidden({
				operation: "delete",
				resource: "post",
				reason: "Access denied",
			});
			const json = error.toJSON(false, t, "sk");

			expect(error.messageKey).toBe("error.forbidden");
			expect(json.message).toBe("Pristup zamietnuty");
		});

		test("should keep custom bad request message when translator provided", () => {
			const error = ApiError.badRequest("Storage alias route requires config");
			const json = error.toJSON(false, t, "sk");

			expect(error.messageKey).toBeUndefined();
			expect(json.message).toBe("Storage alias route requires config");
		});

		test("should translate default bad request message", () => {
			const error = ApiError.badRequest();
			const json = error.toJSON(false, t, "sk");

			expect(error.messageKey).toBe("error.badRequest");
			expect(json.message).toBe("Nespravna poziadavka");
		});

		test("should translate fromZodError", () => {
			const schema = z.object({ name: z.string().min(1) });
			const result = schema.safeParse({ name: "" });

			if (!result.success) {
				const error = ApiError.fromZodError(result.error);
				expect(error.code).toBe("VALIDATION_ERROR");
				expect(error.messageKey).toBe("error.validation");
				expect(error.fieldErrors).toBeDefined();
				expect(error.fieldErrors?.length).toBeGreaterThan(0);
			}
		});

		test("should translate fromZodError field errors in toJSON", () => {
			const schema = z.object({
				name: z.string(),
				status: z.enum(["draft", "published"]),
			});
			const result = schema.safeParse({});

			if (!result.success) {
				const error = ApiError.fromZodError(result.error);
				const json = error.toJSON(false, t, "sk");

				expect(json.fieldErrors?.[0]?.message).toBe("Toto pole je povinné");
				expect(json.fieldErrors?.[1]?.message).toBe(
					"Neplatná možnosť. Očakávané: draft, published",
				);
			}
		});
	});

	describe("ApiError constructor message keys", () => {
		const t = createTranslator({
			messages: {
				en: allBackendMessagesEN,
				sk: {
					"error.conflict": "Konflikt zdroja",
					"error.forbidden": "Pristup zamietnuty",
					"error.internal": "Interna chyba servera",
					"error.notFound": "Zdroj nenajdeny",
					"error.notFound.withId": "{{resource}} nenajdeny: {{id}}",
					"post.conflict.staleVersion": "Prispevok {{id}} bol medzitym zmeneny",
					"post.forbidden.draft": "Koncept {{id}} nie je pristupny",
					"post.internal.indexer": "Indexovanie {{collection}} zlyhalo",
					"post.notFound": "Prispevok {{id}} neexistuje",
				},
			},
			fallbackLocale: "en",
		});

		describe("conflict", () => {
			test("should preserve a supplied key and params", () => {
				const error = ApiError.conflict(
					"Post 42 was modified by someone else",
					"post.conflict.staleVersion",
					{ id: "42" },
				);

				expect(error.messageKey).toBe("post.conflict.staleVersion");
				expect(error.messageParams).toEqual({ id: "42" });
			});

			test("should render a supplied key through a translate function", () => {
				const error = ApiError.conflict(
					"Post 42 was modified by someone else",
					"post.conflict.staleVersion",
					{ id: "42" },
				);

				expect(error.toJSON(false, t, "sk").message).toBe(
					"Prispevok 42 bol medzitym zmeneny",
				);
			});

			test("should behave exactly as before when no key is given", () => {
				const error = ApiError.conflict("Post 42 was modified by someone else");

				expect(error.code).toBe("CONFLICT");
				expect(error.message).toBe("Post 42 was modified by someone else");
				expect(error.messageKey).toBe("error.conflict");
				expect(error.messageParams).toBeUndefined();
				expect(error.toJSON(false).message).toBe(
					"Post 42 was modified by someone else",
				);
				expect(error.toJSON(false, t, "sk").message).toBe("Konflikt zdroja");
			});

			test("uses a distinct translation key for failed preconditions", () => {
				const error = ApiError.preconditionFailed("Revision did not match");

				expect(error.code).toBe("PRECONDITION_FAILED");
				expect(error.messageKey).toBe("error.preconditionFailed");
			});
		});

		describe("notFound", () => {
			test("should preserve a supplied key and merge params over resource/id", () => {
				const error = ApiError.notFound("Post", "42", "post.notFound");

				expect(error.messageKey).toBe("post.notFound");
				expect(error.messageParams).toEqual({ resource: "Post", id: "42" });

				const overridden = ApiError.notFound("Post", "42", "post.notFound", {
					id: "99",
				});

				expect(overridden.messageParams).toEqual({
					resource: "Post",
					id: "99",
				});
			});

			test("should render a supplied key through a translate function", () => {
				const error = ApiError.notFound("Post", "42", "post.notFound");

				expect(error.toJSON(false, t, "sk").message).toBe(
					"Prispevok 42 neexistuje",
				);
			});

			test("should behave exactly as before when no key is given", () => {
				const withId = ApiError.notFound("Post", "42");

				expect(withId.code).toBe("NOT_FOUND");
				expect(withId.message).toBe("Post not found: 42");
				expect(withId.messageKey).toBe("error.notFound.withId");
				expect(withId.messageParams).toEqual({ resource: "Post", id: "42" });
				expect(withId.toJSON(false, t, "sk").message).toBe(
					"Post nenajdeny: 42",
				);

				const withoutId = ApiError.notFound("Post");

				expect(withoutId.message).toBe("Post not found");
				expect(withoutId.messageKey).toBe("error.notFound");
				expect(withoutId.toJSON(false, t, "sk").message).toBe(
					"Zdroj nenajdeny",
				);
			});
		});

		describe("forbidden", () => {
			const draftContext = {
				operation: "read",
				resource: "posts",
				reason: "Draft is private",
			} as const;

			test("should preserve a supplied key and merge params over reason", () => {
				const error = ApiError.forbidden(draftContext, "post.forbidden.draft", {
					id: "42",
				});

				expect(error.messageKey).toBe("post.forbidden.draft");
				expect(error.messageParams).toEqual({
					reason: "Draft is private",
					id: "42",
				});
			});

			test("should render a supplied key through a translate function", () => {
				const error = ApiError.forbidden(draftContext, "post.forbidden.draft", {
					id: "42",
				});

				expect(error.toJSON(false, t, "sk").message).toBe(
					"Koncept 42 nie je pristupny",
				);
			});

			test("should keep the access context free of translation metadata", () => {
				const error = ApiError.forbidden(draftContext, "post.forbidden.draft", {
					id: "42",
				});

				expect(error.toJSON(false, t, "sk").context?.access).toEqual({
					operation: "read",
					resource: "posts",
					reason: "Draft is private",
				});
			});

			test("should behave exactly as before when no key is given", () => {
				const custom = ApiError.forbidden(draftContext);

				expect(custom.code).toBe("FORBIDDEN");
				expect(custom.message).toBe("Draft is private");
				expect(custom.messageKey).toBeUndefined();
				expect(custom.messageParams).toBeUndefined();
				expect(custom.toJSON(false, t, "sk").message).toBe("Draft is private");

				const fallback = ApiError.forbidden({
					operation: "read",
					resource: "posts",
					reason: "Access denied",
				});

				expect(fallback.messageKey).toBe("error.forbidden");
				expect(fallback.messageParams).toEqual({ reason: "Access denied" });
				expect(fallback.toJSON(false, t, "sk").message).toBe(
					"Pristup zamietnuty",
				);
			});
		});

		describe("internal", () => {
			test("should preserve a supplied key and params alongside the cause", () => {
				const cause = new Error("connection reset");
				const error = ApiError.internal(
					"Indexer crashed",
					cause,
					"post.internal.indexer",
					{ collection: "posts" },
				);

				expect(error.messageKey).toBe("post.internal.indexer");
				expect(error.messageParams).toEqual({ collection: "posts" });
				expect(error.cause).toBe(cause);
			});

			test("should render a supplied key through a translate function", () => {
				const error = ApiError.internal(
					"Indexer crashed",
					undefined,
					"post.internal.indexer",
					{ collection: "posts" },
				);

				expect(error.toJSON(false, t, "sk").message).toBe(
					"Indexovanie posts zlyhalo",
				);
			});

			test("should behave exactly as before when no key is given", () => {
				const error = ApiError.internal("Database connection failed");

				expect(error.code).toBe("INTERNAL_SERVER_ERROR");
				expect(error.message).toBe("Database connection failed");
				expect(error.messageKey).toBe("error.internal");
				expect(error.messageParams).toBeUndefined();
				expect(error.cause).toBeUndefined();
				expect(error.toJSON(false).message).toBe("Database connection failed");
				expect(error.toJSON(false, t, "sk").message).toBe(
					"Interna chyba servera",
				);
			});
		});
	});

	describe("integration", () => {
		test("should work with full translation config", () => {
			const config: TranslationsConfig = {
				messages: {
					en: {
						"error.notFound": "Not found",
						"error.notFound.withId": "{{resource}} with ID {{id}} not found",
						"crud.create.success": "Created successfully",
					},
					de: {
						"error.notFound": "Nicht gefunden",
						"error.notFound.withId":
							"{{resource}} mit ID {{id}} nicht gefunden",
						"crud.create.success": "Erfolgreich erstellt",
					},
				},
				fallbackLocale: "en",
			};

			const t = createTranslator(config);

			// English
			expect(t("error.notFound", {})).toBe("Not found");
			expect(t("error.notFound.withId", { resource: "User", id: "42" })).toBe(
				"User with ID 42 not found",
			);

			// German
			expect(t("error.notFound", {}, "de")).toBe("Nicht gefunden");
			expect(
				t("error.notFound.withId", { resource: "Benutzer", id: "42" }, "de"),
			).toBe("Benutzer mit ID 42 nicht gefunden");

			// Fallback for missing translation
			expect(t("crud.create.success" as any, {}, "fr")).toBe(
				"Created successfully",
			);
		});

		test("should merge module translations correctly", () => {
			// Simulate base module
			const baseConfig: TranslationsConfig = {
				messages: {
					en: {
						"common.save": "Save",
						"common.cancel": "Cancel",
					},
				},
				fallbackLocale: "en",
			};

			// Simulate custom module
			const customModule: TranslationsConfig = {
				messages: {
					en: {
						"custom.greeting": "Hello!",
					},
					sk: {
						"common.save": "Ulozit",
						"custom.greeting": "Ahoj!",
					},
				},
			};

			// Merge them
			const merged = mergeTranslationsConfig(baseConfig, customModule);
			const t = createTranslator(merged);

			// Base messages still work
			expect(t("common.save" as any, {})).toBe("Save");
			expect(t("common.cancel" as any, {})).toBe("Cancel");

			// Custom module messages work
			expect(t("custom.greeting" as any, {})).toBe("Hello!");
			expect(t("custom.greeting" as any, {}, "sk")).toBe("Ahoj!");

			// Override works
			expect(t("common.save" as any, {}, "sk")).toBe("Ulozit");

			// Fallback works for missing
			expect(t("common.cancel" as any, {}, "sk")).toBe("Cancel");
		});
	});
});
