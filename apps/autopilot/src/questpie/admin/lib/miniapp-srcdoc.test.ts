import { describe, expect, it } from "vitest";

import {
	assembleMiniAppSrcdoc,
	buildMiniAppCsp,
	escapeAttribute,
	escapeForScriptElement,
	extractBodyMarkup,
	MAX_BABEL_INPUT_BYTES,
	MAX_HTML_SHELL_BYTES,
	MINIAPP_CDN_HOST,
	MINIAPP_CDN_SCRIPTS,
	MiniAppSrcdocError,
	normalizeConnectHost,
	parseScriptSrcOrder,
	selectMiniAppUiFiles,
} from "./miniapp-srcdoc";

describe("escapeForScriptElement", () => {
	it("neutralizes a `</script>` so it cannot close the inlined script", () => {
		const out = escapeForScriptElement(
			'const x = "</script><img src=x onerror=alert(1)>";',
		);
		expect(out).not.toContain("</script>");
		expect(out).toContain("<\\/script>");
	});

	it("neutralizes `<!--` and `-->` comment sequences", () => {
		const out = escapeForScriptElement("a <!-- b --> c");
		expect(out).not.toMatch(/<!--/);
		expect(out).not.toMatch(/-->/);
	});

	it("is case-insensitive on the closing tag", () => {
		expect(escapeForScriptElement("</ScRiPt>")).not.toMatch(/<\/script>/i);
	});

	it("leaves ordinary JSX untouched (no spurious changes)", () => {
		const src = "const App = () => <div className='x'>{count}</div>;";
		expect(escapeForScriptElement(src)).toBe(src);
	});
});

describe("escapeAttribute", () => {
	it("escapes quotes and angle brackets", () => {
		expect(escapeAttribute('a"b<c>d&e')).toBe("a&quot;b&lt;c&gt;d&amp;e");
	});
});

describe("normalizeConnectHost", () => {
	it("accepts a bare host and host:port, pinning https", () => {
		expect(normalizeConnectHost("api.twitter.com")).toBe(
			"https://api.twitter.com",
		);
		expect(normalizeConnectHost("localhost:8080")).toBe(
			"https://localhost:8080",
		);
	});

	it("rejects schemes, paths, wildcards, and whitespace (fail-closed)", () => {
		expect(normalizeConnectHost("https://evil.com")).toBeNull();
		expect(normalizeConnectHost("evil.com/path")).toBeNull();
		expect(normalizeConnectHost("*.evil.com")).toBeNull();
		expect(normalizeConnectHost("a b")).toBeNull();
		expect(normalizeConnectHost("")).toBeNull();
	});
});

describe("buildMiniAppCsp", () => {
	it("pins script-src to the host CDN + unsafe-inline/eval, never the app's hosts", () => {
		const csp = buildMiniAppCsp(["https://api.twitter.com"]);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toMatch(
			new RegExp(
				`script-src[^;]*${MINIAPP_CDN_HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
			),
		);
		expect(csp).toContain("'unsafe-eval'");
		// The app's egress host appears in connect-src, NOT script-src.
		const scriptSrc =
			csp.split(";").find((p) => p.includes("script-src")) ?? "";
		expect(scriptSrc).not.toContain("api.twitter.com");
		const connectSrc =
			csp.split(";").find((p) => p.includes("connect-src")) ?? "";
		expect(connectSrc).toContain("https://api.twitter.com");
	});
});

describe("MINIAPP_CDN_SCRIPTS (host-fixed, SRI-pinned)", () => {
	it("are all https URLs on the single CDN host with sha384 SRI", () => {
		expect(MINIAPP_CDN_SCRIPTS.length).toBeGreaterThanOrEqual(3);
		for (const s of MINIAPP_CDN_SCRIPTS) {
			expect(s.src.startsWith(`${MINIAPP_CDN_HOST}/`)).toBe(true);
			expect(s.integrity.startsWith("sha384-")).toBe(true);
		}
	});

	it("pin React, ReactDOM, and @babel/standalone", () => {
		const srcs = MINIAPP_CDN_SCRIPTS.map((s) => s.src).join(" ");
		expect(srcs).toMatch(/react@/);
		expect(srcs).toMatch(/react-dom@/);
		expect(srcs).toMatch(/@babel\/standalone@/);
	});
});

describe("parseScriptSrcOrder", () => {
	it("returns script srcs in document order", () => {
		const html =
			'<body><script src="a.jsx"></script><script src="b.jsx"></script></body>';
		expect(parseScriptSrcOrder(html)).toEqual(["a.jsx", "b.jsx"]);
	});
});

describe("extractBodyMarkup", () => {
	it("returns inner body markup and strips author <script> tags", () => {
		const html =
			'<html><body><div id="root"></div><script src="app.jsx"></script><script>alert(1)</script></body></html>';
		const out = extractBodyMarkup(html);
		expect(out).toContain('<div id="root"></div>');
		expect(out).not.toContain("<script");
		expect(out).not.toContain("alert(1)");
	});

	it("treats a shell with no <body> as raw body markup", () => {
		expect(extractBodyMarkup('<div id="root"></div>')).toContain('id="root"');
	});
});

describe("selectMiniAppUiFiles", () => {
	it("orders jsx by the shell's <script src> order, appending the rest", () => {
		const result = selectMiniAppUiFiles([
			{
				relPath: "index.html",
				body: '<body><script src="a.jsx"></script><script src="b.jsx"></script></body>',
			},
			{ relPath: "a.jsx", body: "const a = 1;" },
			{ relPath: "b.jsx", body: "const b = 2;" },
			{ relPath: "c.jsx", body: "const c = 3;" }, // not declared → appended
			{ relPath: "server.ts", body: "export const manifest = {};" },
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.files.jsxFiles.map((f) => f.path)).toEqual([
			"a.jsx",
			"b.jsx",
			"c.jsx",
		]);
	});

	it("resolves a leading ./ in the shell's src", () => {
		const result = selectMiniAppUiFiles([
			{ relPath: "index.html", body: '<script src="./app.jsx"></script>' },
			{ relPath: "app.jsx", body: "const x = 1;" },
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.files.jsxFiles.map((f) => f.path)).toEqual(["app.jsx"]);
	});

	it("fails when there is no index.html", () => {
		const result = selectMiniAppUiFiles([
			{ relPath: "server.ts", body: "export const manifest = {};" },
		]);
		expect(result).toEqual({ ok: false, reason: "no-index-html" });
	});
});

describe("assembleMiniAppSrcdoc", () => {
	const baseInput = {
		appId: "social-scheduler",
		indexHtml:
			'<body><div id="root"></div><script src="app.jsx"></script></body>',
		jsxFiles: [
			{ path: "app.jsx", content: "const App = () => <div>hi</div>;" },
		],
		assets: [],
		connectHosts: ["jsonplaceholder.typicode.com"],
	};

	it("inlines the CDN scripts, the bridge, and the jsx as text/babel", () => {
		const doc = assembleMiniAppSrcdoc(baseInput);
		for (const s of MINIAPP_CDN_SCRIPTS) {
			expect(doc).toContain(s.src);
			expect(doc).toContain(s.integrity);
		}
		expect(doc).toContain('type="text/babel"');
		expect(doc).toContain('data-presets="env,react"');
		expect(doc).toContain("window.app");
		expect(doc).toContain("__miniapp_rpc");
		expect(doc).toContain("const App = () => <div>hi</div>;");
	});

	it("embeds a CSP <meta> with the app's connect-src", () => {
		const doc = assembleMiniAppSrcdoc(baseInput);
		expect(doc).toContain('http-equiv="Content-Security-Policy"');
		expect(doc).toContain("https://jsonplaceholder.typicode.com");
	});

	it("escapes a `</script>` smuggled inside the jsx", () => {
		const doc = assembleMiniAppSrcdoc({
			...baseInput,
			jsxFiles: [
				{
					path: "app.jsx",
					content: 'const x = "</script><script>steal()</script>";',
				},
			],
		});
		expect(doc).not.toContain("<script>steal()</script>");
		expect(doc).toContain("<\\/script>");
	});

	it("does NOT add the app's connect host to script-src", () => {
		const doc = assembleMiniAppSrcdoc({
			...baseInput,
			connectHosts: ["evil-cdn.example.com"],
		});
		const meta = doc.match(/content="([^"]*Content-Security[^"]*)"/) ?? [];
		// Pull the CSP string out of the meta content attribute.
		const cspMeta = doc.match(/Content-Security-Policy"\s+content="([^"]+)"/);
		expect(cspMeta).not.toBeNull();
		const csp = (cspMeta?.[1] ?? "").replace(/&quot;/g, '"');
		const scriptSrc =
			csp.split(";").find((p) => p.includes("script-src")) ?? "";
		expect(scriptSrc).not.toContain("evil-cdn.example.com");
		void meta;
	});

	it("throws when the total jsx exceeds the babel input cap", () => {
		const big = "x".repeat(MAX_BABEL_INPUT_BYTES + 1);
		expect(() =>
			assembleMiniAppSrcdoc({
				...baseInput,
				jsxFiles: [{ path: "app.jsx", content: big }],
			}),
		).toThrow(MiniAppSrcdocError);
	});

	it("throws when the index.html shell exceeds its cap", () => {
		const bigHtml = `<body>${"x".repeat(MAX_HTML_SHELL_BYTES + 1)}</body>`;
		expect(() =>
			assembleMiniAppSrcdoc({ ...baseInput, indexHtml: bigHtml }),
		).toThrow(MiniAppSrcdocError);
	});

	it("drops an invalid connect host but still assembles", () => {
		const doc = assembleMiniAppSrcdoc({
			...baseInput,
			connectHosts: ["https://has-scheme.com", "ok-host.com"],
		});
		const cspMeta = doc.match(/Content-Security-Policy"\s+content="([^"]+)"/);
		const csp = (cspMeta?.[1] ?? "").replace(/&quot;/g, '"');
		expect(csp).toContain("https://ok-host.com");
		expect(csp).not.toContain("has-scheme.com");
	});
});
