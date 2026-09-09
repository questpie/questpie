// Runs only inside the installed tutorial, never against workspace application output.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import {
	createTutorialPeer,
	tutorialId,
	tutorialTime,
} from "./start-docs-peer";

const useBrowser = process.env.QUESTPIE_NATIVE_START_DOCS_BROWSER === "1";
const peer = createTutorialPeer();
const previousOrigin = process.env.QUESTPIE_API_ORIGIN;
let backend: ReturnType<typeof Bun.serve> | undefined;
let redirectTarget: ReturnType<typeof Bun.serve> | undefined;
let frontend: ReturnType<typeof Bun.serve> | undefined;
let browser: ReturnType<typeof Bun.spawn> | undefined;
let profile: string | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let received = Promise.withResolvers<{
	ok: boolean;
	path: string;
	failure?: string;
}>();
const interrupted = new AbortController();
const interrupt = () => {
	interrupted.abort();
	if (browser) received.reject(new Error("Tutorial runner interrupted"));
};
process.once("SIGTERM", interrupt);
let assertions = 0;
const syntheticCookie = `start-docs-session=${crypto.randomUUID()}`;
let forwardedCookies = 0;
let redirectRequests = 0;
let redirectBackend = false;
function check(condition: unknown, message: string): asserts condition {
	assertions++;
	assert.ok(condition, message);
}
function signalBrowser(signal: NodeJS.Signals) {
	if (!browser) return;
	try {
		process.kill(-browser.pid, signal);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
	}
}
async function stopBrowser() {
	if (!browser) return;
	signalBrowser("SIGTERM");
	const escalation = setTimeout(() => signalBrowser("SIGKILL"), 1000);
	try {
		await browser.exited;
	} finally {
		clearTimeout(escalation);
		signalBrowser("SIGKILL");
		browser = undefined;
		if (profile) await rm(profile, { force: true, recursive: true });
		profile = undefined;
	}
}
try {
	redirectTarget = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			redirectRequests++;
			return new Response(null, { status: 204 });
		},
	});
	backend = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			if (request.headers.get("cookie") === syntheticCookie) forwardedCookies++;
			if (redirectBackend) return Response.redirect(redirectTarget!.url.href);
			return (
				(await peer.handle(request, "server")) ??
				new Response(null, { status: 404 })
			);
		},
	});
	process.env.QUESTPIE_API_ORIGIN = backend.url.origin;
	const entry = await import(
		new URL("./dist/server/server.js", import.meta.url).href
	);
	let observer = "";
	if (useBrowser) {
		const built = await Bun.build({
			entrypoints: ["./start-docs-observer.ts"],
			target: "browser",
		});
		check(built.success, "Tutorial observer failed to build");
		observer = await built.outputs[0]!.text();
	}
	frontend = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/__observer.js")
				return new Response(observer, {
					headers: { "content-type": "text/javascript" },
				});
			if (path === "/__report") {
				received.resolve(await request.json());
				return new Response(null, { status: 204 });
			}
			if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(path))
				return new Response(
					Bun.file(join(import.meta.dir, "dist/client", path)),
				);
			if (path === "/favicon.ico") return new Response(null, { status: 204 });
			const operation = await peer.handle(request, "browser");
			if (operation) return operation;
			const response: Response = await entry.default.fetch(request);
			if (
				!useBrowser ||
				!response.headers.get("content-type")?.includes("text/html")
			)
				return response;
			// Serve an external read-only observer without changing any public source fence.
			// This complete-document probe does not claim streamed-shell timing coverage.
			const html = (await response.text()).replace(
				"<head>",
				'<head><script src="/__observer.js"></script>',
			);
			const headers = new Headers(response.headers);
			headers.delete("content-length");
			return new Response(html, { headers, status: response.status });
		},
	});
	const url = (path: string) =>
		new URL(
			`${path}?tenantId=${tutorialId}&ticketId=${tutorialId}`,
			frontend!.url,
		).href;
	for (const path of ["/", "/pages"]) {
		const response = await fetch(url(path), {
			signal: AbortSignal.any([
				AbortSignal.timeout(15_000),
				interrupted.signal,
			]),
			headers: {
				"user-agent": "Mozilla/5.0 Firefox/142.0",
				cookie: syntheticCookie,
			},
		});
		check(response.status === 200, `Tutorial SSR failed for ${path}`);
		const html = await response.text();
		check(
			!html.includes(syntheticCookie),
			"SSR serialized the incoming credential",
		);
		check(
			html.includes("<h1>Server-rendered support ticket</h1>"),
			`Tutorial SSR heading missing for ${path}`,
		);
		if (path === "/")
			check(
				html.includes(`dateTime="${tutorialTime}"`) ||
					html.includes(`datetime="${tutorialTime}"`),
				"SSR Date not rendered",
			);
	}
	check(peer.stats.serverReads >= 2, "SSR did not execute the generated Query");
	check(
		forwardedCookies >= 2,
		"SSR did not forward the request credential to its configured origin",
	);
	check(
		peer.stats.serverStreams === 0 && peer.stats.browserStreams === 0,
		"SSR opened a live carrier",
	);
	redirectBackend = true;
	try {
		const rejected = await fetch(url("/"), {
			signal: AbortSignal.any([
				AbortSignal.timeout(15_000),
				interrupted.signal,
			]),
			headers: {
				"user-agent": "Mozilla/5.0 Firefox/142.0",
				cookie: syntheticCookie,
			},
		});
		check(
			rejected.status >= 400,
			"Backend redirect was accepted by credentialed SSR",
		);
		await rejected.body?.cancel();
		check(
			redirectRequests === 0,
			"SSR followed a redirect from the trusted credential destination",
		);
	} finally {
		redirectBackend = false;
	}
	if (useBrowser) {
		for (const path of ["/", "/pages", "/test-cleanup"]) {
			interrupted.signal.throwIfAborted();
			peer.close();
			received = Promise.withResolvers();
			const streamsBefore: number = peer.stats.browserStreams;
			profile = await mkdtemp(join(import.meta.dir, "start-docs-firefox-"));
			interrupted.signal.throwIfAborted();
			browser = Bun.spawn(
				[
					process.env.FIREFOX_BIN ?? "/usr/bin/firefox",
					"--headless",
					"--no-remote",
					"--profile",
					profile,
					url(path),
				],
				{
					detached: true,
					stdin: "ignore",
					stdout: "ignore",
					stderr: "ignore",
					env: { ...process.env, MOZ_HEADLESS: "1" },
				},
			);
			deadline = setTimeout(
				() =>
					received.reject(new Error(`Tutorial Firefox timed out for ${path}`)),
				20_000,
			);
			const report = await received.promise;
			clearTimeout(deadline);
			check(
				report.ok && report.path === path,
				report.failure ?? `Tutorial hydration/browser failed for ${path}`,
			);
			if (path === "/pages")
				check(
					peer.stats.browserStreams === streamsBefore,
					"Infinite page opened a live carrier",
				);
			else
				check(
					peer.stats.browserStreams > streamsBefore,
					"Live Query did not start after hydration",
				);
			if (path === "/test-cleanup") {
				check(
					peer.bindings.size === 0,
					"Documented owner disposal retained a live binding",
				);
				check(
					peer.stats.closes > 0,
					"Disposal did not issue the generated close command",
				);
			}
			await stopBrowser();
		}
	}
	interrupted.signal.throwIfAborted();
	console.log(
		JSON.stringify({
			scenario: useBrowser
				? "packed-start-docs-firefox"
				: "packed-start-docs-ssr",
			ssr: true,
			browser: useBrowser,
			assertions,
		}),
	);
} finally {
	process.removeListener("SIGTERM", interrupt);
	clearTimeout(deadline);
	try {
		await stopBrowser();
	} finally {
		peer.close();
		await frontend?.stop(true);
		await backend?.stop(true);
		await redirectTarget?.stop(true);
		if (profile) await rm(profile, { force: true, recursive: true });
		if (previousOrigin === undefined) delete process.env.QUESTPIE_API_ORIGIN;
		else process.env.QUESTPIE_API_ORIGIN = previousOrigin;
	}
}
