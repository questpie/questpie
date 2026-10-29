import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

import { SourceMapConsumer } from "source-map-js";
import { build } from "vite";

import { questpieSentryVite } from "../src/vite.js";
import { DSN, SECRET } from "./helpers.js";

/**
 * A real `vite build` with `questpieSentryVite`, not a mocked plugin: the
 * minified bundle is evaluated under the URL it would be served from, its
 * error is reported, and the frame on the wire is resolved back to the
 * original source through the emitted map, matched by debug id the way
 * Sentry symbolicates.
 */

const ORIGIN = "https://app.example";
const THROW_LINE = 7;
const APP = `import { createBrowserErrorReporter } from ${JSON.stringify(
	join(import.meta.dir, "../src/exports/browser.ts"),
)};

const envelopes = [];
globalThis.__envelopes = envelopes;

function chargeCard(token) {
	throw new TypeError("card declined for " + token);
}

const reporter = createBrowserErrorReporter({
	dsn: ${JSON.stringify(DSN)},
	release: "web@1.0.0",
	environment: "staging",
	formattedStacks: true,
	send: async ({ body }) => {
		envelopes.push(typeof body === "string" ? body : new TextDecoder().decode(body));
		return { statusCode: 200 };
	},
});

globalThis.__run = (token) => {
	try {
		chargeCard(token);
	} catch (error) {
		reporter.report(error, { route: "/checkout/$orderId" });
	}
	return reporter.flush(1000);
};
`;

describe("built browser bundle", () => {
	let dir: string;
	let bundle: string;
	let map: { debugId?: string; debug_id?: string } & Record<string, unknown>;
	let previousToken: string | undefined;

	const buildApp = (
		outDir: string,
		options: Partial<Parameters<typeof questpieSentryVite>[0]> = {},
	) =>
		build({
			root: dir,
			configFile: false,
			logLevel: "silent",
			plugins: [questpieSentryVite({ release: "web@1.0.0", ...options })],
			build: {
				outDir,
				emptyOutDir: true,
				minify: true,
				lib: {
					entry: join(dir, "src/main.js"),
					formats: ["iife"],
					name: "app",
					fileName: () => "assets/app.js",
				},
			},
		});

	beforeAll(async () => {
		previousToken = process.env.SENTRY_AUTH_TOKEN;
		delete process.env.SENTRY_AUTH_TOKEN;
		dir = mkdtempSync(join(tmpdir(), "questpie-sentry-built-"));
		mkdirSync(join(dir, "src"));
		writeFileSync(join(dir, "src/main.js"), APP);
		await buildApp("dist");
		// Kept only to resolve the frame here; Sentry gets the map by upload.
		await buildApp("kept", { filesToDeleteAfterUpload: [] });
		bundle = readFileSync(join(dir, "kept/assets/app.js"), "utf8");
		map = JSON.parse(readFileSync(join(dir, "kept/assets/app.js.map"), "utf8"));
	}, 60_000);

	afterAll(() => {
		if (previousToken !== undefined)
			process.env.SENTRY_AUTH_TOKEN = previousToken;
		delete (globalThis as any)._sentryDebugIds;
		delete (globalThis as any).__envelopes;
		delete (globalThis as any).__run;
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("is minified, carries a debug id and leaves no map to serve", () => {
		expect(bundle).not.toContain("chargeCard");
		expect(bundle).not.toContain("sourceMappingURL");
		expect(map.debugId ?? map.debug_id).toBeString();
		// Deleted by default even though nothing was uploaded without a token.
		expect(existsSync(join(dir, "dist/assets/app.js"))).toBe(true);
		expect(existsSync(join(dir, "dist/assets/app.js.map"))).toBe(false);
	});

	it("reports a frame that resolves to the original source through the map", async () => {
		vm.runInThisContext(bundle, { filename: `${ORIGIN}/assets/app.js` });
		await (globalThis as any).__run(SECRET);

		const envelopes: string[] = (globalThis as any).__envelopes;
		expect(envelopes).toHaveLength(1);
		const raw = envelopes[0]!;
		expect(raw).not.toContain(SECRET);
		expect(raw).not.toContain(ORIGIN);

		const lines = raw.split("\n").filter(Boolean);
		expect(JSON.parse(lines[1]!).type).toBe("event");
		expect(lines).toHaveLength(3);
		const event = JSON.parse(lines[2]!);
		expect(event).toMatchObject({
			platform: "javascript",
			release: "web@1.0.0",
			environment: "staging",
			transaction: "/checkout/$orderId",
		});

		const [exception] = event.exception.values;
		expect(exception.type).toBe("TypeError");
		const frames = exception.stacktrace.frames as Array<{
			filename?: string;
			function?: string;
			lineno?: number;
			colno?: number;
		}>;
		const fromBundle = frames.filter(
			(frame) => frame.filename === "app:///assets/app.js",
		);
		expect(fromBundle.length).toBeGreaterThan(0);
		expect(frames.every((frame) => frame.function === undefined)).toBe(true);

		const [image] = event.debug_meta.images;
		expect(image).toEqual({
			type: "sourcemap",
			code_file: "app:///assets/app.js",
			debug_id: map.debugId ?? map.debug_id,
		});

		// Sentry lists the newest frame last: the throw site.
		const top = fromBundle.at(-1)!;
		const original = new SourceMapConsumer(map as any).originalPositionFor({
			line: top.lineno!,
			column: top.colno! - 1,
		});
		expect(original.source).toEndWith("src/main.js");
		expect(original.line).toBe(THROW_LINE);
	});
});
