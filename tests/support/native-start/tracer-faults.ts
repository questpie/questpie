import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPeer } from "./tracer-peer";

const entry = await import(
	new URL("./dist/server/server.js", import.meta.url).href
);
const observer = `
const scenario = new URL(location.href).searchParams.get("fault");
if (scenario) {
 let errors = 0;
 let loaded = false;
 let reported = false;
 addEventListener("error", () => errors++, true);
 addEventListener("unhandledrejection", () => errors++);
 const observe = () => { if (reported) return; reported = true; return fetch("/__report", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({phase: "fault-observed", scenario, errors, loaded,
   finite: document.querySelector("#finite")?.textContent ?? null,
   streamed: document.querySelector("#streamed")?.textContent ?? null,
   pending: !!document.querySelector("#stream-pending"),
   left: !!document.querySelector("#left"), state: document.readyState})
 }); };
 addEventListener("load", () => {loaded = true; setTimeout(observe, 800);}, {once: true});
 setTimeout(observe, 2500);
}
`;

for (const scenario of [
	"truncate",
	"disconnect",
	"module-failure",
	"navigate",
] as const) {
	if (process.argv[2] && process.argv[2] !== scenario) continue;
	const peer = createPeer();
	const received = Promise.withResolvers<Record<string, unknown>>();
	const reports: string[] = [];
	let cut: (() => void) | undefined;
	let browser: ReturnType<typeof Bun.spawn> | undefined;
	let profile: string | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 30,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/__fault-observer.js")
				return new Response(observer, {
					headers: { "content-type": "text/javascript" },
				});
			if (url.pathname === "/__report") {
				const report = await request.json();
				reports.push(report.phase);
				if (
					report.phase === "finite-before-ready" &&
					(scenario === "truncate" || scenario === "disconnect")
				) {
					peer.releaseAsset();
					cut?.();
				}
				if (report.phase === "left-mounted") {
					peer.releaseDelayed();
					peer.releaseAsset();
				}
				if (report.phase === "fault-observed") received.resolve(report);
				return new Response(null, { status: 204 });
			}
			if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname)) {
				if (scenario === "module-failure")
					return new Response("Unavailable", { status: 503 });
				return new Response(
					Bun.file(new URL(`./dist/client${url.pathname}`, import.meta.url)),
				);
			}
			if (url.pathname === "/favicon.ico")
				return new Response(null, { status: 204 });
			const external = await peer.handle(request);
			if (external) return external;
			const response: Response = await entry.default.fetch(request);
			if (!response.body || url.pathname !== "/") return response;
			if (scenario !== "truncate" && scenario !== "disconnect")
				return new Response(
					response.body.pipeThrough(
						new TransformStream({
							flush() {
								peer.stats.ssrComplete = true;
							},
						}),
					),
					{ status: response.status, headers: response.headers },
				);
			const reader = response.body.getReader();
			return new Response(
				new ReadableStream({
					async start(controller) {
						const first = await reader.read();
						if (!first.done) controller.enqueue(first.value);
						cut = () => {
							if (scenario === "disconnect")
								controller.error(new Error("TEST_SSR_CONNECTION_INTERRUPTED"));
							else controller.close();
							peer.releaseDelayed();
							void reader.cancel().catch(() => {});
						};
					},
					cancel() {
						void reader.cancel().catch(() => {});
					},
				}),
				{ status: response.status, headers: response.headers },
			);
		},
	});
	try {
		if (scenario === "module-failure") {
			peer.releaseDelayed();
			peer.releaseAsset();
		}
		profile = await mkdtemp(join(tmpdir(), "questpie-start-fault-firefox-"));
		const launched = Bun.spawn(
			[
				"/usr/bin/firefox",
				"--headless",
				"--no-remote",
				"--profile",
				profile,
				`http://127.0.0.1:${server.port}/?hold=1&fault=${scenario}`,
			],
			{
				env: { ...process.env, MOZ_HEADLESS: "1" },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		browser = launched;
		const output = [
			new Response(launched.stdout).text(),
			new Response(launched.stderr).text(),
		];
		const report = await Promise.race([
			received.promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new Error(
								`Fault tracer timeout: ${JSON.stringify({ scenario, reports, stats: peer.stats })}`,
							),
						),
					15_000,
				);
			}),
		]);
		assert.equal(report.state, "complete");
		assert.equal(report.loaded, true);
		assert.equal(peer.stats.serverStreams, 0);
		assert.equal(peer.stats.browserReads, 0);
		if (scenario === "truncate" || scenario === "disconnect") {
			assert.equal(peer.stats.ssrComplete, false);
			assert.equal(peer.stats.browserStreams, 1);
			assert.equal(report.finite, "Task removed by Policy");
			assert.equal(report.streamed, "Current live task");
			assert.equal(report.pending, false);
			assert.equal(report.errors, 0);
			assert.equal(peer.activeBindings.size, 2);
			assert.ok(reports.includes("finite-before-ready"));
		}
		if (scenario === "module-failure") {
			assert.equal(peer.stats.browserStreams, 0);
			assert.ok(Number(report.errors) > 0);
			assert.equal(report.finite, "Finite SSR task");
			assert.equal(report.streamed, "Streamed SSR task");
			assert.equal(peer.activeBindings.size, 0);
			assert.equal(reports.includes("finite-before-ready"), false);
		}
		if (scenario === "navigate") {
			assert.equal(peer.activeBindings.size, 0);
			assert.equal(report.left, true);
			assert.equal(report.finite, null);
			assert.equal(report.streamed, null);
			assert.deepEqual(peer.opens, ["018f5f6e-5f2c-7b41-a854-3d9a6b6b7132"]);
			assert.equal(peer.closes.length, 1);
			assert.equal(report.errors, 0);
		}
		console.log(
			JSON.stringify({
				tracer: "actual-start-fault",
				scenario,
				report,
				stats: peer.stats,
				reports,
				opens: peer.opens.length,
				closes: peer.closes.length,
				active: peer.activeBindings.size,
			}),
		);
		browser.kill("SIGTERM");
		const escalation = setTimeout(() => browser?.kill("SIGKILL"), 2_000);
		try {
			await browser.exited;
		} finally {
			clearTimeout(escalation);
		}
		await Promise.all(output);
	} finally {
		if (timer) clearTimeout(timer);
		peer.releaseDelayed();
		peer.releaseAsset();
		if (browser && browser.exitCode === null) {
			browser.kill("SIGKILL");
			await browser.exited;
		}
		server.stop(true);
		if (profile) await rm(profile, { recursive: true, force: true });
	}
}
