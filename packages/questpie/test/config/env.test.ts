/**
 * Tests: the env primitive — `env()` (server) + `resolveClientEnv()` (client).
 *
 * Covers:
 * 1. Aggregate multi-var error — every offending NAME listed, values never
 * 2. emptyStringAsUndefined (default true, opt-out)
 * 3. skipValidation — explicit option + QUESTPIE_SKIP_ENV_VALIDATION flag
 * 4. Framework base preset — typed access + app tightening (optional → required)
 * 5. refine — returned string fails construction, thrown error propagates
 * 6. Client vars server-side — unprefixed wins, prefixed fallback per consumer
 * 7. isServer guard — browser-like context throws
 * 8. resolveClientEnv — validation, physical names in errors, frozen output
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { resolveClientEnv } from "../../src/client/env/resolve.js";
import { createApp } from "../../src/server/config/create-app.js";
import { env } from "../../src/server/env/define.js";
import { clientEnv } from "../../src/shared/env/client-env.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

// ─────────────────────────────────────────────────────────────────────────────
// process.env sandbox — every key touched by these tests is saved/restored
// ─────────────────────────────────────────────────────────────────────────────

const TOUCHED_KEYS = [
	"QUESTPIE_SKIP_ENV_VALIDATION",
	"DATABASE_URL",
	"APP_URL",
	"BETTER_AUTH_SECRET",
	"TEST_FOO",
	"TEST_BAR",
	"TEST_SECRET",
	"EXPO_PUBLIC_TEST_PUBLIC_URL",
	"VITE_TEST_PUBLIC_URL",
	"TEST_PUBLIC_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
	saved = {};
	for (const key of TOUCHED_KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of TOUCHED_KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// env() — validation
// ─────────────────────────────────────────────────────────────────────────────

describe("env() — aggregate errors", () => {
	it("lists every offending var name in one error", () => {
		process.env.TEST_BAR = "short";
		expect(() =>
			env({
				server: {
					TEST_FOO: z.string(),
					TEST_BAR: z.string().min(32),
				},
			}),
		).toThrow(/TEST_FOO[\s\S]*TEST_BAR/);
	});

	it("never includes values in the error message", () => {
		process.env.TEST_SECRET = "super-secret-value-do-not-log";
		let message = "";
		try {
			env({
				server: {
					TEST_SECRET: z.string().min(64),
					TEST_FOO: z.string(),
				},
			});
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain("TEST_SECRET");
		expect(message).not.toContain("super-secret-value-do-not-log");
	});

	it("returns typed values when everything validates", () => {
		process.env.TEST_FOO = "hello";
		const e = env({ server: { TEST_FOO: z.string() } });
		expect(e.TEST_FOO).toBe("hello");
	});

	it("returns a frozen object", () => {
		process.env.TEST_FOO = "hello";
		const e = env({ server: { TEST_FOO: z.string() } });
		expect(Object.isFrozen(e)).toBe(true);
	});

	it("applies schema transforms (coercion)", () => {
		process.env.TEST_FOO = "8080";
		const e = env({ server: { TEST_FOO: z.coerce.number() } });
		expect(e.TEST_FOO).toBe(8080);
	});
});

describe("env() — emptyStringAsUndefined", () => {
	it("treats empty strings as undefined by default", () => {
		process.env.TEST_FOO = "";
		const e = env({ server: { TEST_FOO: z.string().optional() } });
		expect(e.TEST_FOO).toBeUndefined();
	});

	it("fails a required var set to empty string by default", () => {
		process.env.TEST_FOO = "";
		expect(() => env({ server: { TEST_FOO: z.string() } })).toThrow(/TEST_FOO/);
	});

	it("passes empty strings through when opted out", () => {
		process.env.TEST_FOO = "";
		const e = env({
			server: { TEST_FOO: z.string() },
			emptyStringAsUndefined: false,
		});
		expect(e.TEST_FOO).toBe("");
	});
});

describe("env() — skipValidation", () => {
	it("skips validation with the explicit option (raw values, no throw)", () => {
		const e = env({
			server: { TEST_FOO: z.string() },
			skipValidation: true,
		});
		expect(e.TEST_FOO).toBeUndefined();
	});

	it("skips validation when QUESTPIE_SKIP_ENV_VALIDATION is set", () => {
		process.env.QUESTPIE_SKIP_ENV_VALIDATION = "1";
		const e = env({ server: { TEST_FOO: z.string() } });
		expect(e.TEST_FOO).toBeUndefined();
	});

	it("does not run refine when skipping", () => {
		process.env.QUESTPIE_SKIP_ENV_VALIDATION = "1";
		expect(() =>
			env({
				server: {},
				refine: () => "should never fail — refine must not run",
			}),
		).not.toThrow();
	});
});

describe("env() — framework base preset", () => {
	it("exposes base vars as typed optional values", () => {
		process.env.DATABASE_URL = "postgres://localhost/db";
		const e = env({ server: {} });
		expect(e.DATABASE_URL).toBe("postgres://localhost/db");
		expect(e.QUESTPIE_DB).toBeUndefined();
	});

	it("lets the app tighten a base var (optional → required)", () => {
		expect(() => env({ server: { DATABASE_URL: z.string() } })).toThrow(
			/DATABASE_URL/,
		);
	});

	it("does not fail boot when optional base vars are absent", () => {
		expect(() => env({ server: {} })).not.toThrow();
	});
});

describe("env() — refine", () => {
	it("fails construction when refine returns a message", () => {
		process.env.BETTER_AUTH_SECRET = "dev-secret";
		expect(() =>
			env({
				server: {},
				refine: (e) =>
					e.BETTER_AUTH_SECRET === "dev-secret"
						? "BETTER_AUTH_SECRET must not be the dev default"
						: undefined,
			}),
		).toThrow(/BETTER_AUTH_SECRET must not be the dev default/);
	});

	it("propagates errors thrown inside refine", () => {
		expect(() =>
			env({
				server: {},
				refine: () => {
					throw new Error("boom from refine");
				},
			}),
		).toThrow(/boom from refine/);
	});

	it("receives the validated env (cross-field guard)", () => {
		process.env.TEST_FOO = "a";
		process.env.TEST_BAR = "a";
		expect(() =>
			env({
				server: { TEST_FOO: z.string(), TEST_BAR: z.string() },
				refine: (e) =>
					e.TEST_FOO === e.TEST_BAR
						? "TEST_FOO and TEST_BAR must differ"
						: undefined,
			}),
		).toThrow(/must differ/);
	});
});

describe("env() — client vars server-side", () => {
	const client = clientEnv({
		consumers: ["expo", "vite"],
		vars: { TEST_PUBLIC_URL: z.string() },
	});

	it("falls back to the prefixed spelling per declared consumer", () => {
		process.env.EXPO_PUBLIC_TEST_PUBLIC_URL = "https://from-expo.test";
		const e = env({ server: {}, client });
		expect(e.TEST_PUBLIC_URL).toBe("https://from-expo.test");
	});

	it("prefers the unprefixed spelling when both are set", () => {
		process.env.TEST_PUBLIC_URL = "https://unprefixed.test";
		process.env.VITE_TEST_PUBLIC_URL = "https://from-vite.test";
		const e = env({ server: {}, client });
		expect(e.TEST_PUBLIC_URL).toBe("https://unprefixed.test");
	});

	it("fails boot when a required client var is missing everywhere", () => {
		expect(() => env({ server: {}, client })).toThrow(/TEST_PUBLIC_URL/);
	});
});

describe("env() — isServer guard", () => {
	it("throws in a browser-like context", () => {
		expect(() => env({ server: {}, isServer: false })).toThrow(/server-only/);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// clientEnv()
// ─────────────────────────────────────────────────────────────────────────────

describe("clientEnv()", () => {
	it("returns a frozen definition without reading the environment", () => {
		const def = clientEnv({
			consumers: ["expo"],
			vars: { TEST_PUBLIC_URL: z.string() },
		});
		expect(Object.isFrozen(def)).toBe(true);
		expect(def.consumers).toEqual(["expo"]);
		expect(Object.keys(def.vars)).toEqual(["TEST_PUBLIC_URL"]);
	});

	it("rejects unknown preset names at definition time", () => {
		expect(() =>
			clientEnv({
				// @ts-expect-error — invalid preset name
				consumers: ["webpack"],
				vars: {},
			}),
		).toThrow(/Unknown client env consumer/);
	});

	it("accepts custom consumer configs", () => {
		const def = clientEnv({
			consumers: [
				{ name: "astro", prefix: "PUBLIC_", envObject: "import.meta.env" },
			],
			vars: {},
		});
		expect(def.consumers[0].name).toBe("astro");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveClientEnv()
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveClientEnv()", () => {
	const def = clientEnv({
		consumers: ["expo"],
		vars: {
			TEST_PUBLIC_URL: z.string(),
			TEST_OPTIONAL: z.string().optional(),
		},
	});

	it("validates and returns the typed, frozen env", () => {
		const resolved = resolveClientEnv(
			def,
			{ TEST_PUBLIC_URL: "https://app.test", TEST_OPTIONAL: undefined },
			"expo",
		);
		expect(resolved.TEST_PUBLIC_URL).toBe("https://app.test");
		expect(resolved.TEST_OPTIONAL).toBeUndefined();
		expect(Object.isFrozen(resolved)).toBe(true);
	});

	it("names the physical (prefixed) var in errors", () => {
		expect(() =>
			resolveClientEnv(
				def,
				{ TEST_PUBLIC_URL: undefined, TEST_OPTIONAL: undefined },
				"expo",
			),
		).toThrow(/EXPO_PUBLIC_TEST_PUBLIC_URL/);
	});

	it("treats empty strings as undefined", () => {
		const resolved = resolveClientEnv(
			def,
			{ TEST_PUBLIC_URL: "https://app.test", TEST_OPTIONAL: "" },
			"expo",
		);
		expect(resolved.TEST_OPTIONAL).toBeUndefined();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot integration — AppDefinition.env → app.env
// ─────────────────────────────────────────────────────────────────────────────

describe("createApp — env wiring", () => {
	it("stores the validated env on app.env, not in extension state", async () => {
		process.env.TEST_FOO = "from-env";
		const validated = env({ server: { TEST_FOO: z.string() } });

		const db = await createTestDb();
		try {
			const app = await createApp(
				{ modules: [], env: validated },
				{
					app: { url: "http://localhost:3000" },
					db: { pglite: db },
					email: { adapter: new MockMailAdapter() },
					queue: { adapter: new MockQueueAdapter() },
					kv: { adapter: new MockKVAdapter() },
					logger: { adapter: new MockLogger() },
				},
			);

			expect(app.env).toBe(validated);
			expect((app.env as Record<string, unknown>).TEST_FOO).toBe("from-env");
			expect(app.state?.env).toBeUndefined();

			await app.destroy();
		} finally {
			await db.close();
		}
	});
});
