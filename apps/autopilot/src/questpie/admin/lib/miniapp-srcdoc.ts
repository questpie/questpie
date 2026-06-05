/**
 * Mini-app `srcdoc` ASSEMBLY — the security-critical core of the KnowledgeHost.
 *
 * `.private/miniapps-v2-design.md` ★ RESOLVED (origin = `srcdoc`/null) + §5 + §6.
 *
 * For a `kind:"miniapp"` `.app` bundle, the KnowledgeHost INLINES the bundle's
 * `index.html` + `*.jsx` + React/ReactDOM/`@babel/standalone` (host-fixed,
 * SRI-pinned CDN) + the `window.app` bridge into ONE HTML document that is handed
 * to an `<iframe sandbox="allow-scripts" srcdoc>` — NEVER `allow-same-origin`
 * (the frame must not be able to strip its own sandbox / reach admin DOM/cookies).
 * There is NO serving route → the Content-Type-allowlist + path-traversal surface
 * of a served origin does not exist.
 *
 * THIS MODULE IS PURE (no React, no DOM, no fetch) so the escaping, the CDN
 * allowlist, the CSP, and the size cap are unit-tested as plain string logic.
 *
 * The hard invariants this assembler enforces (each has a test):
 *   1. The iframe `script-src` is a HOST-FIXED, SRI-PINNED CDN allowlist
 *      ({@link MINIAPP_CDN_SCRIPTS}). An AI-authored manifest CANNOT add a script
 *      host — `connect-src` (the app's data egress) is separate and derives from
 *      `manifest.net`; the two are never conflated.
 *   2. Every untrusted file's content is inlined into a `<script>`/`<style>` in a
 *      way that CANNOT break out of that element ({@link escapeForScriptElement} /
 *      {@link escapeForStyleElement}) — a `</script>` inside the JSX cannot inject
 *      markup into the host document.
 *   3. The TOTAL babel input (all `*.jsx` bytes) is CAPPED — babel-standalone is a
 *      heavy transpiler and attacker JSX is a client-side DoS vector.
 *   4. CSP is delivered via a `<meta http-equiv>` inside the srcdoc (a null-origin
 *      document has no response headers to carry it).
 */

/** A host-fixed, SRI-pinned CDN script (React/ReactDOM/@babel/standalone). */
export interface MiniAppCdnScript {
	/** Absolute https URL. The host part is the ONLY thing allowed in `script-src`. */
	readonly src: string;
	/** Subresource-integrity hash (`sha384-…`) — the browser rejects a tampered file. */
	readonly integrity: string;
}

/**
 * The host-controlled runtime-library CDN allowlist. Mirrors the cloud-dashboard
 * prototype's stack (React 18.3.1 + ReactDOM 18.3.1 + `@babel/standalone@7.29.0`)
 * but pins the PRODUCTION builds with real SRI hashes. This list is the ENTIRE
 * `script-src` network allowlist — a mini-app cannot extend it.
 *
 * SRI hashes computed from the unpkg-served files at these exact versions; the
 * `@babel/standalone` hash matches the prototype's pin verbatim.
 */
export const MINIAPP_CDN_SCRIPTS: readonly MiniAppCdnScript[] = [
	{
		src: "https://unpkg.com/react@18.3.1/umd/react.production.min.js",
		integrity:
			"sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z",
	},
	{
		src: "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js",
		integrity:
			"sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1",
	},
	{
		src: "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js",
		integrity:
			"sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y",
	},
];

/** The single CDN host every allowlisted script is served from. */
export const MINIAPP_CDN_HOST = "https://unpkg.com";

/**
 * Hard cap on the TOTAL transpiled-input size (sum of all `*.jsx` byte lengths).
 * babel-standalone runs in-frame; this bounds the client-side DoS surface (the
 * per-file bundle caps in the server-side parser further bound each file).
 */
export const MAX_BABEL_INPUT_BYTES = 512 * 1024;

/** Hard cap on the inlined `index.html` shell size. */
export const MAX_HTML_SHELL_BYTES = 256 * 1024;

/** A virtual file from the `.app` bundle, addressed by its bundle-relative path. */
export interface MiniAppFile {
	/** Bundle-relative path (e.g. `index.html`, `app.jsx`, `ui/panel.jsx`). */
	path: string;
	/** Text content. */
	content: string;
}

/** Inputs to {@link assembleMiniAppSrcdoc}. */
export interface AssembleSrcdocInput {
	/** The app id (for diagnostics in the assembled doc + the bridge config). */
	appId: string;
	/** The bundle's `index.html` shell (already extracted from the `.app` rows). */
	indexHtml: string;
	/**
	 * The bundle's `*.jsx` files, in the ORDER they must load (dependency order —
	 * the `index.html`'s `<script src="…">` order, resolved by the caller). Each is
	 * inlined as a `<script type="text/babel" data-presets="env,react">`.
	 */
	jsxFiles: MiniAppFile[];
	/**
	 * Additional non-jsx text assets to inline by extension (css → `<style>`). Other
	 * extensions are ignored (binaries are out of scope for the srcdoc host).
	 */
	assets?: MiniAppFile[];
	/**
	 * The app's runtime `fetch` egress hosts (`manifest.capabilities.net`). These
	 * become the iframe's CSP `connect-src` — the app's OWN data egress, NEVER the
	 * `script-src`. Omitted/empty → the app may not `fetch` anything directly (it
	 * still reaches the backend via the postMessage bridge, which CSP does not gate).
	 */
	connectHosts?: string[];
}

/** A resolved `.app` bundle row (path relative to the bundle root + its body). */
export interface MiniAppBundleEntry {
	/** Path RELATIVE to the `.app` bundle root (e.g. `index.html`, `app.jsx`). */
	relPath: string;
	/** Text body. */
	body: string;
}

/** The UI files the assembler needs, picked + ordered from a `.app` bundle. */
export interface MiniAppUiFiles {
	indexHtml: string;
	jsxFiles: MiniAppFile[];
	assets: MiniAppFile[];
}

/** Result of {@link selectMiniAppUiFiles}: the UI files, or why none could be built. */
export type SelectUiFilesResult =
	| { ok: true; files: MiniAppUiFiles }
	| { ok: false; reason: "no-index-html" };

/**
 * From a `.app` bundle's entries, pick `index.html` + the `*.jsx` files in the
 * LOAD ORDER the shell declares (the `<script ... src="x.jsx">` order), plus css
 * assets. The shell's declared order is the dependency order the §6 no-build
 * convention relies on (later files reference earlier files via window globals).
 *
 * Falls back to: jsx files in the bundle in path-sorted order when the shell
 * declares none (a single `app.jsx` is the common case). Requires an `index.html`
 * — a `kind:"miniapp"` bundle WITHOUT one has no UI to host (the caller renders a
 * "no UI" state).
 */
export function selectMiniAppUiFiles(
	entries: MiniAppBundleEntry[],
): SelectUiFilesResult {
	const byPath = new Map<string, string>();
	for (const e of entries) byPath.set(e.relPath, e.body);

	const indexHtml = byPath.get("index.html");
	if (indexHtml === undefined) return { ok: false, reason: "no-index-html" };

	const allJsx = entries
		.filter((e) => /\.jsx$/i.test(e.relPath))
		.map((e) => e.relPath)
		.sort();

	// Parse the shell's `<script src="...">` order to sequence the jsx files.
	const declared = parseScriptSrcOrder(indexHtml).filter((src) =>
		/\.jsx$/i.test(src),
	);
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const src of declared) {
		// Normalize a leading `./`; resolve only files that actually exist.
		const norm = src.replace(/^\.\//, "");
		if (byPath.has(norm) && !seen.has(norm)) {
			seen.add(norm);
			ordered.push(norm);
		}
	}
	// Append any jsx file the shell did not declare (path-sorted), so nothing is
	// silently dropped.
	for (const p of allJsx) {
		if (!seen.has(p)) {
			seen.add(p);
			ordered.push(p);
		}
	}

	const jsxFiles: MiniAppFile[] = ordered.map((p) => ({
		path: p,
		content: byPath.get(p) ?? "",
	}));
	const assets: MiniAppFile[] = entries
		.filter((e) => /\.css$/i.test(e.relPath))
		.map((e) => ({ path: e.relPath, content: e.body }));

	return { ok: true, files: { indexHtml, jsxFiles, assets } };
}

/** Extract the ordered `src` values of `<script src="…">` tags in an HTML shell. */
export function parseScriptSrcOrder(html: string): string[] {
	const out: string[] = [];
	const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) out.push(m[1]);
	return out;
}

/** Byte length of a UTF-8 string (Node + browser both have TextEncoder). */
function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

/** Error thrown when assembly inputs violate a hard invariant (size, etc.). */
export class MiniAppSrcdocError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MiniAppSrcdocError";
	}
}

/**
 * Escape text so it can be inlined inside a `<script>` element without ANY chance
 * of closing the element or opening a comment/CDATA that an HTML parser would act
 * on. The HTML spec terminates a script element's "raw text" on the case-insensitive
 * sequence `</script`; it also treats `<!--` specially. We neutralize the `<` of
 * any `</script`, `<script`, and `<!--`/`-->` by inserting a backslash before `/`
 * or `!` — which is a NO-OP inside JS string/regex/JSX text (a `<\/script>` in JS
 * is identical to `<\/script>`), so the transpiled program is unchanged while the
 * HTML parser never sees a real closing tag.
 *
 * This is the standard "escape `</script>` for inline JSON/JS" technique, widened
 * to the few sequences the HTML tokenizer reacts to inside a script element.
 */
export function escapeForScriptElement(text: string): string {
	return text
		.replace(/<\/(script)/gi, "<\\/$1")
		.replace(/<!(--)/g, "<\\!$1")
		.replace(/(--)>/g, "$1\\>");
}

/** Escape text for inlining inside a `<style>` element (terminates on `</style`). */
export function escapeForStyleElement(text: string): string {
	return text.replace(/<\/(style)/gi, "<\\/$1");
}

/**
 * Escape a string for use inside a double-quoted HTML attribute value.
 * (Used for the CSP meta content and the bridge config attribute.)
 */
export function escapeAttribute(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Validate + normalize a `manifest.net` host into a CSP `connect-src` source.
 * Accepts a bare `host` or `host:port`; rejects anything with a scheme, path,
 * wildcard, or whitespace (those would widen the policy unexpectedly). Returns
 * `null` for a rejected value so the caller drops it (fail-closed per host).
 */
export function normalizeConnectHost(host: string): string | null {
	if (typeof host !== "string") return null;
	const trimmed = host.trim();
	if (trimmed.length === 0) return null;
	// host or host:port — letters/digits/dots/hyphens, optional :digits.
	if (!/^[a-z0-9.-]+(:[0-9]+)?$/i.test(trimmed)) return null;
	// CSP host-source — pin https scheme so a downgraded http egress is not allowed.
	return `https://${trimmed}`;
}

/**
 * Build the CSP policy string for the srcdoc document.
 *
 * - `default-src 'none'` — deny by default.
 * - `script-src` — ONLY the host-fixed CDN host + `'unsafe-inline'` (the inline
 *   bootstrap + the `text/babel` blocks) + `'unsafe-eval'` (babel-standalone
 *   compiles via `new Function`). The app cannot add a host here.
 * - `connect-src` — the app's own `manifest.net` egress (validated), nothing else.
 * - `style-src 'unsafe-inline'` — inline `<style>` + React inline styles.
 * - `img-src data: https:` — let UIs show images without a per-host list.
 * - everything else stays `'none'`.
 */
export function buildMiniAppCsp(connectSources: string[]): string {
	const scriptSrc = [
		"'self'",
		MINIAPP_CDN_HOST,
		"'unsafe-inline'",
		"'unsafe-eval'",
	];
	const connectSrc = ["'self'", ...connectSources];
	return [
		"default-src 'none'",
		`script-src ${scriptSrc.join(" ")}`,
		`style-src 'self' 'unsafe-inline'`,
		`img-src 'self' data: https:`,
		`font-src 'self' data: https:`,
		`connect-src ${connectSrc.join(" ")}`,
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
}

/** Render the host-fixed CDN `<script>` tags (SRI-pinned, crossorigin). */
function renderCdnScripts(): string {
	return MINIAPP_CDN_SCRIPTS.map(
		(s) =>
			`<script src="${escapeAttribute(s.src)}" integrity="${escapeAttribute(
				s.integrity,
			)}" crossorigin="anonymous"></script>`,
	).join("\n");
}

/**
 * The parent↔frame bridge bootstrap injected into the frame (§3.3). It defines
 * `window.app` as a Proxy whose every property access (`window.app.<action>`)
 * returns a function that postMessages an RPC to the parent and resolves with the
 * parent's reply. `window.app.fs.read/write(path)` map to the fs pseudo-actions.
 *
 * SECRETS NEVER LIVE HERE — the frame only postMessages; the PARENT attaches the
 * `x-miniapp-token` and performs the fetch. The bridge tags each request with a
 * monotonic id and the app id, and only accepts replies whose `event.source` is
 * `window.parent` (a frame cannot be tricked into trusting a sibling).
 */
function renderBridgeBootstrap(appId: string): string {
	// `appId` is a validated slug (APP_ID_RE) but JSON-encode defensively.
	const appIdLiteral = JSON.stringify(appId);
	// NOTE: kept dependency-free + tiny. It is INLINE (covered by 'unsafe-inline').
	return `<script>
(function () {
  var APP_ID = ${appIdLiteral};
  var seq = 0;
  var pending = Object.create(null);

  // Only accept replies from the parent window (never a sibling/opener).
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.__miniapp_reply !== true) return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.error) {
      entry.reject(new Error(String(data.error)));
    } else {
      entry.resolve(data.result);
    }
  });

  function call(action, input) {
    var id = APP_ID + ":" + ++seq;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage(
        { __miniapp_rpc: true, id: id, app: APP_ID, action: action, input: input },
        "*"
      );
    });
  }

  var fs = {
    read: function (path) { return call("fs:read", { path: path }); },
    write: function (path, body) { return call("fs:write", { path: path, body: body }); },
    list: function (path) { return call("fs:read", { path: path, list: true }); }
  };

  var app = new Proxy(
    { fs: fs },
    {
      get: function (target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== "string") return undefined;
        return function (input) { return call(prop, input); };
      }
    }
  );

  window.app = app;
})();
</script>`;
}

/**
 * Assemble the full `srcdoc` HTML for a mini-app bundle.
 *
 * @throws {MiniAppSrcdocError} when the shell or the total JSX exceeds the caps.
 */
export function assembleMiniAppSrcdoc(input: AssembleSrcdocInput): string {
	const shellBytes = byteLength(input.indexHtml);
	if (shellBytes > MAX_HTML_SHELL_BYTES) {
		throw new MiniAppSrcdocError(
			`mini-app "${input.appId}" index.html is ${shellBytes} bytes (cap ${MAX_HTML_SHELL_BYTES})`,
		);
	}

	let babelBytes = 0;
	for (const f of input.jsxFiles) babelBytes += byteLength(f.content);
	if (babelBytes > MAX_BABEL_INPUT_BYTES) {
		throw new MiniAppSrcdocError(
			`mini-app "${input.appId}" total JSX is ${babelBytes} bytes (cap ${MAX_BABEL_INPUT_BYTES})`,
		);
	}

	// connect-src from manifest.net (validated per host; rejected hosts dropped).
	const connectSources: string[] = [];
	for (const host of input.connectHosts ?? []) {
		const normalized = normalizeConnectHost(host);
		if (normalized) connectSources.push(normalized);
	}
	const csp = buildMiniAppCsp(connectSources);

	// Inline `*.jsx` as text/babel scripts (env+react presets, no ES imports — §6).
	const jsxScripts = input.jsxFiles
		.map(
			(f) =>
				`<script type="text/babel" data-presets="env,react" data-miniapp-file="${escapeAttribute(
					f.path,
				)}">\n${escapeForScriptElement(f.content)}\n</script>`,
		)
		.join("\n");

	// Inline css assets as <style>.
	const styleBlocks = (input.assets ?? [])
		.filter((a) => /\.css$/i.test(a.path))
		.map(
			(a) =>
				`<style data-miniapp-file="${escapeAttribute(
					a.path,
				)}">\n${escapeForStyleElement(a.content)}\n</style>`,
		)
		.join("\n");

	// Build the document. We do NOT echo the bundle's own <!doctype>/<html> wrapper
	// (the index.html shell's BODY markup is inlined into our controlled shell), so
	// the CSP <meta> and the load order are host-controlled, not author-controlled.
	const bodyMarkup = extractBodyMarkup(input.indexHtml);

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${styleBlocks}
</head>
<body>
${bodyMarkup}
${renderCdnScripts()}
${renderBridgeBootstrap(input.appId)}
${jsxScripts}
</body>
</html>`;
}

/**
 * Extract the inner BODY markup from a bundle `index.html`. If the html has a
 * `<body>…</body>`, return its inner HTML; otherwise treat the whole string as
 * body markup. We strip any `<script>` tags the author put in the shell — UI
 * scripts MUST be `*.jsx` files (loaded as `text/babel`, host-ordered); an inline
 * `<script>` in the shell is dropped so it cannot bypass the babel pipeline or the
 * load order. (A `<script src>` to the host CDN list is re-added by the assembler.)
 */
export function extractBodyMarkup(indexHtml: string): string {
	const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	const inner = bodyMatch ? bodyMatch[1] : indexHtml;
	// Drop ALL <script>…</script> blocks and self-referencing script srcs from the
	// shell — scripts come from the host CDN list + the bundle's *.jsx only.
	return inner
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<script[^>]*\/>/gi, "");
}
