import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	projectRealtimeWireContract,
	renderClientContract,
} from "../../packages/compiler/src/runtime";
import type { NormalizedResource } from "../../packages/compiler/src/types";

const input = {
	kind: "object",
	properties: {
		after: { codec: { kind: "text" }, kind: "nullable" },
		channelId: { kind: "uuid" },
		first: { kind: "integer", minimum: 1 },
	},
} as const;
const output = {
	kind: "object",
	properties: {
		nodes: { kind: "array", items: { kind: "text" } },
	},
} as const;

function query(name: string): NormalizedResource {
	return {
		identity: `query:${name}`,
		kind: "query",
		name,
		contract: {
			exposure: "network",
			input,
			output,
			declaredErrors: {},
		},
		contributions: [],
		origin: {
			logicalPath: "src/messages.ts",
			exportName: name.replaceAll(".", "_"),
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: {},
	};
}

const resources = [query("messages.page"), query("reports.once")];
const clientContractDigest = "1".repeat(64);
const operationWireDigest = "2".repeat(64);
const realtime = projectRealtimeWireContract({
	application: "application:collaboration",
	clientContractDigest,
	operationWireDigest,
	resources,
	watchableQueries: ["query:messages.page"],
});

function renderClient(): string {
	return renderClientContract(resources, {
		application: realtime.application,
		clientContractDigest,
		wireDigest: realtime.operationWireDigest,
		path: "/_questpie/operation",
		mediaType: "application/vnd.questpie.operation+json;version=1",
		realtime,
	});
}

type Resource = Readonly<{
	getSnapshot(): unknown;
	subscribe(notify: () => void): () => void;
}>;

type GeneratedClientModule = Readonly<{
	createClient(
		input: Readonly<{ baseUrl: string; fetch: typeof fetch }>,
	): Readonly<{
		withContext(context: Readonly<{ companyId: string }>): Readonly<{
			queries: Readonly<{
				"messages.page": Readonly<{
					observe(
						input: Readonly<{
							after: string | null;
							channelId: string;
							first: number;
						}>,
					): Resource;
				}>;
				"reports.once": Readonly<Record<string, never>>;
			}>;
		}>;
	}>;
}>;

async function settleUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(0);
	}
}

test("generates lazy scope-local Query Resource identity only for a watchable Query", async () => {
	const source = renderClient();
	const declarations = source.slice(0, source.indexOf("export class"));
	expect(declarations).toContain(
		"observe(input: Input): QueryResource<Output>",
	);
	expect(declarations).toContain('"messages.page": WatchableQueryMethod<');
	expect(declarations).not.toContain('"reports.once": WatchableQueryMethod<');

	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-client-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), source);
		await writeFile(
			join(directory, "authoring.ts"),
			`import { createClient, type QueryResource } from "./client";
const api = createClient({ baseUrl: "http://runtime.test" }).withContext({ companyId: "company:one" });
const resource = api.queries["messages.page"].observe({ after: null, channelId: "00000000-0000-4000-8000-000000000001", first: 20 });
const exact: QueryResource<Readonly<{ readonly nodes: ReadonlyArray<string> }>> = resource;
const subscribe = exact.subscribe;
const getSnapshot = exact.getSnapshot;
void subscribe;
void getSnapshot;
// @ts-expect-error one-shot-only Queries have no observe projection
api.queries["reports.once"].observe({ after: null, channelId: "00000000-0000-4000-8000-000000000001", first: 20 });
`,
		);
		await writeFile(
			join(directory, "tsconfig.json"),
			JSON.stringify({
				extends: resolve(import.meta.dir, "../../tsconfig.base.json"),
				compilerOptions: { noEmit: true, types: [] },
				files: ["app.ts", "client.ts", "authoring.ts"],
			}),
		);
		const typecheck = Bun.spawnSync([
			"bun",
			resolve(import.meta.dir, "../../node_modules/typescript/bin/tsc"),
			"-p",
			join(directory, "tsconfig.json"),
			"--pretty",
			"false",
		]);
		expect(
			typecheck.exitCode,
			`${typecheck.stdout.toString()}${typecheck.stderr.toString()}`,
		).toBe(0);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		let requests = 0;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async () => {
				requests += 1;
				throw new Error("observation performed I/O");
			},
		});
		const firstScope = client.withContext({ companyId: "company:one" });
		const secondScope = client.withContext({ companyId: "company:one" });
		const operationInput = {
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 20,
		};
		expect(() =>
			firstScope.queries["messages.page"].observe({
				...operationInput,
				first: 0,
			}),
		).toThrow("PROTOCOL_UNSUPPORTED");
		const first = firstScope.queries["messages.page"].observe(operationInput);
		expect(
			firstScope.queries["messages.page"].observe({ ...operationInput }),
		).toBe(first);
		expect(
			firstScope.queries["messages.page"].observe({
				...operationInput,
				first: 21,
			}),
		).not.toBe(first);
		expect(
			secondScope.queries["messages.page"].observe(operationInput),
		).not.toBe(first);
		expect(requests).toBe(0);
		expect(firstScope.queries["reports.once"]).not.toHaveProperty("observe");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("captures canonical input and shares one watch across independent subscriptions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-watch-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		const commands: Record<string, unknown>[] = [];
		let downstreams = 0;
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let scopeId: string | null = null;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					downstreams += 1;
					scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
							},
						}),
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				}
				commands.push((await request.json()) as Record<string, unknown>);
				return new Response(null, { status: 202 });
			},
		});
		const operationInput = {
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 20,
		};
		const resource = client
			.withContext({ companyId: "company:one" })
			.queries["messages.page"].observe(operationInput);
		const subscribe = resource.subscribe;
		const getSnapshot = resource.getSnapshot;
		const initial = getSnapshot();
		expect(getSnapshot()).toBe(initial);
		expect(downstreams).toBe(0);

		operationInput.first = 99;
		let notifications = 0;
		const notify = () => {
			notifications += 1;
		};
		const stopFirst = subscribe(notify);
		const stopSecond = subscribe(notify);
		expect(resource.subscribe).toBe(subscribe);
		expect(resource.getSnapshot).toBe(getSnapshot);
		expect(downstreams).toBe(1);

		await Bun.sleep(0);
		streamController?.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await Bun.sleep(0);
		const open = commands.find(({ command }) => command === "open");
		expect(open?.input).toEqual({
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 20,
		});
		notifications = 0;
		streamController?.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId: open?.bindingId, query: "query:messages.page", delivery: "initial", resetReason: null, payload: { nodes: ["complete"] }, resumeToken: "opaque" })}\n\n`,
			),
		);
		await Bun.sleep(0);
		expect(notifications).toBe(2);
		expect(getSnapshot()).toEqual({
			kind: "ready",
			value: { nodes: ["complete"] },
			delivery: { kind: "initial" },
			connection: { kind: "connected" },
		});
		expect(Object.isFrozen(getSnapshot())).toBe(true);

		stopFirst();
		stopFirst();
		expect(commands.filter(({ command }) => command === "close")).toHaveLength(
			0,
		);
		stopSecond();
		await Bun.sleep(0);
		expect(commands.filter(({ command }) => command === "close")).toHaveLength(
			1,
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("isolates subscriber failure and recovers from terminal failure only by fresh observation", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-terminal-"));
	const originalReportError = globalThis.reportError;
	const reported: unknown[] = [];
	globalThis.reportError = (error) => reported.push(error);
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		const commands: Record<string, unknown>[] = [];
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let scopeId: string | null = null;
		let downstreams = 0;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					downstreams += 1;
					scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
							},
						}),
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				}
				commands.push((await request.json()) as Record<string, unknown>);
				return new Response(null, { status: 202 });
			},
		});
		const method = client.withContext({ companyId: "company:one" }).queries[
			"messages.page"
		];
		const operationInput = {
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 20,
		};
		const resource = method.observe(operationInput);
		let peerNotifications = 0;
		const stopFailing = resource.subscribe(() => {
			if ((resource.getSnapshot() as { kind?: string }).kind === "ready")
				throw new Error("component failed");
		});
		const stopPeer = resource.subscribe(() => {
			peerNotifications += 1;
		});
		await Bun.sleep(0);
		const encoder = new TextEncoder();
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await Bun.sleep(0);
		peerNotifications = 0;
		const open = commands.find(({ command }) => command === "open");
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId: open?.bindingId, query: "query:messages.page", delivery: "initial", resetReason: null, payload: { nodes: ["authorized"] }, resumeToken: "opaque" })}\n\n`,
			),
		);
		await Bun.sleep(0);
		expect(reported).toHaveLength(1);
		expect(peerNotifications).toBe(1);
		expect(resource.getSnapshot()).toMatchObject({
			kind: "ready",
			value: { nodes: ["authorized"] },
		});

		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "failure", bindingId: open?.bindingId, query: "query:messages.page", error: { code: "AUTHORIZATION_FAILED" } })}\n\n`,
			),
		);
		await Bun.sleep(0);
		expect(resource.getSnapshot()).toEqual({
			kind: "failed",
			failure: { code: "AUTHORIZATION_FAILED" },
		});
		const openCount = commands.filter(
			({ command }) => command === "open",
		).length;
		const staleStop = resource.subscribe(() => undefined);
		expect(commands.filter(({ command }) => command === "open")).toHaveLength(
			openCount,
		);

		const replacement = method.observe(operationInput);
		expect(replacement).not.toBe(resource);
		const stopReplacement = replacement.subscribe(() => undefined);
		await settleUntil(
			() =>
				commands.filter(({ command }) => command === "open").length >=
					openCount + 1 || downstreams >= 2,
		);
		if (
			commands.filter(({ command }) => command === "open").length === openCount
		) {
			streamController?.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
				),
			);
		}
		await settleUntil(
			() =>
				commands.filter(({ command }) => command === "open").length >=
				openCount + 1,
		);
		expect(commands.filter(({ command }) => command === "open")).toHaveLength(
			openCount + 1,
		);
		staleStop();
		stopReplacement();
		stopFailing();
		stopPeer();
	} finally {
		globalThis.reportError = originalReportError;
		await rm(directory, { recursive: true, force: true });
	}
});

test("bounds each scope and tombstones a retained idle eviction", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-capacity-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		let downstreams = 0;
		let opens = 0;
		let scopeId: string | null = null;
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					downstreams += 1;
					scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
							},
						}),
						{
							headers: { "content-type": realtime.streamMediaType },
						},
					);
				}
				const command = (await request.json()) as Record<string, unknown>;
				if (command.command === "open") opens += 1;
				return new Response(null, { status: 202 });
			},
		});
		const method = client.withContext({ companyId: "company:one" }).queries[
			"messages.page"
		];
		const resources: Resource[] = [];
		const stops: Array<() => void> = [];
		for (let first = 1; first <= 128; first += 1) {
			const resource = method.observe({
				after: null,
				channelId: "00000000-0000-4000-8000-000000000001",
				first,
			});
			resources.push(resource);
			stops.push(resource.subscribe(() => undefined));
		}
		const overflow = method.observe({
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 129,
		});
		expect(overflow.getSnapshot()).toEqual({
			kind: "failed",
			failure: { code: "RESOURCE_LIMIT" },
		});
		const stopOverflow = overflow.subscribe(() => undefined);

		stops[0]?.();
		const replacement = method.observe({
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 129,
		});
		expect(replacement).not.toBe(overflow);
		expect(resources[0]?.getSnapshot()).toEqual({
			kind: "failed",
			failure: { code: "RESOURCE_LIMIT" },
		});
		const downstreamsBeforeEvictedSubscribe = downstreams;
		const stopEvicted = resources[0]?.subscribe(() => undefined);
		const stopReplacement = replacement.subscribe(() => undefined);
		await Bun.sleep(0);
		expect(downstreams).toBe(Math.max(1, downstreamsBeforeEvictedSubscribe));
		streamController?.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await settleUntil(() => opens >= 128);
		expect(opens).toBe(128);

		stopOverflow();
		stopEvicted?.();
		stopReplacement();
		for (const stop of stops.slice(1)) stop();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("retains complete data through reconnect and cancels stale reconnect work", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-reconnect-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		const commands: Record<string, unknown>[] = [];
		let downstreams = 0;
		let scopeId: string | null = null;
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					downstreams += 1;
					scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								streamController = controller;
							},
						}),
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				}
				commands.push((await request.json()) as Record<string, unknown>);
				return new Response(null, { status: 202 });
			},
		});
		const resource = client
			.withContext({ companyId: "company:one" })
			.queries["messages.page"].observe({
				after: null,
				channelId: "00000000-0000-4000-8000-000000000001",
				first: 20,
			});
		const stop = resource.subscribe(() => undefined);
		await Bun.sleep(0);
		const encoder = new TextEncoder();
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await Bun.sleep(0);
		const firstOpen = commands.find(({ command }) => command === "open");
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId: firstOpen?.bindingId, query: "query:messages.page", delivery: "initial", resetReason: null, payload: { nodes: ["retained"] }, resumeToken: "opaque-one" })}\n\n`,
			),
		);
		await Bun.sleep(0);
		streamController?.close();
		await settleUntil(
			() =>
				(resource.getSnapshot() as { connection?: { kind?: string } })
					.connection?.kind === "reconnecting",
		);
		expect(resource.getSnapshot()).toMatchObject({
			kind: "ready",
			value: { nodes: ["retained"] },
			connection: { kind: "reconnecting", attempt: 1 },
		});

		stop();
		await Bun.sleep(300);
		expect(downstreams).toBe(1);
		expect(resource.getSnapshot()).toMatchObject({
			kind: "ready",
			value: { nodes: ["retained"] },
			connection: { kind: "idle" },
		});

		const reopenedStop = resource.subscribe(() => undefined);
		await settleUntil(() => downstreams >= 2);
		expect(downstreams).toBe(2);
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await settleUntil(
			() => commands.filter(({ command }) => command === "open").length >= 2,
		);
		const secondOpen = commands
			.filter(({ command }) => command === "open")
			.at(-1);
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId: secondOpen?.bindingId, query: "query:messages.page", delivery: "update", resetReason: null, payload: { nodes: ["fresh"] }, resumeToken: "opaque-two" })}\n\n`,
			),
		);
		await Bun.sleep(0);
		expect(resource.getSnapshot()).toEqual({
			kind: "ready",
			value: { nodes: ["fresh"] },
			delivery: { kind: "update" },
			connection: { kind: "connected" },
		});
		reopenedStop();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
