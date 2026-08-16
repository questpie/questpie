import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	projectRealtimeWireContract,
	renderClientContract,
} from "../../packages/compiler/src/runtime";
import type { NormalizedResource } from "../../packages/compiler/src/types";

const query = {
	identity: "query:messages.page",
	kind: "query",
	name: "messages.page",
	contract: {
		exposure: "network",
		input: {
			kind: "object",
			properties: { first: { kind: "integer" } },
		},
		output: {
			kind: "object",
			properties: {
				nodes: { kind: "array", items: { kind: "text" } },
			},
		},
		declaredErrors: {},
	},
	contributions: [],
	origin: {
		logicalPath: "src/messages.ts",
		exportName: "messagesPage",
		packageId: null,
		span: null,
		memberSpans: {},
	},
	value: {},
} as const satisfies NormalizedResource;

function deferred<Value = void>() {
	let resolvePromise!: (value: Value) => void;
	let rejectPromise!: (reason: unknown) => void;
	const promise = new Promise<Value>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}

async function verifyCloseOrder(
	outcome: "reject" | "resolve",
	reopenWhileClosing = false,
) {
	const realtime = projectRealtimeWireContract({
		application: "application:collaboration",
		clientContractDigest: "1".repeat(64),
		operationWireDigest: "2".repeat(64),
		resources: [query],
		watchableQueries: [query.identity],
	});
	const source = renderClientContract([query], {
		application: realtime.application,
		clientContractDigest: realtime.clientContractDigest,
		wireDigest: realtime.operationWireDigest,
		path: "/_questpie/operation",
		mediaType: "application/vnd.questpie.operation+json;version=1",
		realtime,
	});
	const directory = await mkdtemp(join(tmpdir(), "questpie-client-close-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>;\n",
		);
		await writeFile(join(directory, "client.ts"), source);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as Readonly<{
			createClient(
				input: Readonly<{
					baseUrl: string;
					fetch(request: Request): Promise<Response>;
				}>,
			): Readonly<{
				withContext(context: Readonly<{ companyId: string }>): Readonly<{
					queries: Readonly<{
						"messages.page": Readonly<{
							watch(
								input: Readonly<{ first: number }>,
								callback: (result: unknown) => void,
							): () => void;
						}>;
					}>;
				}>;
			}>;
		}>;
		const opened = deferred();
		const reopened = deferred();
		const closeStarted = deferred();
		const closeGate = deferred();
		const streamAborted = deferred();
		let aborts = 0;
		let opens = 0;
		let closes = 0;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					const scopeId = request.headers.get("x-questpie-realtime-scope");
					request.signal.addEventListener(
						"abort",
						() => {
							aborts += 1;
							streamAborted.resolve();
						},
						{ once: true },
					);
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controller.enqueue(
									new TextEncoder().encode(
										`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
									),
								);
							},
						}),
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				}
				const command = (await request.json()) as Readonly<{
					command?: string;
				}>;
				if (command.command === "open") {
					opens += 1;
					if (opens === 1) opened.resolve();
					else reopened.resolve();
					return new Response(null, { status: 202 });
				}
				if (command.command !== "close")
					throw new Error(`unexpected command ${command.command}`);
				closes += 1;
				if (closes === 1) {
					closeStarted.resolve();
					await closeGate.promise;
					if (outcome === "reject") throw new Error("close transport failed");
				}
				return new Response(null, { status: 202 });
			},
		});
		const scope = client.withContext({ companyId: "company:one" });
		const stop = scope.queries["messages.page"].watch({ first: 20 }, () => {});
		await opened.promise;
		stop();
		await closeStarted.promise;
		expect(aborts).toBe(0);
		const secondStop = reopenWhileClosing
			? scope.queries["messages.page"].watch({ first: 10 }, () => {})
			: undefined;
		if (secondStop) await reopened.promise;
		closeGate.resolve();
		if (secondStop) {
			await Promise.resolve();
			await Promise.resolve();
			expect(aborts).toBe(0);
			secondStop();
		}
		await streamAborted.promise;
		expect(aborts).toBe(1);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("last binding waits for the durable close response before aborting SSE", () =>
	verifyCloseOrder("resolve"));

test("last binding still aborts SSE after the durable close transport fails", () =>
	verifyCloseOrder("reject"));

test("a new binding keeps SSE alive while the prior durable close settles", () =>
	verifyCloseOrder("resolve", true));
