import { describe, expect, test } from "bun:test";
import type { BetterAuthOptions } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import {
	auth,
	coreAuthCollections,
	coreAuthOptions,
	mergeAuthOptions,
} from "../../src/server/integrated/auth/config.js";

describe("auth", () => {
	test("should return the same options object passed in", () => {
		const options: BetterAuthOptions = {
			baseURL: "http://localhost:3000",
			secret: "test-secret",
		};
		const result = auth(options);

		expect(result).toBe(options);
	});

	test("should preserve baseURL", () => {
		const options: BetterAuthOptions = {
			baseURL: "http://localhost:3000",
			secret: "test-secret",
		};
		const result = auth(options);

		expect(result.baseURL).toBe("http://localhost:3000");
	});

	test("should preserve secret", () => {
		const options: BetterAuthOptions = {
			baseURL: "http://localhost:3000",
			secret: "test-secret",
		};
		const result = auth(options);

		expect(result.secret).toBe("test-secret");
	});
});

describe("coreAuthOptions", () => {
	test("should be an instance of BetterAuthOptions", () => {
		expect(coreAuthOptions).toBeDefined();
		expect(typeof coreAuthOptions).toBe("object");
	});

	test("should have plugins array", () => {
		expect(coreAuthOptions.plugins).toBeDefined();
		expect(Array.isArray(coreAuthOptions.plugins)).toBe(true);
	});

	test("should include at least 3 plugins (admin, api-key, bearer)", () => {
		const length = coreAuthOptions.plugins?.length ?? 0;
		expect(length >= 3).toBe(true);
	});

	test("should have admin plugin", () => {
		const pluginIds = coreAuthOptions.plugins?.map((p) => p.id) ?? [];
		expect(pluginIds.includes("admin")).toBe(true);
	});

	test("should have api-key plugin", () => {
		const pluginIds = coreAuthOptions.plugins?.map((p) => p.id) ?? [];
		expect(pluginIds.includes("api-key")).toBe(true);
	});

	test("should have bearer plugin", () => {
		const pluginIds = coreAuthOptions.plugins?.map((p) => p.id) ?? [];
		expect(pluginIds.includes("bearer")).toBe(true);
	});

	test("should enable emailAndPassword authentication", () => {
		expect(coreAuthOptions.emailAndPassword?.enabled).toBe(true);
	});

	test("should require email verification", () => {
		expect(coreAuthOptions.emailAndPassword?.requireEmailVerification).toBe(
			true,
		);
	});

	test("should set useSecureCookies based on NODE_ENV", () => {
		const isProduction = process.env.NODE_ENV === "production";
		expect(coreAuthOptions.advanced?.useSecureCookies).toBe(isProduction);
	});
});

describe("coreAuthCollections", () => {
	test("should have user collection", () => {
		expect(coreAuthCollections.user).toBeDefined();
	});

	test("should have session collection", () => {
		expect(coreAuthCollections.session).toBeDefined();
	});

	test("should have account collection", () => {
		expect(coreAuthCollections.account).toBeDefined();
	});

	test("should have verification collection", () => {
		expect(coreAuthCollections.verification).toBeDefined();
	});

	test("should have apikey collection", () => {
		expect(coreAuthCollections.apikey).toBeDefined();
	});

	test("should have exactly 5 collections", () => {
		const collectionKeys = Object.keys(coreAuthCollections);
		expect(collectionKeys.length).toBe(5);
	});

	test("should have correct collection keys", () => {
		const collectionKeys = new Set(Object.keys(coreAuthCollections));
		expect(collectionKeys.has("user")).toBe(true);
		expect(collectionKeys.has("session")).toBe(true);
		expect(collectionKeys.has("account")).toBe(true);
		expect(collectionKeys.has("verification")).toBe(true);
		expect(collectionKeys.has("apikey")).toBe(true);
	});
});

describe("mergeAuthOptions", () => {
	describe("basic merging", () => {
		test("should override baseURL from overrides", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "base-secret",
			};
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.baseURL).toBe("http://localhost:3001");
		});

		test("should preserve baseURL from base when not in overrides", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "base-secret",
			};
			const overrides: BetterAuthOptions = {};

			const result = mergeAuthOptions(base, overrides);

			expect(result.baseURL).toBe("http://localhost:3000");
		});

		test("should preserve secret from base", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "base-secret",
			};
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.secret).toBe("base-secret");
		});

		test("should override secret from overrides", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "base-secret",
			};
			const overrides: BetterAuthOptions = {
				secret: "override-secret",
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.secret).toBe("override-secret");
		});
	});

	describe("plugin merging", () => {
		test("should combine plugins from base and overrides", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};
			const overrides: BetterAuthOptions = {
				plugins: [bearer()],
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.plugins).toBeDefined();
			expect(((result.plugins?.length as number) ?? 0) === 2).toBe(true);
		});

		test("should place override plugins before base plugins (newer precedence)", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};
			const overrides: BetterAuthOptions = {
				plugins: [bearer()],
			};

			const result = mergeAuthOptions(base, overrides);

			expect(((result.plugins?.length as number) ?? 0) === 2).toBe(true);
			const firstPluginId = (result.plugins as any)?.[0]?.id;
			expect(firstPluginId).toBe("bearer");
		});

		test("should deduplicate plugins by id", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin(), bearer()],
			};
			const overrides: BetterAuthOptions = {
				plugins: [admin()],
			};

			const result = mergeAuthOptions(base, overrides);

			expect(((result.plugins?.length as number) ?? 0) === 2).toBe(true);
			const ids = (result.plugins as any)?.map((p: any) => p.id) ?? [];
			const adminCount = ids.filter((id: any) => id === "admin").length;
			expect(adminCount).toBe(1);
		});

		test("should handle empty plugin arrays from base", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [],
			};
			const overrides: BetterAuthOptions = {
				plugins: [admin()],
			};

			const result = mergeAuthOptions(base, overrides);

			expect(((result.plugins?.length as number) ?? 0) === 1).toBe(true);
		});

		test("should handle undefined plugins in base", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
			};
			const overrides: BetterAuthOptions = {
				plugins: [admin()],
			};

			const result = mergeAuthOptions(base, overrides);

			expect(((result.plugins?.length as number) ?? 0) === 1).toBe(true);
		});

		test("should handle undefined plugins in overrides", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};

			const result = mergeAuthOptions(base, overrides);

			expect(((result.plugins?.length as number) ?? 0) === 1).toBe(true);
		});

		test("should handle multiple identical plugins with deduplication", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin(), admin(), bearer()],
			};
			const overrides: BetterAuthOptions = {};

			const result = mergeAuthOptions(base, overrides);

			const ids = (result.plugins as any)?.map((p: any) => p.id) ?? [];
			const adminCount = ids.filter((id: any) => id === "admin").length;
			expect(adminCount).toBe(1);
		});
	});

	describe("nested option merging with advanced options", () => {
		test("should deep merge advanced options", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				advanced: {
					useSecureCookies: false,
					disableCSRFCheck: false,
				},
			};
			const overrides: BetterAuthOptions = {
				advanced: {
					useSecureCookies: true,
				},
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.advanced?.useSecureCookies).toBe(true);
			expect(result.advanced?.disableCSRFCheck).toBe(false);
		});
	});

	describe("nested option merging with socialProviders", () => {
		test("should shallow merge socialProviders", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				socialProviders: {
					github: {
						clientId: "base-id",
						clientSecret: "base-secret",
					},
				},
			};
			const overrides: BetterAuthOptions = {
				socialProviders: {
					google: {
						clientId: "google-id",
						clientSecret: "google-secret",
					},
				},
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.socialProviders?.github).toBeDefined();
			expect(result.socialProviders?.google).toBeDefined();
		});

		test("should override entire socialProviders entry", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				socialProviders: {
					github: {
						clientId: "base-id",
						clientSecret: "base-secret",
					},
				},
			};
			const overrides: BetterAuthOptions = {
				socialProviders: {
					github: {
						clientId: "override-id",
						clientSecret: "override-secret",
					},
				},
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.socialProviders?.github?.clientId).toBe("override-id");
		});
	});

	describe("real-world scenarios", () => {
		test("should merge custom config with core options structure", () => {
			const customConfig: BetterAuthOptions = {
				baseURL: "https://custom-domain.com",
				plugins: [bearer()],
			};

			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};

			const result = mergeAuthOptions(base, customConfig);

			expect(result.baseURL).toBe("https://custom-domain.com");
			expect(result.secret).toBe("secret");
			expect(((result.plugins?.length as number) ?? 0) === 2).toBe(true);
		});

		test("should handle sequential merges", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};
			const override1: BetterAuthOptions = {
				plugins: [bearer()],
			};
			const override2: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};

			const merged1 = mergeAuthOptions(base, override1);
			const merged2 = mergeAuthOptions(merged1, override2);

			expect(merged2.baseURL).toBe("http://localhost:3001");
			expect(((merged2.plugins?.length as number) ?? 0) === 2).toBe(true);
		});

		test("should handle complex plugin and config merge", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "base-secret",
				plugins: [admin(), bearer()],
				socialProviders: {
					github: {
						clientId: "github-id",
						clientSecret: "github-secret",
					},
				},
			};

			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
				plugins: [admin()],
				socialProviders: {
					google: {
						clientId: "google-id",
						clientSecret: "google-secret",
					},
				},
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.baseURL).toBe("http://localhost:3001");
			expect(result.secret).toBe("base-secret");
			expect(((result.plugins?.length as number) ?? 0) === 2).toBe(true);
			expect(result.socialProviders?.github).toBeDefined();
			expect(result.socialProviders?.google).toBeDefined();
		});
	});

	describe("immutability", () => {
		test("should not mutate base options object", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
			};
			const baseCopy = { ...base };
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};

			mergeAuthOptions(base, overrides);

			expect(base.baseURL).toBe(baseCopy.baseURL);
			expect(base.secret).toBe(baseCopy.secret);
		});

		test("should not mutate overrides object", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
			};
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};
			const overridesCopy = { ...overrides };

			mergeAuthOptions(base, overrides);

			expect(overrides.baseURL).toBe(overridesCopy.baseURL);
		});

		test("should return new object reference", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
			};
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3001",
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result).not.toBe(base);
			expect(result).not.toBe(overrides);
		});
	});

	describe("edge cases", () => {
		test("should handle empty overrides", () => {
			const base: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};
			const overrides: BetterAuthOptions = {};

			const result = mergeAuthOptions(base, overrides);

			expect(result.baseURL).toBe("http://localhost:3000");
			expect(result.secret).toBe("secret");
			expect(((result.plugins?.length as number) ?? 0) === 1).toBe(true);
		});

		test("should handle empty base", () => {
			const base: BetterAuthOptions = {};
			const overrides: BetterAuthOptions = {
				baseURL: "http://localhost:3000",
				secret: "secret",
				plugins: [admin()],
			};

			const result = mergeAuthOptions(base, overrides);

			expect(result.baseURL).toBe("http://localhost:3000");
			expect(result.secret).toBe("secret");
			expect(((result.plugins?.length as number) ?? 0) === 1).toBe(true);
		});

		test("should handle both being empty", () => {
			const base: BetterAuthOptions = {};
			const overrides: BetterAuthOptions = {};

			const result = mergeAuthOptions(base, overrides);

			expect(result).toBeDefined();
			expect(typeof result).toBe("object");
		});
	});
});
