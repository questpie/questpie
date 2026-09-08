import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GeneratedClientScope } from "#questpie/client";

import type { GeneratedClientScope as OrdinaryScope } from "./ordinary/ordinary-client";
import { createPeer, ticketDetail, ticketResult } from "./tracer-peer";

const entry = await import(
	new URL("./dist/server/server.js", import.meta.url).href
);
const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const time = "2026-09-08T10:00:00.000Z";

for (const scenario of ["resume", "cancel", "retire"] as const) {
	const peer = createPeer({
		result: () => ticketDetail(id, "Current live ticket"),
	});
	const calls = {
		ordinaryServer: 0,
		infiniteServer: 0,
		ordinaryBrowser: 0,
		infiniteBrowser: 0,
	};
	const cursors: string[] = [];
	const completion = Promise.withResolvers<Record<string, unknown>>();
	let held = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const path = url.pathname;
			if (path === "/__fault-observer.js")
				return new Response("", {
					headers: { "content-type": "text/javascript" },
				});
			if (path === "/favicon.ico") return new Response(null, { status: 204 });
			if (path === "/__report") {
				const report = (await request.json()) as Record<string, unknown>;
				try {
					if (report.phase === "browser-error")
						throw new Error("Browser execution or hydration failed");
					if (report.phase === "modes-held") {
						assert.equal(report.ready, false);
						assert.equal(report.ordinaryDate, true);
						assert.equal(report.infiniteDate, true);
						assert.equal(report.ordinaryPending, true);
						assert.equal(report.infinitePending, true);
						assert.equal(report.livePending, true);
						assert.equal(calls.ordinaryBrowser, 0);
						assert.equal(calls.infiniteBrowser, 0);
						assert.equal(peer.stats.browserStreams, 0);
						held = true;
						peer.releaseAsset();
					}
					if (report.phase === "modes-final") completion.resolve(report);
				} catch (error) {
					completion.reject(error);
					peer.releaseAsset();
				}
				return new Response(null, { status: 204 });
			}
			if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(path))
				return new Response(
					Bun.file(new URL(`./dist/client${path}`, import.meta.url)),
				);
			if (
				path === "/_questpie/query/tasks.summary" ||
				path === "/_questpie/query/tickets.queue"
			) {
				const ssr = request.headers.get("x-proof-side") === "server";
				const ordinary = path.endsWith("tasks.summary");
				if (ordinary) calls[ssr ? "ordinaryServer" : "ordinaryBrowser"]++;
				else calls[ssr ? "infiniteServer" : "infiniteBrowser"]++;
				if (!ssr)
					assert.equal(
						peer.stats.assetReleased,
						true,
						"One-shot work bypassed readiness",
					);
				let result:
					| Awaited<ReturnType<OrdinaryScope["queries"]["tasks.summary"]>>
					| Awaited<
							ReturnType<GeneratedClientScope["queries"]["tickets.queue"]>
					  > = { id, title: "Ordinary HTTP task", updatedAt: new Date(time) };
				if (!ordinary) {
					const cursor = url.searchParams.get("after")!;
					if (!ssr) cursors.push(cursor);
					const page = ["~null", "cursor-1", "cursor-2"].indexOf(cursor) + 1;
					assert.ok(page > 0, "Unexpected page cursor");
					const ticket = ticketResult(
						id,
						`${ssr ? "SSR" : "Current"} page ${page}`,
					);
					result = {
						nodes: [
							{
								id: ticket.id,
								organizationId: ticket.organizationId,
								teamId: ticket.teamId,
								requesterMembershipId: ticket.requesterMembershipId,
								assigneeMembershipId: null,
								reference: `PAGE-${page}`,
								priority: "normal",
								status: "open",
								summary: ticket.summary,
								updatedAt: ticket.updatedAt,
								team: null,
								assignee: null,
							},
						],
						pageInfo: { endCursor: `cursor-${page}`, hasNextPage: page < 3 },
					};
				}
				return Response.json(
					{
						callId: decodeURIComponent(
							request.headers.get("Questpie-Call-Id")!,
						),
						result,
					},
					{ headers: { "content-type": "application/json; charset=utf-8" } },
				);
			}
			const response = await peer.handle(request);
			if (response) return response;
			const rendered: Response = await entry.default.fetch(request);
			return rendered.body
				? new Response(
						rendered.body.pipeThrough(
							new TransformStream({
								flush() {
									peer.stats.ssrComplete = true;
								},
							}),
						),
						{ status: rendered.status, headers: rendered.headers },
					)
				: rendered;
		},
	});
	let profile: string | undefined;
	let browser: ReturnType<typeof Bun.spawn> | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	try {
		const url = `http://127.0.0.1:${server.port}/execution-modes?scenario=${scenario}`;
		// An absent production route is a failing consumer, not a passing empty browser run.
		const response = await fetch(url, {
			headers: { "user-agent": "Mozilla/5.0 Firefox/142.0" },
		});
		assert.equal(response.status, 200);
		const html = await response.text();
		assert.ok(html.includes("SSR page 1"));
		assert.ok(html.includes(time));
		// The probe must not certify completion of Firefox's separate document.
		peer.stats.ssrComplete = false;
		profile = await mkdtemp(
			join(tmpdir(), "questpie-native-readiness-firefox-"),
		);
		browser = Bun.spawn(
			[
				"/usr/bin/firefox",
				"--headless",
				"--no-remote",
				"--profile",
				profile,
				url,
			],
			{
				env: { ...process.env, MOZ_HEADLESS: "1" },
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			},
		);
		deadline = setTimeout(
			() => completion.reject(new Error(`Readiness ${scenario} timed out`)),
			45_000,
		);
		const report = await completion.promise;
		assert.equal(held, true);
		assert.equal(report.ready, true);
		assert.equal(peer.stats.serverStreams, 0);
		assert.equal(peer.stats.prematureStreams, 0);
		if (scenario === "resume") {
			assert.equal(calls.ordinaryBrowser, 1);
			assert.deepEqual(cursors, [
				"~null",
				"cursor-1",
				"cursor-2",
				"cursor-1",
				"cursor-2",
			]);
			assert.equal(report.pages, "PAGE-2,PAGE-3");
			assert.equal(report.terminal, true);
			assert.equal(report.ordinaryDate, true);
			assert.equal(report.infiniteDate, true);
			assert.equal(report.liveSummary, "Current live ticket");
			assert.equal(report.duplicatePages, "PAGE-2,PAGE-3");
		} else {
			assert.equal(report.oldDispatches, 0);
			assert.equal(report.cancelled, true);
			if (scenario === "cancel") {
				assert.equal(calls.ordinaryBrowser, 0);
				assert.equal(calls.infiniteBrowser, 0);
				assert.equal(peer.stats.browserStreams, 0);
			} else {
				assert.equal(report.retiredData, 0);
				assert.equal(report.oldOptionsRejected, true);
				assert.equal(report.replacementDate, true);
				assert.equal(calls.ordinaryBrowser, 1);
				assert.equal(calls.infiniteBrowser, 0);
				assert.equal(peer.stats.browserStreams, 0);
			}
		}
		console.log(
			JSON.stringify({
				scenario: `native-start-readiness-${scenario}`,
				status: "PASS",
			}),
		);
	} finally {
		clearTimeout(deadline);
		peer.releaseAsset();
		peer.releaseDelayed();
		if (browser && browser.exitCode === null) {
			browser.kill("SIGTERM");
			const escalation = setTimeout(() => browser?.kill("SIGKILL"), 2_000);
			try {
				await browser.exited;
			} finally {
				clearTimeout(escalation);
			}
		}
		await server.stop(true);
		if (profile) await rm(profile, { recursive: true, force: true });
	}
}
