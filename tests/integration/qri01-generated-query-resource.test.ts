import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

import {
	projectRealtimeWireContract,
	renderClientContract,
} from "../../packages/compiler/src/runtime";
import { renderClientQueryResource } from "../../packages/compiler/src/runtime/client-query-resource";
import type { NormalizedResource } from "../../packages/compiler/src/types";
import { installQuestpieForTracer } from "../support/beta12-packed-questpie";

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
const collaborationFixture = resolve(
	import.meta.dir,
	"../../fixtures/collaboration",
);
const clientContractDigest = "1".repeat(64);
const operationHttpContractDigest = "2".repeat(64);
const realtime = projectRealtimeWireContract({
	application: "application:collaboration",
	clientContractDigest,
	operationHttpContractDigest,
	resources,
	watchableQueries: ["query:messages.page"],
});

function renderClient(): string {
	return renderClientContract(resources, {
		application: realtime.application,
		clientContractDigest,
		httpContractDigest: realtime.operationHttpContractDigest,
		realtime,
	});
}

const timestampResource: NormalizedResource = {
	...query("events.since"),
	identity: "query:events.since",
	contract: {
		exposure: "network",
		input: {
			kind: "object",
			properties: { since: { kind: "timestamp", withTimezone: false } },
		},
		output,
		declaredErrors: {},
	},
};
const timestampRealtime = projectRealtimeWireContract({
	application: "application:collaboration",
	clientContractDigest,
	operationHttpContractDigest,
	resources: [timestampResource],
	watchableQueries: [timestampResource.identity],
});

function renderTimestampClient(): string {
	return renderClientContract([timestampResource], {
		application: timestampRealtime.application,
		clientContractDigest,
		httpContractDigest: timestampRealtime.operationHttpContractDigest,
		realtime: timestampRealtime,
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
					watch(
						input: Readonly<{
							after: string | null;
							channelId: string;
							first: number;
						}>,
						callback: (result: unknown, delivery: unknown) => void,
						options?: Readonly<{
							onError?(failure: Readonly<{ code: string }>): void;
							onStateChange?(
								state: Readonly<{
									kind: "connected" | "reconnecting";
									attempt?: number;
								}>,
							): void;
						}>,
					): () => void;
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

type PackedCollaborationClientModule = Readonly<{
	createClient(input: Readonly<{ baseUrl: string }>): Readonly<{
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
			}>;
		}>;
	}>;
}>;

type TimestampClientModule = Readonly<{
	createClient(
		input: Readonly<{ baseUrl: string; fetch: typeof fetch }>,
	): Readonly<{
		withContext(context: Readonly<{ companyId: string }>): Readonly<{
			queries: Readonly<{
				"events.since": Readonly<{
					watch(
						input: Readonly<{ since: Date }>,
						callback: (result: unknown, delivery: unknown) => void,
						options?: Readonly<{
							onError?(failure: Readonly<{ code: string }>): void;
						}>,
					): () => void;
				}>;
			}>;
		}>;
	}>;
}>;

type ControlledWatch = Readonly<{
	callback(
		output: unknown,
		delivery: Readonly<{ kind: "initial" | "update" }>,
	): void;
	options: Readonly<{
		onError?(failure: Readonly<{ code: string }>): void;
		onStateChange?(state: Readonly<{ kind: "connected" }>): void;
	}>;
}>;

type QueryResourceHarnessModule = Readonly<{
	createQueryResourceRegistry(
		startWatch: (
			query: string,
			input: unknown,
			callback: ControlledWatch["callback"],
			options: ControlledWatch["options"],
		) => () => void,
	): Readonly<{
		observe(query: string, canonicalInput: unknown): Resource;
	}>;
}>;

function renderQueryResourceHarness(): string {
	const runtime = renderClientQueryResource(true).runtime.replace(
		"function createQueryResourceRegistry(",
		"export function createQueryResourceRegistry(",
	);
	return `
type QueryDelivery = Readonly<{ kind: "initial" | "update" }>;
type WatchFailure = Readonly<{ code: "AUTHORIZATION_FAILED" | "OUTPUT_INVALID" | "RESOURCE_LIMIT" | "TRANSPORT_FAILED" | "VERSION_INCOMPATIBLE" }>;
type WatchOptions = Readonly<{
	onStateChange?(state: Readonly<{ kind: "connected" } | { kind: "reconnecting"; attempt: number }>): void;
	onError?(failure: WatchFailure): void;
}>;
type QueryResourceConnection =
	| Readonly<{ kind: "idle" }>
	| Readonly<{ kind: "connecting" }>
	| Readonly<{ kind: "connected" }>
	| Readonly<{ kind: "reconnecting"; attempt: number }>;
type QueryResourceSnapshot<Output> =
	| Readonly<{ kind: "pending"; connection: QueryResourceConnection }>
	| Readonly<{ kind: "ready"; value: Output; delivery: QueryDelivery; connection: QueryResourceConnection }>
	| Readonly<{ kind: "failed"; failure: WatchFailure }>;
interface QueryResource<Output> {
	getSnapshot(): QueryResourceSnapshot<Output>;
	subscribe(notify: () => void): () => void;
}
${runtime}
`;
}

async function settleUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(0);
	}
}

async function eventually(
	predicate: () => boolean,
	message: string,
): Promise<void> {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(5);
	}
	throw new Error(message);
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
		await installQuestpieForTracer(directory);
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
		const packed = await Bun.build({
			entrypoints: [join(directory, "client.ts")],
			format: "esm",
			minify: true,
			outdir: join(directory, "packed"),
			target: "bun",
		});
		expect(packed.success, packed.logs.map(String).join("\n")).toBe(true);
		const generated = (await import(
			`${pathToFileURL(packed.outputs[0]!.path).href}?${crypto.randomUUID()}`
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

test("runs a compiler-generated packed client through one real loopback Live Query", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-packed-"));
	let server: ReturnType<typeof Bun.serve> | undefined;
	try {
		await cp(collaborationFixture, directory, { recursive: true });
		const compilation = await compileApplication({
			applicationRoot: directory,
		});
		const realtimeContract = JSON.parse(
			compilation.generatedFiles["realtime-wire-contract.json"]!,
		) as Readonly<{
			path: string;
			protocol: Readonly<{ name: string; version: number }>;
			streamMediaType: string;
		}>;
		const packedDirectory = join(directory, "packed-client");
		const packed = await Bun.build({
			entrypoints: [join(directory, ".questpie/generated/client.ts")],
			format: "esm",
			minify: true,
			outdir: packedDirectory,
			target: "bun",
		});
		expect(packed.success, packed.logs.map(String).join("\n")).toBe(true);
		expect(packed.outputs).toHaveLength(1);

		const commands: Record<string, unknown>[] = [];
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const encoder = new TextEncoder();
		const frame = (value: unknown) =>
			encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: async (request) => {
				const url = new URL(request.url);
				if (url.pathname !== realtimeContract.path)
					return new Response(null, { status: 404 });
				if (request.method === "GET") {
					const scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						new ReadableStream<Uint8Array>({
							start(next) {
								controller = next;
								queueMicrotask(() =>
									next.enqueue(
										frame({
											kind: "ready",
											protocol: realtimeContract.protocol,
											scopeId,
										}),
									),
								);
							},
						}),
						{
							headers: { "content-type": realtimeContract.streamMediaType },
						},
					);
				}
				const command = (await request.json()) as Record<string, unknown>;
				commands.push(command);
				if (command.command === "open") {
					queueMicrotask(() =>
						controller?.enqueue(
							frame({
								bindingId: command.bindingId,
								delivery: "initial",
								kind: "delivery",
								payload: {
									nodes: [],
									pageInfo: { endCursor: null, hasNextPage: false },
								},
								protocol: realtimeContract.protocol,
								query: command.query,
								resetReason: null,
								resumeToken: "loopback-token",
							}),
						),
					);
				}
				return new Response(null, { status: 202 });
			},
		});

		const generated = (await import(
			`${pathToFileURL(packed.outputs[0]!.path).href}?${crypto.randomUUID()}`
		)) as PackedCollaborationClientModule;
		const resource = generated
			.createClient({ baseUrl: server.url.toString() })
			.withContext({ companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2" })
			.queries["messages.page"].observe({
				after: null,
				channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3",
				first: 1,
			});
		const stop = resource.subscribe(() => undefined);
		await eventually(
			() => (resource.getSnapshot() as { kind?: string }).kind === "ready",
			"packed loopback Query Resource never became ready",
		);
		expect(resource.getSnapshot()).toEqual({
			connection: { kind: "connected" },
			delivery: { kind: "initial" },
			kind: "ready",
			value: {
				nodes: [],
				pageInfo: { endCursor: null, hasNextPage: false },
			},
		});
		expect(commands.filter(({ command }) => command === "open")).toHaveLength(
			1,
		);
		stop();
		await eventually(
			() => commands.some(({ command }) => command === "close"),
			"packed loopback Query Resource never closed its watch",
		);
	} finally {
		await server?.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
}, 30_000);

test("does not block a sibling binding behind an acknowledgement", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-ack-"));
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		const commands: Record<string, unknown>[] = [];
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		let scopeId: string | null = null;
		const firstAcknowledgement = Promise.withResolvers<void>();
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						new ReadableStream<Uint8Array>({
							start(current) {
								controller = current;
								request.signal.addEventListener(
									"abort",
									() => current.close(),
									{ once: true },
								);
							},
						}),
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				}
				const command = (await request.json()) as Record<string, unknown>;
				commands.push(command);
				const opens = commands.filter(({ command }) => command === "open");
				if (
					command.command === "ack" &&
					command.bindingId === opens[0]?.bindingId
				)
					await firstAcknowledgement.promise;
				return new Response(null, { status: 202 });
			},
		});
		const query = client.withContext({ companyId: "company:one" }).queries[
			"messages.page"
		];
		const deliveries: string[] = [];
		const stopFirst = query.watch(
			{
				after: null,
				channelId: "00000000-0000-4000-8000-000000000001",
				first: 1,
			},
			() => deliveries.push("first"),
		);
		const stopSecond = query.watch(
			{
				after: null,
				channelId: "00000000-0000-4000-8000-000000000001",
				first: 2,
			},
			() => deliveries.push("second"),
		);
		await Bun.sleep(0);
		controller?.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await eventually(
			() => commands.filter(({ command }) => command === "open").length === 2,
			"both sibling watches did not open",
		);
		const opens = commands.filter(({ command }) => command === "open");
		for (const [index, open] of opens.entries())
			controller?.enqueue(
				new TextEncoder().encode(
					`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId: open.bindingId, query: "query:messages.page", delivery: "initial", resetReason: null, payload: { nodes: [] }, resumeToken: `token:${index}` })}\n\n`,
				),
			);
		await eventually(
			() => deliveries.length === 2,
			"second sibling delivery was blocked behind the first acknowledgement",
		);
		await eventually(
			() =>
				commands.some(
					(command) =>
						command.command === "ack" &&
						command.bindingId === opens[1]?.bindingId,
				),
			"second sibling acknowledgement was blocked",
		);
		firstAcknowledgement.resolve();
		stopFirst();
		stopSecond();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("backs off and resumes after an acknowledgement rejection", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-ack-retry-"));
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		const commands: Record<string, unknown>[] = [];
		const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
		const scopeIds: (string | null)[] = [];
		let downstreams = 0;
		let rejected = false;
		const states: Readonly<{ kind: string; attempt?: number }>[] = [];
		const failures: string[] = [];
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				if (request.method === "GET") {
					downstreams += 1;
					scopeIds.push(request.headers.get("x-questpie-realtime-scope"));
					return new Response(
						new ReadableStream<Uint8Array>({
							start(controller) {
								controllers.push(controller);
								request.signal.addEventListener(
									"abort",
									() => controller.error(request.signal.reason),
									{ once: true },
								);
							},
						}),
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				}
				const command = (await request.json()) as Record<string, unknown>;
				commands.push(command);
				if (command.command === "ack" && !rejected) {
					rejected = true;
					return new Response(null, { status: 409 });
				}
				return new Response(null, { status: 202 });
			},
		});
		const stop = client
			.withContext({ companyId: "company:one" })
			.queries["messages.page"].watch(
				{
					after: null,
					channelId: "00000000-0000-4000-8000-000000000001",
					first: 1,
				},
				() => undefined,
				{
					onError: ({ code }) => failures.push(code),
					onStateChange: (state) => states.push(state),
				},
			);
		await eventually(() => controllers.length === 1, "stream did not open");
		controllers[0]!.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId: scopeIds[0] })}\n\n`,
			),
		);
		await eventually(
			() => commands.some(({ command }) => command === "open"),
			"binding did not open",
		);
		const bindingId = commands.find(
			({ command }) => command === "open",
		)!.bindingId;
		controllers[0]!.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId, query: "query:messages.page", delivery: "initial", resetReason: null, payload: { nodes: [] }, resumeToken: "resume:first" })}\n\n`,
			),
		);
		await eventually(() => rejected, "acknowledgement was not rejected");
		await Bun.sleep(25);
		expect(downstreams).toBe(1);
		expect(states).toContainEqual({ kind: "reconnecting", attempt: 1 });
		expect(failures).toEqual([]);
		await eventually(
			() => controllers.length === 2,
			"stream did not reconnect",
		);
		controllers[1]!.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId: scopeIds[1] })}\n\n`,
			),
		);
		await eventually(
			() => commands.filter(({ command }) => command === "open").length === 2,
			"binding did not reopen",
		);
		expect(
			commands.filter(({ command }) => command === "open")[1]?.resumeToken,
		).toBe("resume:first");
		stop();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("direct watch validates and canonically encodes input once", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "questpie-qri01-watch-codec-"),
	);
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderTimestampClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as TimestampClientModule;
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
						{ headers: { "content-type": timestampRealtime.streamMediaType } },
					);
				}
				commands.push((await request.json()) as Record<string, unknown>);
				return new Response(null, { status: 202 });
			},
		});
		const method = client.withContext({ companyId: "company:one" }).queries[
			"events.since"
		];
		expect(() =>
			method.watch({ since: new Date(Number.NaN) }, () => undefined),
		).toThrow("PROTOCOL_UNSUPPORTED");
		expect(downstreams).toBe(0);

		const since = new Date("2026-09-01T10:11:12.345Z");
		const stop = method.watch({ since }, () => undefined);
		await Bun.sleep(0);
		streamController?.enqueue(
			new TextEncoder().encode(
				`data: ${JSON.stringify({ protocol: timestampRealtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await eventually(
			() => commands.some(({ command }) => command === "open"),
			"direct watch did not open",
		);
		expect(commands.find(({ command }) => command === "open")?.input).toEqual({
			since: "2026-09-01T10:11:12.345",
		});
		stop();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test.each([
	["VERSION_INCOMPATIBLE", "version"],
	["RESOURCE_LIMIT", "resource"],
	["TRANSPORT_FAILED", "transport"],
] as const)(
	"terminal %s does not reopen the direct watch carrier",
	async (expectedCode, mode) => {
		const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-terminal-"));
		try {
			await installQuestpieForTracer(directory);
			await writeFile(
				join(directory, "app.ts"),
				"export type AppContextInput = Readonly<{ companyId: string }>\n",
			);
			await writeFile(join(directory, "client.ts"), renderClient());
			const generated = (await import(
				`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
			)) as GeneratedClientModule;
			let downstreams = 0;
			const terminal = Promise.withResolvers<string>();
			const client = generated.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request) => {
					if (request.method !== "GET")
						return new Response(null, { status: 202 });
					downstreams += 1;
					if (downstreams > 1)
						return new Response(new ReadableStream({ pull() {} }), {
							headers: { "content-type": realtime.streamMediaType },
						});
					if (mode === "version") return new Response(null, { status: 426 });
					if (mode === "resource") throw new Error("RESOURCE_LIMIT");
					const scopeId = request.headers.get("x-questpie-realtime-scope");
					return new Response(
						`data: ${JSON.stringify({ kind: "closed", protocol: realtime.protocol, reason: "terminal", retryable: false, scopeId })}\n\n`,
						{ headers: { "content-type": realtime.streamMediaType } },
					);
				},
			});
			const stop = client
				.withContext({ companyId: "company:one" })
				.queries["messages.page"].watch(
					{
						after: null,
						channelId: "00000000-0000-4000-8000-000000000001",
						first: 20,
					},
					() => undefined,
					{ onError: ({ code }) => terminal.resolve(code) },
				);
			expect(await terminal.promise).toBe(expectedCode);
			await Bun.sleep(20);
			expect(downstreams).toBe(1);
			stop();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
);

test("captures canonical input and shares one watch across independent subscriptions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-watch-"));
	try {
		await installQuestpieForTracer(directory);
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
		await installQuestpieForTracer(directory);
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
		await installQuestpieForTracer(directory);
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

test("evicts the true idle LRU after an existing observation is touched", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-lru-"));
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(join(directory, "client.ts"), renderClient());
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;
		const method = generated
			.createClient({
				baseUrl: "http://runtime.test",
				fetch: async () => {
					throw new Error("idle LRU performed I/O");
				},
			})
			.withContext({ companyId: "company:one" }).queries["messages.page"];
		const resources = Array.from({ length: 128 }, (_, index) =>
			method.observe({
				after: null,
				channelId: "00000000-0000-4000-8000-000000000001",
				first: index + 1,
			}),
		);
		expect(
			method.observe({
				after: null,
				channelId: "00000000-0000-4000-8000-000000000001",
				first: 1,
			}),
		).toBe(resources[0]);
		method.observe({
			after: null,
			channelId: "00000000-0000-4000-8000-000000000001",
			first: 129,
		});
		expect(resources[0]?.getSnapshot()).toEqual({
			connection: { kind: "idle" },
			kind: "pending",
		});
		expect(resources[1]?.getSnapshot()).toEqual({
			failure: { code: "RESOURCE_LIMIT" },
			kind: "failed",
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("rejects late delivery and failure from reopened and evicted generations", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-stale-"));
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "resource.ts"),
			renderQueryResourceHarness(),
		);
		const harness = (await import(
			`${pathToFileURL(join(directory, "resource.ts")).href}?${crypto.randomUUID()}`
		)) as QueryResourceHarnessModule;
		const watches: ControlledWatch[] = [];
		let stops = 0;
		const registry = harness.createQueryResourceRegistry(
			(_query, _input, callback, options) => {
				watches.push({ callback, options });
				let active = true;
				return () => {
					if (!active) return;
					active = false;
					stops += 1;
				};
			},
		);
		const resource = registry.observe("query:messages.page", { first: 1 });
		const stopFirst = resource.subscribe(() => undefined);
		watches[0]?.callback({ value: "first" }, { kind: "initial" });
		stopFirst();
		const stopSecond = resource.subscribe(() => undefined);
		const reopened = resource.getSnapshot();
		watches[0]?.callback({ value: "late-delivery" }, { kind: "update" });
		watches[0]?.options.onError?.({ code: "TRANSPORT_FAILED" });
		expect(resource.getSnapshot()).toBe(reopened);
		expect(registry.observe("query:messages.page", { first: 1 })).toBe(
			resource,
		);
		watches[1]?.callback({ value: "fresh" }, { kind: "update" });
		stopSecond();
		expect(stops).toBe(2);

		for (let index = 0; index < 128; index += 1)
			registry.observe("query:other", { index });
		expect(resource.getSnapshot()).toEqual({
			failure: { code: "RESOURCE_LIMIT" },
			kind: "failed",
		});
		const replacement = registry.observe("query:messages.page", { first: 1 });
		expect(replacement).not.toBe(resource);
		const stopReplacement = replacement.subscribe(() => undefined);
		const replacementBeforeLateWork = replacement.getSnapshot();
		watches[1]?.callback({ value: "evicted-delivery" }, { kind: "update" });
		watches[1]?.options.onError?.({ code: "TRANSPORT_FAILED" });
		expect(replacement.getSnapshot()).toBe(replacementBeforeLateWork);
		expect(registry.observe("query:messages.page", { first: 1 })).toBe(
			replacement,
		);
		stopReplacement();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("retains complete data through reconnect and cancels stale reconnect work", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-qri01-reconnect-"));
	try {
		await installQuestpieForTracer(directory);
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
