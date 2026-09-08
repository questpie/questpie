import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPeer } from "./tracer-peer";

const entry = await import(
	new URL("./dist/server/server.js", import.meta.url).href
);
const reports: unknown[] = [];
const peer = createPeer();
const phases = new Map<string, Record<string, unknown>>();
const received = Promise.withResolvers<Record<string, unknown>>();
const browserHeaders = {
	"user-agent":
		"Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0",
};
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === "/__fault-observer.js")
			return new Response("", {
				headers: { "content-type": "text/javascript" },
			});
		if (path === "/__report" && request.method === "POST") {
			const report: unknown = await request.json();
			reports.push(report);
			if (report && typeof report === "object" && "phase" in report) {
				if (report.phase === "browser-error")
					received.reject(
						new Error("Browser reported a hydration or execution error"),
					);
				else if (report.phase === "finite-before-ready") {
					phases.set(report.phase, report as Record<string, unknown>);
					peer.releaseDelayed();
				} else if (report.phase === "streamed-before-ready") {
					phases.set(report.phase, report as Record<string, unknown>);
					peer.releaseAsset();
				} else if (report.phase === "live-removed")
					received.resolve(report as Record<string, unknown>);
			}
			return new Response(null, { status: 204 });
		}
		if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(path))
			return new Response(
				Bun.file(new URL(`./dist/client${path}`, import.meta.url)),
			);
		if (path === "/favicon.ico") return new Response(null, { status: 204 });
		const external = await peer.handle(request);
		if (external) return external;
		const response: Response = await entry.default.fetch(request);
		if (new URL(request.url).searchParams.has("hold") && response.body)
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
		return response;
	},
});
let browser: ReturnType<typeof Bun.spawn> | undefined;
let profile: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
async function stopBrowser() {
	if (!browser || browser.exitCode !== null) return;
	browser.kill("SIGTERM");
	const escalation = setTimeout(() => browser?.kill("SIGKILL"), 2_000);
	try {
		await browser.exited;
	} finally {
		clearTimeout(escalation);
	}
}
try {
	const address = `http://127.0.0.1:${server.port}/`;
	const response = await fetch(address, { headers: browserHeaders });
	assert.equal(response.status, 200);
	const reader = response.body!.getReader();
	const first = await reader.read();
	const decoder = new TextDecoder();
	const firstHtml = decoder.decode(first.value, { stream: true });
	assert.ok(
		firstHtml.includes("Finite SSR task"),
		"Finite result missing from initial shell",
	);
	assert.ok(
		firstHtml.includes("stream-pending"),
		"Suspense shell was not streamed before its delayed Query",
	);
	assert.ok(
		!firstHtml.includes('<h2 id="streamed">'),
		"Delayed result unexpectedly present in initial shell",
	);
	let html = firstHtml;
	for (;;) {
		const chunk = await reader.read();
		if (chunk.done) break;
		html += decoder.decode(chunk.value, { stream: true });
	}
	html += decoder.decode();
	assert.ok(html.includes("Streamed SSR task"), "Streamed result missing");
	assert.ok(
		html.includes("2026-09-08T10:00:00.000Z"),
		"Serialized timestamp missing",
	);
	const secondHtml = await (
		await fetch(address, { headers: browserHeaders })
	).text();
	const seed = /seed:"([a-f0-9]{64})"/.exec(html)?.[1];
	const secondSeed = /seed:"([a-f0-9]{64})"/.exec(secondHtml)?.[1];
	assert.ok(
		seed && secondSeed,
		"Each SSR request must emit its identity bootstrap",
	);
	assert.notEqual(seed, secondSeed);
	assert.ok(
		[...html.matchAll(/dataUpdatedAt:(\d+)/g)].some(
			(match) => Number(match[1]) > Date.now() + 30_000,
		),
		"Hostile SSR snapshot must carry a future native timestamp",
	);
	profile = await mkdtemp(join(tmpdir(), "questpie-start-firefox-"));
	const launched = Bun.spawn(
		[
			"/usr/bin/firefox",
			"--headless",
			"--no-remote",
			"--profile",
			profile,
			`${address}?hold=1`,
		],
		{
			env: { ...process.env, MOZ_HEADLESS: "1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	browser = launched;
	const stdout = new Response(launched.stdout).text();
	const stderr = new Response(launched.stderr).text();
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`Firefox report timed out: ${JSON.stringify({ phases: [...phases.keys()], stats: peer.stats, opens: peer.opens.length })}`,
					),
				),
			45_000,
		);
	});
	const report = await Promise.race([received.promise, timeout]);
	const finite = phases.get("finite-before-ready")!;
	const streamed = phases.get("streamed-before-ready")!;
	assert.equal(finite.isDate, true);
	assert.equal(finite.title, "Finite SSR task");
	assert.equal(finite.ready, false);
	assert.equal(finite.streams, 0);
	assert.equal(streamed.isDate, true);
	assert.equal(streamed.clicked, true);
	assert.equal(streamed.iso, "2026-09-08T10:00:00.000Z");
	assert.equal(streamed.title, "Streamed SSR task");
	assert.equal(streamed.ready, false);
	assert.equal(streamed.streams, 0);
	assert.equal(report.browserCalls, 0);
	assert.equal(report.serverCalls, 1);
	assert.equal(report.cacheEntries, 2);
	assert.equal(report.ready, true);
	assert.equal(report.streams, 1);
	assert.equal(report.finiteText, "Task removed by Policy");
	assert.equal(report.duplicateText, "No visible task");
	assert.equal(report.streamedText, "Current live task");
	assert.equal(report.oldRowVisible, false);
	assert.equal(peer.stats.serverStreams, 0);
	assert.equal(peer.stats.browserStreams, 1);
	assert.equal(peer.stats.browserReads, 0);
	assert.equal(peer.stats.prematureStreams, 0);
	assert.equal(peer.stats.ssrComplete, true);
	assert.equal(peer.stats.assetReleased, true);
	assert.equal(peer.opens.length, 2);
	assert.equal(new Set(peer.opens).size, 2);
	await Bun.sleep(200);
	assert.equal(
		reports.some(
			(value) =>
				value &&
				typeof value === "object" &&
				"phase" in value &&
				value.phase === "browser-error",
		),
		false,
	);
	await stopBrowser();
	await Promise.all([stdout, stderr]);
	console.log(
		JSON.stringify({
			tracer: "actual-start-firefox",
			assertions: 37,
			ssrFinite: true,
			suspenseStreamed: true,
			requestIsolated: true,
			dateHydrated: true,
			browserCalls: report.browserCalls,
			interactive: true,
			liveHandover: true,
			clockSkew: true,
			sharedCarrier: true,
			nullReplacement: true,
		}),
	);
} finally {
	if (timer) clearTimeout(timer);
	await stopBrowser();
	server.stop(true);
	if (profile) await rm(profile, { recursive: true, force: true });
}
