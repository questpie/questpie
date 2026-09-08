import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPeer, ticketDetail, ticketResult } from "./tracer-peer";

const entry = await import(
	new URL("./dist/server/server.js", import.meta.url).href
);
const initialSession = crypto.randomUUID();
const nextSession = crypto.randomUUID();
const delayed = Promise.withResolvers<void>();
const mutationReceived = Promise.withResolvers<void>();
const oldMutation = Promise.withResolvers<void>();
const finished = Promise.withResolvers<Record<string, unknown>>();
const reports = new Map<string, Record<string, unknown>>();
let oldReads = 0,
	newReads = 0,
	oldWrites = 0,
	newWrites = 0;
const oldContext: string[] = [];
const newContext: string[] = [];
const isNew = (request: Request) =>
	request.headers.get("cookie")?.includes(nextSession) === true;
const peer = createPeer({
	result: (id, request) =>
		ticketDetail(
			id,
			isNew(request) ? "New credential task" : "Old credential task",
		),
});
peer.releaseAsset();
const reply = (request: Request, result: unknown) =>
	Response.json(
		{
			callId: request.headers.get(
				request.method === "GET" ? "Questpie-Call-Id" : "Idempotency-Key",
			),
			result,
		},
		{ headers: { "content-type": "application/json; charset=utf-8" } },
	);
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	idleTimeout: 30,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/__start")
			return new Response(null, {
				status: 302,
				headers: {
					location: "/credential-switch",
					"set-cookie": `proof-session=${initialSession}; HttpOnly; SameSite=Strict; Path=/`,
				},
			});
		if (url.pathname === "/__credential-switch") {
			await mutationReceived.promise;
			return new Response(null, {
				status: 204,
				headers: {
					"set-cookie": `proof-session=${nextSession}; HttpOnly; SameSite=Strict; Path=/`,
				},
			});
		}
		if (url.pathname === "/__fault-observer.js")
			return new Response("", {
				headers: { "content-type": "text/javascript" },
			});
		if (url.pathname === "/__report") {
			const report = await request.json();
			reports.set(report.phase, report);
			if (report.phase === "browser-error")
				finished.reject(new Error("Browser execution or hydration error"));
			if (report.phase === "credential-switched") {
				delayed.resolve();
				oldMutation.resolve();
			}
			if (report.phase === "credential-final") finished.resolve(report);
			return new Response(null, { status: 204 });
		}
		if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(url.pathname))
			return new Response(
				Bun.file(new URL(`./dist/client${url.pathname}`, import.meta.url)),
			);
		if (url.pathname === "/favicon.ico")
			return new Response(null, { status: 204 });
		if (
			url.pathname.startsWith("/_questpie/") &&
			!isNew(request) &&
			!request.headers.get("cookie")?.includes(initialSession)
		)
			return new Response("Missing fixture session", { status: 401 });
		if (url.pathname === "/_questpie/query/tickets.detail") {
			const fresh = isNew(request);
			if (fresh) newReads++;
			else oldReads++;
			(fresh ? newContext : oldContext).push(
				Buffer.from(
					request.headers.get("Questpie-Context")!,
					"base64url",
				).toString("utf8"),
			);
			const id = url.searchParams.get("id");
			if (id?.endsWith("7132")) await delayed.promise;
			return reply(request, ticketDetail(id!, "Old credential task"));
		}
		if (url.pathname === "/_questpie/mutation/ticket.edit") {
			const body = await request.json();
			const fresh = isNew(request);
			if (fresh) newWrites++;
			else oldWrites++;
			(fresh ? newContext : oldContext).push(JSON.stringify(body.context));
			if (oldWrites === 2 && !fresh) {
				mutationReceived.resolve();
				await oldMutation.promise;
			}
			return reply(
				request,
				ticketResult(
					"018f5f6e-5f2c-7b41-a854-3d9a6b6b7131",
					oldWrites === 1
						? "Old committed result"
						: "Late old committed result",
				),
			);
		}
		if (url.pathname === "/_questpie/realtime" && request.method === "POST") {
			const command = await request.clone().json();
			if (command.command === "open")
				(isNew(request) ? newContext : oldContext).push(
					JSON.stringify(command.context),
				);
		}
		const external = await peer.handle(request);
		if (external) return external;
		const response: Response = await entry.default.fetch(request);
		return response.body
			? new Response(
					response.body.pipeThrough(
						new TransformStream({
							flush() {
								peer.stats.ssrComplete = true;
							},
						}),
					),
					{ status: response.status, headers: response.headers },
				)
			: response;
	},
});
let browser: ReturnType<typeof Bun.spawn> | undefined;
let profile: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
try {
	profile = await mkdtemp(
		join(tmpdir(), "questpie-start-credentials-firefox-"),
	);
	const launched = Bun.spawn(
		[
			"/usr/bin/firefox",
			"--headless",
			"--no-remote",
			"--profile",
			profile,
			`http://127.0.0.1:${server.port}/__start`,
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
	const result = await Promise.race([
		finished.promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new Error(
							`Credential tracer timeout: ${JSON.stringify({ reports: [...reports.values()], oldReads, newReads, oldWrites, newWrites, stats: peer.stats, opens: peer.opens.length })}`,
						),
					),
				20_000,
			);
		}),
	]);
	const retired = reports.get("credential-retired")!;
	const before = reports.get("credential-before-switch")!;
	const pending = reports.get("credential-pending")!;
	assert.equal(pending.status, "pending");
	assert.equal(pending.variables, "done");
	assert.equal(before.query, "Old credential task");
	assert.equal(before.mutation, "Old committed result");
	assert.ok(
		retired.query === "Retired Query" || retired.query === "Loading",
		"Mounted old Query must no longer expose its data",
	);
	assert.equal(retired.mutation, "No Mutation result");
	assert.equal(retired.pending, "idle");
	assert.equal(retired.variables, "No pending input");
	assert.equal(result.summary, "New credential task");
	assert.equal(result.oldVisible, false);
	assert.equal(
		result.oldStreamRejected,
		true,
		"Retained options must not hit late hydrated retired-scope data",
	);
	assert.equal(
		result.oldCachedData,
		0,
		"Late SSR hydration must not retain data in the retired scope cache",
	);
	assert.equal(result.lateOutcome, "committed");
	assert.equal(result.oldQueryRejected, true);
	assert.equal(result.oldMutationRejected, true);
	assert.equal(result.differentKey, true);
	assert.equal(result.cookieHidden, true);
	assert.equal(oldReads, 2);
	const canonical = (value: string) => JSON.stringify(JSON.parse(value));
	assert.ok(oldContext.length > 0 && newContext.length > 0);
	assert.equal(new Set([...oldContext, ...newContext].map(canonical)).size, 1);
	assert.equal(oldWrites, 2);
	assert.equal(newWrites, 0);
	assert.equal(newReads, 0);
	assert.equal(peer.stats.serverStreams, 0);
	assert.equal(peer.stats.browserStreams, 1);
	assert.equal(peer.opens.length, 1);
	console.log(
		JSON.stringify({
			tracer: "actual-start-credential-switch",
			assertions: 26,
			oldReads,
			newReads,
			oldWrites,
			newWrites,
			...result,
		}),
	);
	browser.kill("SIGTERM");
	const escalation = setTimeout(() => browser?.kill("SIGKILL"), 2000);
	try {
		await browser.exited;
	} finally {
		clearTimeout(escalation);
	}
	await Promise.all(output);
} finally {
	if (timer) clearTimeout(timer);
	delayed.resolve();
	oldMutation.resolve();
	if (browser && browser.exitCode === null) {
		browser.kill("SIGKILL");
		await browser.exited;
	}
	server.stop(true);
	if (profile) await rm(profile, { recursive: true, force: true });
}
