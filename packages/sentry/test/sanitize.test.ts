import { describe, expect, it } from "bun:test";
import { isNativeError, isProxy } from "node:util/types";

import { sanitizeError, sanitizeFilename } from "../src/sanitize.js";
import { SECRET } from "./helpers.js";

const serialized = (value: unknown) => JSON.stringify(value);

describe("sanitizeError", () => {
	it("never carries the message and keeps parsed frames", () => {
		const [exception] = sanitizeError(new TypeError(`token ${SECRET}`));
		expect(exception!.type).toBe("TypeError");
		expect(exception!.frames.length).toBeGreaterThan(0);
		expect(exception!.frames.at(-1)!.function).toBeDefined();
		expect(serialized(exception)).not.toContain(SECRET);
	});

	it("keeps identifier-shaped type names and normalizes everything else", () => {
		class ValidationError extends Error {
			override name = "ValidationError";
		}
		const dynamic = new Error("x");
		dynamic.name = SECRET;
		const spaced = new Error("x");
		spaced.name = "Error for user@example.com";
		expect(sanitizeError(new ValidationError("x"))[0]!.type).toBe(
			"ValidationError",
		);
		expect(sanitizeError(dynamic)[0]!.type).toBe("Error");
		expect(sanitizeError(spaced)[0]!.type).toBe("Error");
	});

	it("does not mistake frame-shaped message lines for frames", () => {
		const error = new Error(
			`boom\n    at stealToken (https://app.example.com/invite/${SECRET}/x.js:1:1)`,
		);
		const [exception] = sanitizeError(error);
		expect(serialized(exception)).not.toContain(SECRET);
		expect(exception!.frames.some((f) => f.function === "stealToken")).toBe(
			false,
		);
	});

	it("does not trust a stack whose header no longer matches the message", () => {
		// V8 captures the header eagerly, so a mutated message leaves the old
		// frame-shaped lines in place; JSC formats lazily from the new message.
		const error = new Error(`first\n    at stealToken (/srv/${SECRET}.js:1:1)`);
		void error.stack;
		error.message = "second";
		const [exception] = sanitizeError(error);
		expect(exception!.frames.some((f) => f.function === "stealToken")).toBe(
			false,
		);
		expect(serialized(exception)).not.toContain(SECRET);

		const forged = new Error("y");
		Object.defineProperty(forged, "stack", {
			value: `Error: x\n    at stealToken (/srv/${SECRET}.js:1:1)`,
		});
		expect(sanitizeError(forged)[0]!.frames).toEqual([]);
	});

	it("never invokes user getters, toJSON or toString", () => {
		let invoked = 0;
		const error = new Error("x");
		Object.defineProperty(error, "stack", {
			get() {
				invoked += 1;
				return `Error: x\n    at fn (/srv/${SECRET}.js:1:1)`;
			},
		});
		Object.defineProperty(error, "name", {
			get() {
				invoked += 1;
				return "TypeError";
			},
		});
		Object.defineProperty(error, "cause", {
			get() {
				invoked += 1;
				return new Error(SECRET);
			},
		});
		(error as any).toJSON = () => {
			invoked += 1;
			return SECRET;
		};
		(error as any).toString = () => {
			invoked += 1;
			return SECRET;
		};
		const result = sanitizeError(error);
		expect(invoked).toBe(0);
		expect(result).toHaveLength(1);
		expect(serialized(result)).not.toContain(SECRET);
	});

	it("treats a proxy as opaque without running its traps", () => {
		let traps = 0;
		const handler: ProxyHandler<Error> = {};
		for (const trap of [
			"get",
			"getOwnPropertyDescriptor",
			"getPrototypeOf",
			"has",
			"ownKeys",
		] as const) {
			(handler as any)[trap] = (...args: any[]) => {
				traps += 1;
				return (Reflect as any)[trap](...args);
			};
		}
		const proxy = new Proxy(new Error(SECRET), handler);
		const result = sanitizeError(proxy, { isProxy, isNativeError });
		expect(traps).toBe(0);
		expect(result).toEqual([
			{ type: "NonError", frames: [], rawFilenames: new Map() },
		]);
	});

	it("follows a bounded, cycle-safe cause chain", () => {
		const a = new Error(`a ${SECRET}`);
		const b = new RangeError(`b ${SECRET}`, { cause: a });
		(a as any).cause = b;
		const chain = sanitizeError(new Error("top", { cause: b }));
		expect(chain.map((e) => e.type)).toEqual(["Error", "RangeError", "Error"]);

		let deep: Error = new Error("0");
		for (let i = 1; i < 10; i++) deep = new Error(String(i), { cause: deep });
		expect(sanitizeError(deep)).toHaveLength(4);
		expect(serialized(chain)).not.toContain(SECRET);
	});

	it("reports thrown non-errors by kind only", () => {
		for (const value of [SECRET, { token: SECRET }, 42, null]) {
			const result = sanitizeError(value);
			expect(result[0]!.type).toBe("NonError");
			expect(serialized(result)).not.toContain(SECRET);
		}
	});

	it("parses Gecko/WebKit stacks", () => {
		const error = new Error("x");
		Object.defineProperty(error, "stack", {
			value: `handleClick@https://app.example.com/assets/index-Ab12.js?v=${SECRET}:10:5\n@https://app.example.com/assets/index-Ab12.js:1:1`,
		});
		const [exception] = sanitizeError(error);
		expect(exception!.frames).toEqual([
			{
				filename: "https://app.example.com/assets/index-Ab12.js",
				abs_path: "https://app.example.com/assets/index-Ab12.js",
				in_app: true,
				lineno: 1,
				colno: 1,
			},
			{
				function: "handleClick",
				filename: "https://app.example.com/assets/index-Ab12.js",
				abs_path: "https://app.example.com/assets/index-Ab12.js",
				in_app: true,
				lineno: 10,
				colno: 5,
			},
		]);
	});
});

describe("sanitizeFilename", () => {
	it("drops credentials, query and fragment", () => {
		expect(
			sanitizeFilename(
				`https://user:${SECRET}@cdn.example.com/a.js?t=${SECRET}#x`,
			),
		).toBe("https://cdn.example.com/a.js");
	});

	it("masks invite tokens, ids, e-mails and token-like segments", () => {
		expect(
			sanitizeFilename(`https://app.example.com/invite/${SECRET}/page.js`),
		).toBe("https://app.example.com/invite/[redacted]/page.js");
		expect(
			sanitizeFilename(
				"/srv/users/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e/alice@example.com/x.js",
			),
		).toBe("/srv/users/[redacted]/[redacted]/x.js");
		expect(sanitizeFilename(`/srv/${SECRET}/x.js`)).toBe(
			"/srv/[redacted]/x.js",
		);
	});

	it("keeps package store paths and rewrites the app root", () => {
		expect(
			sanitizeFilename(
				"/app/node_modules/.bun/zod@4.6.2/node_modules/zod/index.js",
			),
		).toBe("/app/node_modules/.bun/zod@4.6.2/node_modules/zod/index.js");
		expect(
			sanitizeFilename("/home/deploy/app/dist/server.mjs", "/home/deploy/app"),
		).toBe("app:///dist/server.mjs");
	});

	it("refuses filenames outside the safe character set", () => {
		expect(
			sanitizeFilename("eval at fn (/srv/x.js:1:1), <anonymous>"),
		).toBeUndefined();
	});
});
