import { describe, expect, it } from "bun:test";
import { isNativeError, isProxy } from "node:util/types";

import { sanitizeError, sanitizeFilename } from "../src/sanitize.js";
import { IDENT_SECRET, SECRET } from "./helpers.js";

const serialized = (value: unknown) => JSON.stringify(value);

describe("sanitizeError", () => {
	const root = process.cwd();

	it("never carries the message and keeps located frames", () => {
		const [exception] = sanitizeError(new TypeError(`token ${SECRET}`), {
			filenameRoot: root,
		});
		expect(exception!.type).toBe("TypeError");
		expect(exception!.frames.length).toBeGreaterThan(0);
		expect(exception!.frames.at(-1)!.filename).toBe(
			"app:///test/sanitize.test.ts",
		);
		expect(serialized(exception)).not.toContain(SECRET);
	});

	it("sends only built-in or registered type names", () => {
		class CustomerError extends Error {
			override name = `${IDENT_SECRET}Error`;
		}
		class ApiError extends Error {
			override name = "ApiError";
		}
		expect(sanitizeError(new CustomerError("x"))[0]!.type).toBe("Error");
		expect(sanitizeError(new ApiError("x"))[0]!.type).toBe("Error");
		expect(
			sanitizeError(new ApiError("x"), {
				errorNames: new Set(["ApiError"]),
			})[0]!.type,
		).toBe("ApiError");
		expect(sanitizeError(new RangeError("x"))[0]!.type).toBe("RangeError");
		expect(sanitizeError(new DOMException("x", "AbortError"))[0]!.type).toBe(
			"AbortError",
		);
	});

	it("never sends function names", () => {
		function AcmeTenantSentinelHandler() {
			return new Error("x");
		}
		const result = sanitizeError(AcmeTenantSentinelHandler(), {
			filenameRoot: root,
		});
		expect(serialized(result)).not.toContain(IDENT_SECRET);
		expect(result[0]!.frames.every((frame) => !("function" in frame))).toBe(
			true,
		);
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

	it("parses Gecko/WebKit stacks and keeps only built asset URLs", () => {
		const error = new Error("x");
		Object.defineProperty(error, "stack", {
			value: [
				`handleClick@https://${IDENT_SECRET.toLowerCase()}.example.com/assets/index-Ab12.js?v=${SECRET}:10:5`,
				`@https://app.example.com/invite/${SECRET}:3:7`,
				`@https://private-company.example/short-secret.js:1:1`,
			].join("\n"),
		});
		const [exception] = sanitizeError(error);
		expect(exception!.frames).toEqual([
			{ lineno: 1, colno: 1 },
			{ lineno: 3, colno: 7 },
			{
				filename: "app:///assets/index-Ab12.js",
				abs_path: "app:///assets/index-Ab12.js",
				in_app: true,
				lineno: 10,
				colno: 5,
			},
		]);
		const text = serialized(exception);
		for (const secret of [
			SECRET,
			IDENT_SECRET.toLowerCase(),
			"short-secret",
			"private-company",
			"handleClick",
		]) {
			expect(text).not.toContain(secret);
		}
	});
});

describe("sanitizeFilename", () => {
	it("keeps only paths under the app root, rebased", () => {
		expect(
			sanitizeFilename("/home/deploy/app/dist/server.mjs", {
				filenameRoot: "/home/deploy/app",
			}),
		).toBe("app:///dist/server.mjs");
		expect(
			sanitizeFilename("file:///home/deploy/app/dist/server.mjs?x=1", {
				filenameRoot: "/home/deploy/app/",
			}),
		).toBe("app:///dist/server.mjs");
		expect(
			sanitizeFilename(`/srv/${IDENT_SECRET}/x.js`, {
				filenameRoot: "/home/deploy/app",
			}),
		).toBeUndefined();
		expect(
			sanitizeFilename("/home/deploy/app-other/x.js", {
				filenameRoot: "/home/deploy/app",
			}),
		).toBeUndefined();
		expect(sanitizeFilename("/home/deploy/app/x.js")).toBeUndefined();
	});

	it("keeps only asset URLs, without host, credentials, query or fragment", () => {
		expect(
			sanitizeFilename(
				`https://user:${SECRET}@tenant.example.com/assets/a.js?t=${SECRET}#x`,
			),
		).toBe("app:///assets/a.js");
		expect(
			sanitizeFilename("https://cdn.example.com/static/js/a.js", {
				assetPathPrefixes: ["/static/"],
			}),
		).toBe("app:///static/js/a.js");
		expect(
			sanitizeFilename("https://private-company.example/short-secret.js"),
		).toBeUndefined();
		expect(
			sanitizeFilename(`https://app.example.com/invite/${SECRET}`),
		).toBeUndefined();
		expect(sanitizeFilename("webpack://app/./src/x.ts")).toBeUndefined();
	});

	it("masks id-like segments inside kept paths as a second layer", () => {
		expect(
			sanitizeFilename(
				"/app/uploads/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e/alice@example.com/x.js",
				{ filenameRoot: "/app" },
			),
		).toBe("app:///uploads/[redacted]/[redacted]/x.js");
		expect(
			sanitizeFilename(`/app/${SECRET}/x.js`, { filenameRoot: "/app" }),
		).toBe("app:///[redacted]/x.js");
	});

	it("keeps node builtins and package paths under the root", () => {
		expect(sanitizeFilename("node:internal/process/task_queues")).toBe(
			"node:internal/process/task_queues",
		);
		expect(
			sanitizeFilename(
				"/app/node_modules/.bun/zod@4.6.2/node_modules/zod/index.js",
				{ filenameRoot: "/app" },
			),
		).toBe("app:///node_modules/.bun/zod@4.6.2/node_modules/zod/index.js");
	});

	it("refuses filenames outside the safe character set", () => {
		expect(
			sanitizeFilename("/app/eval at fn (x.js:1:1), <anonymous>", {
				filenameRoot: "/app",
			}),
		).toBeUndefined();
	});
});
