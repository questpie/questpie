// Ordinary installed-consumer process, launched by the packed documentation test.
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const useFirefox = process.env.QUESTPIE_NATIVE_DOCS_BROWSER === "1";
const protocol = { name: "questpie.realtime", version: 1 };
const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
const bindings = new Map<string, { scope: string; query: string }>();
const commands: string[] = [];
const mutationInputs: unknown[] = [];
const callIds = new Set<string>();
let summary = "Original support ticket";
let visible = true;
let initialReleased = false;
let delivery = 0;
let pending:
	| {
			callId: string;
			input: { id: string; summary: string };
			reply: (response: Response) => void;
	  }
	| undefined;
let dispatched = Promise.withResolvers<void>();
const report = Promise.withResolvers<{
	ok: boolean;
	assertions: number;
	error?: string;
}>();
const result = () => ({
	nodes: visible
		? [
				{
					id,
					summary,
					comments: [
						{
							id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7132",
							body: "Visible comment",
							createdAt: "2026-09-08T10:00:00.000Z",
						},
					],
				},
			]
		: [],
	pageInfo: { endCursor: null, hasNextPage: false },
});
function emit(scope: string, frame: object) {
	streams
		.get(scope)
		?.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol, ...frame })}\n\n`,
			),
		);
}
function deliver(kind = "update") {
	for (const [bindingId, binding] of bindings)
		emit(binding.scope, {
			kind: "delivery",
			bindingId,
			query: binding.query,
			delivery: kind,
			payload: result(),
			resetReason: null,
			resumeToken: `docs-${++delivery}`,
		});
}
const json = (body: object, status = 200) =>
	Response.json(body, {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
const built = await Bun.build({
	entrypoints: [join(import.meta.dir, "browser-entry.ts")],
	target: "browser",
	format: "esm",
});
assert.equal(built.success, true, built.logs.map(String).join("\n"));
const script = await built.outputs[0]!.text();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === "/")
			return new Response(
				'<!doctype html><html lang="en"><title>Barbershop support</title><main></main><script type="module" src="/screen.js"></script></html>',
				{ headers: { "content-type": "text/html" } },
			);
		if (path === "/screen.js")
			return new Response(script, {
				headers: { "content-type": "text/javascript" },
			});
		if (path === "/__report") {
			report.resolve(await request.json());
			return new Response(null, { status: 204 });
		}
		if (path === "/_questpie/realtime") {
			const scope = request.headers.get("x-questpie-realtime-scope")!;
			if (request.method === "GET") {
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						streams.set(scope, controller);
						emit(scope, { kind: "ready", scopeId: scope });
					},
					cancel() {
						streams.delete(scope);
					},
				});
				return new Response(stream, {
					headers: { "content-type": "text/event-stream" },
				});
			}
			const command = await request.json();
			commands.push(command.command);
			if (command.command === "open") {
				assert.equal(command.query, "query:tickets.detailPage");
				assert.deepEqual(command.input, { ids: [id], first: 1, after: null });
				bindings.set(command.bindingId, {
					scope: command.scopeId,
					query: command.query,
				});
				if (initialReleased) deliver("initial");
			} else if (command.command === "close")
				bindings.delete(command.bindingId);
			return new Response(null, { status: 202 });
		}
		if (path === "/_questpie/mutation/tickets.rename") {
			const { input } = await request.json();
			mutationInputs.push(input);
			const callId = request.headers.get("Idempotency-Key")!;
			assert.equal(
				callIds.has(callId),
				false,
				"Independent commands reused Call Identity",
			);
			callIds.add(callId);
			assert.equal(
				pending,
				undefined,
				"Mutation unexpectedly retried or overlapped",
			);
			return new Promise<Response>((reply) => {
				pending = { callId, input, reply };
				dispatched.resolve();
			});
		}
		if (path === "/__control") {
			const { command } = await request.json();
			if (["commit", "reject", "unknown"].includes(command)) {
				await dispatched.promise;
				assert.ok(
					pending,
					"Mutation response control preceded actual dispatch",
				);
				const current = pending;
				pending = undefined;
				dispatched = Promise.withResolvers<void>();
				if (command === "commit") {
					summary = current.input.summary;
					current.reply(json({ callId: current.callId, result: {} }));
					deliver();
				} else
					current.reply(
						json(
							{
								callId: current.callId,
								error:
									command === "reject"
										? { code: "TICKET_UNAVAILABLE", payload: null }
										: { code: "INTERNAL", retryable: false },
							},
							command === "reject" ? 404 : 500,
						),
					);
			} else if (command === "initial") {
				initialReleased = true;
				deliver("initial");
			} else if (command === "hide") {
				visible = false;
				deliver();
			} else if (command === "visible") {
				visible = true;
				deliver();
			} else if (command === "deny") {
				for (const [bindingId, binding] of bindings)
					emit(binding.scope, {
						kind: "failure",
						bindingId,
						query: binding.query,
						error: { code: "AUTHORIZATION_FAILED" },
					});
				// A terminal server failure retires its binding; it does not await client close.
				bindings.clear();
			} else if (command === "next-credential") {
				assert.equal(
					bindings.size,
					0,
					"Previous owner retained live subscriptions",
				);
				summary = "Next credential ticket";
				visible = true;
			} else return new Response(null, { status: 400 });
			return new Response(null, { status: 204 });
		}
		return new Response(null, { status: 404 });
	},
});
const profile = join(import.meta.dir, "firefox-profile");
let browser: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
let cleanupError: unknown;
let clearDomTimers: (() => void) | undefined;
let dom: import("jsdom").JSDOM | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let output: Promise<string>[] = [];
try {
	if (useFirefox) {
		await mkdir(profile);
		browser = Bun.spawn(
			[
				"/usr/bin/firefox",
				"--headless",
				"--no-remote",
				"--profile",
				profile,
				server.url.toString(),
			],
			{
				env: { ...process.env, MOZ_HEADLESS: "1" },
				detached: true,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		output = [
			new Response(browser.stdout).text(),
			new Response(browser.stderr).text(),
		];
	} else {
		const { JSDOM } = await import("jsdom");
		dom = new JSDOM("<!doctype html><main></main>", {
			url: server.url.toString(),
		});
		for (const [name, value] of Object.entries({
			window: dom.window,
			document: dom.window.document,
			navigator: dom.window.navigator,
			FormData: dom.window.FormData,
		}))
			Object.defineProperty(globalThis, name, { configurable: true, value });
		const transport = globalThis.fetch;
		const { timeoutManager } = await import("@tanstack/react-query");
		const timers = new Map<
			ReturnType<typeof setTimeout>,
			{ delay: number; gc: boolean }
		>();
		let tracking = true;
		timeoutManager.setTimeoutProvider({
			setTimeout(callback, delay) {
				const timer = setTimeout(() => {
					timers.delete(timer);
					callback();
				}, delay);
				if (tracking)
					timers.set(timer, {
						delay,
						gc: new Error().stack?.includes("scheduleGc") === true,
					});
				return timer;
			},
			clearTimeout(timer) {
				if (timer) timers.delete(timer);
				clearTimeout(timer);
			},
			setInterval: (callback, delay) => setInterval(callback, delay),
			clearInterval: (timer) => clearInterval(timer),
		});
		clearDomTimers = () => {
			const retained = [...timers.values()];
			tracking = false;
			for (const timer of timers.keys()) clearTimeout(timer);
			timers.clear();
			// Native browser GC can schedule again when a removed Mutation settles.
			// The isolated DOM host owns these timers, not a browser process. Do not
			// let a different outstanding schedule silently become accepted cleanup.
			assert.ok(
				retained.every((timer) => timer.gc && timer.delay === 300_000),
				"Unexpected retained native timer",
			);
		};
		globalThis.fetch = Object.assign(
			(input: RequestInfo | URL, init?: RequestInit) =>
				transport(
					typeof input === "string" ? new URL(input, server.url) : input,
					init,
				),
			{ preconnect() {} },
		);
		void import("./browser-entry").catch(report.reject);
	}
	const outcome = await Promise.race([
		report.promise,
		new Promise<never>((_, reject) => {
			deadline = setTimeout(
				() =>
					reject(
						new Error(
							`Native docs browser timed out (${commands.length} watch commands, ${mutationInputs.length} Mutations)`,
						),
					),
				35_000,
			);
		}),
	]);
	assert.equal(
		outcome.ok,
		true,
		outcome.error ?? "Browser did not report success",
	);
	assert.deepEqual(
		mutationInputs,
		[
			"Renamed support ticket",
			"Rejected intent",
			"Unknown outcome",
			"Hidden intent",
			"Retired intent",
		].map((value) => ({ id, summary: value })),
	);
	assert.equal(bindings.size, 0, "Final cleanup retained a live binding");
	assert.ok(commands.includes("open"));
	assert.ok(commands.includes("close"));
	console.log(
		JSON.stringify({
			scenario: useFirefox
				? "packed-native-docs-firefox"
				: "packed-native-docs-dom",
			assertions: outcome.assertions,
			mutations: mutationInputs.length,
		}),
	);
} finally {
	clearTimeout(deadline);
	if (browser) {
		try {
			process.kill(-browser.pid, "SIGKILL");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ESRCH")
				cleanupError = error;
		}
		await browser.exited;
	}
	pending?.reply(new Response(null, { status: 503 }));
	for (const stream of streams.values()) {
		try {
			stream.close();
		} catch {}
	}
	await server.stop(true);
	await Promise.all(output);
	dom?.window.close();
	clearDomTimers?.();
	if (useFirefox) await rm(profile, { recursive: true, force: true });
}
if (cleanupError !== undefined) throw cleanupError;
