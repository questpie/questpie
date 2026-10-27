import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { isNativeError, isProxy } from "node:util/types";

import { sanitizeError, sanitizeFilename } from "../src/sanitize.js";
import { IDENT_SECRET, SECRET } from "./helpers.js";

const serialized = (value: unknown) => JSON.stringify(value);
/** Bun formats a stack when its descriptor is read, so frames need the opt-in. */
const readStacks = { formattedStacks: true };
/** The server's trusted brand check; without it the value is not inspected. */
const trustedBrand = { isProxy, isNativeError };

describe("sanitizeError", () => {
	const root = process.cwd();

	it("never carries the message; files are dropped unless trusted", () => {
		const error = new TypeError(`token ${SECRET}`);
		const [untrusted] = sanitizeError(error, {
			...readStacks,
			filenameRoot: root,
		});
		expect(untrusted!.type).toBe("TypeError");
		expect(untrusted!.frames.length).toBeGreaterThan(0);
		expect(untrusted!.frames.every((f) => !("filename" in f))).toBe(true);
		expect(untrusted!.frames.at(-1)!.lineno).toBeGreaterThan(0);

		const [trusted] = sanitizeError(error, {
			...readStacks,
			filenameRoot: root,
			trustedFiles: new Set(["app:///test/sanitize.test.ts"]),
		});
		expect(trusted!.frames.at(-1)!.filename).toBe(
			"app:///test/sanitize.test.ts",
		);
		expect(serialized([untrusted, trusted])).not.toContain(SECRET);
	});

	it("cuts the header only at a full line boundary", () => {
		// A stack captured while the message was multi-line, read after the
		// message was cleared: "Error" is a prefix of "Error: first", not the
		// whole header line, so the frame-shaped message line must not survive.
		const forged = new Error("");
		Object.defineProperty(forged, "stack", {
			value: `Error: first\n    at stealToken (/app/${IDENT_SECRET}.js:1:1)\n    at real (/app/dist/a.js:2:2)`,
		});
		expect(
			sanitizeError(forged, {
				...readStacks,
				filenameRoot: "/app",
				trustedFiles: new Set([`app:///${IDENT_SECRET}.js`]),
			})[0]!.frames,
		).toEqual([]);
	});

	it("sends only built-in or registered type names", () => {
		class CustomerError extends Error {
			override name = `${IDENT_SECRET}Error`;
		}
		class ApiError extends Error {
			override name = "ApiError";
		}
		const type = (value: unknown, extra = {}) =>
			sanitizeError(value, { ...trustedBrand, ...extra })[0]!.type;
		expect(type(new CustomerError("x"))).toBe("Error");
		expect(type(new ApiError("x"))).toBe("Error");
		expect(type(new ApiError("x"), { errorNames: new Set(["ApiError"]) })).toBe(
			"ApiError",
		);
		expect(type(new RangeError("x"))).toBe("RangeError");
		// Browsers and Node brand DOMException as an error; Bun 1.3 does not, so
		// there it is opaque.
		const dom = new DOMException("x", "AbortError");
		expect(type(dom)).toBe(isNativeError(dom) ? "AbortError" : "NonError");
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

	/** Counting traps that forward — a caught throw cannot hide a call. */
	function countingHandler<T extends object>(counter: { calls: number }) {
		const handler: ProxyHandler<T> = {};
		for (const trap of [
			"get",
			"has",
			"ownKeys",
			"getOwnPropertyDescriptor",
			"getPrototypeOf",
			"defineProperty",
			"set",
			"apply",
			"construct",
		] as const) {
			(handler as any)[trap] = (...args: any[]) => {
				counter.calls += 1;
				return (Reflect as any)[trap](...args);
			};
		}
		return handler;
	}

	const serverMode = { isProxy, isNativeError };
	// Browser inspection only happens on opt-in, with the runtime's Error.isError.
	const browserMode = { formattedStacks: true };

	for (const [mode, options] of [
		["server", serverMode],
		["browser", browserMode],
	] as const) {
		it(`${mode}: a proxied error is opaque and no trap runs`, () => {
			const counter = { calls: 0 };
			const proxy = new Proxy(new Error(SECRET), countingHandler(counter));
			const result = sanitizeError(proxy, options);
			expect(counter.calls).toBe(0);
			expect(result).toEqual([
				{ type: "NonError", frames: [], rawFilenames: new Map() },
			]);
		});

		it(`${mode}: a proxy prototype is never touched`, () => {
			const counter = { calls: 0 };
			const error = new TypeError(`x ${SECRET}`);
			Object.setPrototypeOf(
				error,
				new Proxy(TypeError.prototype, countingHandler(counter)),
			);
			const result = sanitizeError(error, { ...options, filenameRoot: root });
			expect(counter.calls).toBe(0);
			// Its name lives on the (proxied) prototype, so it is not read.
			expect(result[0]!.type).toBe("Error");
			expect(serialized(result)).not.toContain(SECRET);
		});

		it(`${mode}: getters, toJSON and toString never run`, () => {
			let calls = 0;
			const getter = (value: unknown) => ({
				get() {
					calls += 1;
					return value;
				},
			});
			class Tenant extends Error {}
			Object.defineProperty(Tenant.prototype, "name", getter("TypeError"));
			Object.defineProperty(
				Tenant.prototype,
				"cause",
				getter(new Error(SECRET)),
			);
			Object.defineProperty(
				Tenant.prototype,
				"toJSON",
				getter(() => SECRET),
			);
			const error = new Tenant("x");
			Object.defineProperty(
				error,
				"stack",
				getter(`Error: x\n    at f (/srv/${SECRET}.js:1:1)`),
			);
			Object.defineProperty(error, "message", getter(SECRET));
			(error as any).toString = () => {
				calls += 1;
				return SECRET;
			};
			const result = sanitizeError(error, options);
			expect(calls).toBe(0);
			expect(result).toEqual([
				{ type: "Error", frames: [], rawFilenames: new Map() },
			]);
		});
	}

	it("without a native brand check, every value is opaque", async () => {
		const original = (Error as any).isError;
		delete (Error as any).isError;
		try {
			const { sanitizeError: withoutBrand } =
				await import("../src/sanitize.ts?no-error-is-error");
			expect(withoutBrand(new Error("x"), readStacks)).toEqual([
				{ type: "NonError", frames: [], rawFilenames: new Map() },
			]);
		} finally {
			(Error as any).isError = original;
		}
	});

	it("browser default inspects nothing, even under a core-js-shaped Error.isError", async () => {
		// core-js implements Error.isError with classof(), which reads
		// Symbol.toStringTag, marks it `sham`, and makes Function.prototype.toString
		// report native code for it — nothing public tells it from the real one.
		const original = (Error as any).isError;
		const nativeToString = Function.prototype.toString;
		let calls = 0;
		const polyfill = function isError(arg: unknown) {
			return Object.prototype.toString.call(arg) === "[object Error]";
		};
		(polyfill as any).sham = true;
		// oxlint-disable-next-line no-extend-native -- simulates core-js disguising its polyfill as native code
		Function.prototype.toString = function (this: unknown) {
			return this === polyfill
				? "function isError() { [native code] }"
				: nativeToString.call(this as () => void);
		};
		(Error as any).isError = polyfill;
		try {
			const { sanitizeError: polyfilled } =
				await import("../src/sanitize.ts?core-js-error-is-error");
			const tagged = new Error(SECRET);
			Object.defineProperty(tagged, Symbol.toStringTag, {
				get() {
					calls += 1;
					return "Error";
				},
			});
			const counter = { calls: 0 };
			const proxy = new Proxy(new Error(SECRET), countingHandler(counter));
			for (const value of [tagged, proxy]) {
				expect(polyfilled(value)).toEqual([
					{ type: "Error", frames: [], rawFilenames: new Map() },
				]);
			}
			expect(calls).toBe(0);
			expect(counter.calls).toBe(0);
			// The opt-in uses the runtime's Error.isError, whatever it is.
			polyfilled(tagged, readStacks);
			expect(calls).toBeGreaterThan(0);
		} finally {
			(Error as any).isError = original;
			// oxlint-disable-next-line no-extend-native -- simulates core-js disguising its polyfill as native code
			Function.prototype.toString = nativeToString;
		}
	});

	it("follows a bounded, cycle-safe cause chain", () => {
		const a = new Error(`a ${SECRET}`);
		const b = new RangeError(`b ${SECRET}`, { cause: a });
		(a as any).cause = b;
		const chain = sanitizeError(new Error("top", { cause: b }), trustedBrand);
		expect(chain.map((e) => e.type)).toEqual(["Error", "RangeError", "Error"]);

		let deep: Error = new Error("0");
		for (let i = 1; i < 10; i++) deep = new Error(String(i), { cause: deep });
		expect(sanitizeError(deep, trustedBrand)).toHaveLength(4);
		expect(serialized(chain)).not.toContain(SECRET);
	});

	it("reports thrown non-errors by kind only", () => {
		for (const value of [SECRET, { token: SECRET }, 42, null]) {
			const inspected = sanitizeError(value, trustedBrand);
			const opaque = sanitizeError(value);
			expect(inspected[0]!.type).toBe("NonError");
			// Without a trusted brand check an object is not inspected: "Error".
			expect(opaque[0]!.type).toBe(
				typeof value === "object" && value !== null ? "Error" : "NonError",
			);
			expect(serialized([inspected, opaque])).not.toContain(SECRET);
		}
	});

	it("parses Gecko/WebKit stacks and keeps only registered artifacts", () => {
		const error = new Error("x");
		Object.defineProperty(error, "stack", {
			value: [
				`handleClick@https://${IDENT_SECRET.toLowerCase()}.example.com/assets/index-Ab12.js?v=${SECRET}:10:5`,
				`@https://app.example.com/invite/${SECRET}:3:7`,
				`@https://private-company.example/short-secret.js:1:1`,
			].join("\n"),
		});
		const registered = `https://${IDENT_SECRET.toLowerCase()}.example.com/assets/index-Ab12.js?v=${SECRET}`;
		const [exception] = sanitizeError(error, {
			...readStacks,
			registeredFiles: new Set([registered]),
		});
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
	const trustAll = { has: () => true };

	it("drops every file by default, whatever the root or path", () => {
		for (const [raw, root] of [
			["https://private.example/assets/7312.js", undefined],
			[`${process.cwd()}/uploads/7312.js`, process.cwd()],
			["/app/dist/server.mjs", "/app"],
			["file:///app/dist/server.mjs", "/app"],
		] as const) {
			expect(sanitizeFilename(raw, { filenameRoot: root })).toBeUndefined();
		}
	});

	it("sends a registered artifact rewritten without host, query or root", () => {
		const registered = new Set([
			`https://user:${SECRET}@tenant.example.com/assets/a.js?t=${SECRET}#x`,
			"/home/deploy/app/dist/server.mjs",
			"file:///home/deploy/app/dist/chunk.mjs?x=1",
		]);
		const options = {
			registeredFiles: registered,
			filenameRoot: "/home/deploy/app/",
		};
		expect(sanitizeFilename([...registered][0]!, options)).toBe(
			"app:///assets/a.js",
		);
		expect(sanitizeFilename("/home/deploy/app/dist/server.mjs", options)).toBe(
			"app:///dist/server.mjs",
		);
		expect(
			sanitizeFilename("file:///home/deploy/app/dist/chunk.mjs?x=1", options),
		).toBe("app:///dist/chunk.mjs");
		// Registered but outside the root: cannot be rewritten, so dropped.
		expect(
			sanitizeFilename("/srv/other/x.js", {
				registeredFiles: new Set(["/srv/other/x.js"]),
				filenameRoot: "/home/deploy/app",
			}),
		).toBeUndefined();
	});

	it("sends an exactly listed file and nothing next to it", () => {
		const options = {
			filenameRoot: "/app",
			trustedFiles: new Set(["app:///dist/worker.mjs"]),
		};
		expect(sanitizeFilename("/app/dist/worker.mjs", options)).toBe(
			"app:///dist/worker.mjs",
		);
		expect(sanitizeFilename("/app/dist/worker-2.mjs", options)).toBeUndefined();
		expect(sanitizeFilename("/app/uploads/7312.js", options)).toBeUndefined();
	});

	it("treats a filesystem or drive root as no root at all", () => {
		for (const [root, path] of [
			["/", "/home/alice/.ssh/id_rsa.js"],
			["//", "/etc/app/config.js"],
			["C:\\", "C:\\Users\\alice\\secret.js"],
			["C:/", "C:/Users/alice/secret.js"],
		]) {
			expect(
				sanitizeFilename(path!, {
					filenameRoot: root,
					registeredFiles: trustAll,
				}),
			).toBeUndefined();
		}
		expect(
			sanitizeFilename("C:\\app\\dist\\server.mjs", {
				filenameRoot: "C:\\app",
				registeredFiles: trustAll,
			}),
		).toBe("app:///dist/server.mjs");
	});

	it("drops paths with dot segments instead of resolving them", () => {
		for (const raw of [
			"/app/../tenant-acme/7312.js",
			"/app/./dist/x.js",
			"https://app.example.com/assets/../invite/abc.js",
			"https://app.example.com/",
		]) {
			expect(
				sanitizeFilename(raw, {
					filenameRoot: "/app",
					registeredFiles: trustAll,
				}),
			).toBeUndefined();
		}
	});

	it("drops node: locations and refuses unsafe characters", () => {
		for (const raw of [
			"node:internal/process/task_queues",
			"node:tenantacme",
		]) {
			expect(
				sanitizeFilename(raw, {
					filenameRoot: "/app",
					registeredFiles: trustAll,
				}),
			).toBeUndefined();
		}
		const error = new Error("x");
		Object.defineProperty(error, "stack", {
			value: "Error: x\n    at load (node:tenantacme:3:4)",
		});
		const result = sanitizeError(error, {
			...readStacks,
			isProxy,
			isNativeError,
		});
		expect(result[0]!.frames).toEqual([{ lineno: 3, colno: 4 }]);
		expect(serialized(result)).not.toContain("tenantacme");
		expect(
			sanitizeFilename("/app/eval at fn (x.js:1:1), <anonymous>", {
				filenameRoot: "/app",
				registeredFiles: trustAll,
			}),
		).toBeUndefined();
	});
});

describe("on V8 (node)", () => {
	// V8 formats stacks lazily and runs the realm's Error.prepareStackTrace;
	// on Node 20 even reading the stack DESCRIPTOR formats it. Each scenario
	// runs in a fresh process, on `node` plus any binaries listed in
	// QUESTPIE_TEST_NODE_BINARIES (path-separated), e.g. older supported Nodes.
	const binaries = [
		Bun.which("node"),
		...(process.env.QUESTPIE_TEST_NODE_BINARIES ?? "")
			.split(delimiter)
			.filter(Boolean),
	].filter((binary): binary is string => Boolean(binary));
	const v8It = binaries.length ? it : it.skip;

	function runScenario(
		binary: string,
		scenario: string,
		formattedStacks: boolean,
		mode: "server" | "browser" = "server",
	) {
		const source = new Bun.Transpiler({ loader: "ts" }).transformSync(
			readFileSync(join(import.meta.dir, "../src/sanitize.ts"), "utf8"),
		);
		const harness = `
import { isNativeError, isProxy } from "node:util/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import vm from "node:vm";
const scenario = ${JSON.stringify(scenario)};
let calls = 0;
const custom = function prepareStackTrace() {
	calls++;
	return "Error: forged\\n    at fake (/app/x.js:1:1)";
};
if (scenario === "custom-before") Error.prepareStackTrace = custom;
if (scenario === "accessor-before") {
	Object.defineProperty(Error, "prepareStackTrace", {
		configurable: true,
		get() { calls++; return undefined; },
	});
}
${source}
const importCalls = calls;
if (scenario === "custom-after") Error.prepareStackTrace = custom;
if (scenario === "inherited") {
	delete Error.prepareStackTrace;
	Object.defineProperty(Function.prototype, "prepareStackTrace", {
		configurable: true,
		get() { calls++; return undefined; },
	});
}
const here = fileURLToPath(import.meta.url);
// Same trusted-metadata rule as the server and browser entry points.
const inertStackDescriptors = ${JSON.stringify(mode)} === "server"
	? process.versions.bun === undefined && Number.parseInt(process.versions.node, 10) >= 22
	: typeof Error.isError === "function" && globalThis.Bun === undefined;
const options = {
	...(${JSON.stringify(mode)} === "server" ? { isProxy, isNativeError } : {}),
	filenameRoot: dirname(here),
	registeredFiles: { has: (raw) => raw === import.meta.url || raw === here },
	formattedStacks: ${formattedStacks},
	inertStackDescriptors,
};
function thrower() { return new RangeError("x"); }
let error = thrower();
if (scenario.startsWith("node-error")) {
	try { Buffer.alloc(-1); } catch (caught) { error = caught; }
}
if (scenario === "node-error-code-getter") {
	const code = error.code;
	Object.defineProperty(error, "code", {
		configurable: true,
		get() { calls++; return code; },
	});
}
if (scenario === "vm-graft") {
	// A foreign-realm error with its own formatter, grafted onto this realm.
	const context = vm.createContext({ count: () => { calls++; } });
	error = vm.runInContext(
		"Error.prepareStackTrace = () => { count(); return 'Error: x'; }; new Error('x')",
		context,
	);
	Object.defineProperty(error, "stack", Object.getOwnPropertyDescriptor(new Error("p"), "stack"));
	Object.setPrototypeOf(error, Error.prototype);
}
const before = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
calls = 0;
const [result] = sanitizeError(error, options);
const sanitizeCalls = calls;
const after = Object.getOwnPropertyDescriptor(Error, "prepareStackTrace");
const untouched = before === undefined
	? after === undefined
	: after !== undefined && ["value", "get", "set", "writable", "configurable", "enumerable"].every((k) => before[k] === after[k]);
calls = 0;
const appStack = String(error.stack);
console.log(JSON.stringify({
	node: process.versions.node,
	type: result.type,
	importCalls,
	sanitizeCalls,
	frames: result.frames.length,
	files: result.frames.filter((f) => f.filename).map((f) => f.filename),
	untouched,
	appCalls: calls,
	appForged: appStack.includes("forged"),
}));
`;
		const dir = mkdtempSync(join(tmpdir(), "questpie-sentry-v8-"));
		const file = join(dir, "harness.mjs");
		writeFileSync(file, harness);
		try {
			const result = spawnSync(binary, [file], {
				encoding: "utf8",
				timeout: 20_000,
			});
			expect(result.stderr).toBe("");
			return JSON.parse(result.stdout);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	const scenarios = [
		"default",
		"node-error",
		"node-error-code-getter",
		"custom-before",
		"custom-after",
		"accessor-before",
		"inherited",
		"vm-graft",
	];

	v8It("by default runs nothing and modifies nothing, import included", () => {
		for (const binary of binaries) {
			for (const scenario of scenarios) {
				const out = runScenario(binary, scenario, false);
				expect({ scenario, ...out }).toMatchObject({
					scenario,
					importCalls: 0,
					sanitizeCalls: 0,
					frames: 0,
					untouched: true,
				});
			}
			// The app's own formatter stays in charge of its errors.
			expect(runScenario(binary, "custom-before", false)).toMatchObject({
				appCalls: 1,
				appForged: true,
			});
		}
	});

	v8It(
		"formattedStacks: default and Node errors keep frames and locations",
		() => {
			for (const binary of binaries) {
				for (const scenario of ["default", "node-error"]) {
					const out = runScenario(binary, scenario, true);
					expect({
						scenario,
						node: out.node,
						calls: out.sanitizeCalls,
					}).toEqual({ scenario, node: out.node, calls: 0 });
					expect(out.untouched).toBe(true);
					expect(out.frames).toBeGreaterThan(0);
					expect(out.files).toContain("app:///harness.mjs");
				}
			}
		},
	);

	v8It("formattedStacks: the error's own code getter never runs", () => {
		for (const binary of binaries) {
			expect(runScenario(binary, "node-error-code-getter", true)).toMatchObject(
				{
					sanitizeCalls: 0,
					frames: 0,
					untouched: true,
				},
			);
		}
	});

	v8It(
		"formattedStacks: an installed formatter runs, as error.stack would",
		() => {
			// The documented contract of the opt-in: the runtime's formatting,
			// including an app's or a foreign realm's hook. The sanitizer itself
			// changes nothing global.
			for (const binary of binaries) {
				for (const scenario of ["custom-before", "custom-after"]) {
					const out = runScenario(binary, scenario, true);
					expect({
						scenario,
						calls: out.sanitizeCalls,
						untouched: out.untouched,
					}).toEqual({ scenario, calls: 1, untouched: true });
				}
				// Node 20 copies the graft's stack as an already formatted string, so
				// the foreign hook runs at most once.
				const graft = runScenario(binary, "vm-graft", true);
				expect(graft.sanitizeCalls).toBeLessThanOrEqual(1);
				expect(graft.untouched).toBe(true);
			}
		},
	);

	v8It(
		"browser mode: an ordinary error without code keeps frames on opt-in",
		() => {
			for (const binary of binaries) {
				const optIn = runScenario(binary, "default", true, "browser");
				if (optIn.type === "NonError") continue; // no native Error.isError here
				expect(optIn.sanitizeCalls).toBe(0);
				expect(optIn.frames).toBeGreaterThan(0);
				expect(runScenario(binary, "default", false, "browser")).toMatchObject({
					sanitizeCalls: 0,
					frames: 0,
				});
			}
		},
	);
});
