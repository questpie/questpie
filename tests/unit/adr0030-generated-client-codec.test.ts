import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	renderClientContract,
	renderCodecType,
} from "../../packages/compiler/src/runtime/client";
import {
	decodeRuntimeCodec,
	decodeRuntimeCodecDescriptor,
	encodeRuntimeCodec,
} from "../../packages/runtime/src/codec";

const output = {
	kind: "object",
	properties: {
		amount: { kind: "numeric", precision: 5, scale: 2 },
		at: { kind: "timestamp", withTimezone: false },
		day: { kind: "date" },
		metadata: { kind: "json" },
		sequence: { kind: "bigint", minimum: "0", maximum: "9" },
		title: { kind: "text", minLength: 2, maxLength: 8 },
	},
} as const;

const input = {
	kind: "object",
	properties: {
		at: { kind: "timestamp", withTimezone: false },
		metadata: { kind: "json" },
	},
} as const;

test("generated declarations preserve lossless scalar runtime value types", () => {
	expect(renderCodecType(output)).toBe(
		'Readonly<{ readonly "amount": string; readonly "at": Date; readonly "day": string; readonly "metadata": TaggedJsonValue; readonly "sequence": string; readonly "title": string; }>',
	);
});

test("compiler-owned input codec encodes no-zone timestamps before transport", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-adr0030-client-"));
	try {
		const runtimeCodec = decodeRuntimeCodecDescriptor(input);
		const directInput = decodeRuntimeCodec<{
			at: Date;
			metadata: { kind: "json"; value: unknown };
		}>(runtimeCodec, {
			at: "2026-08-28T10:20:30.000",
			metadata: { kind: "json", value: { ok: true } },
		});
		const expectedWireInput = encodeRuntimeCodec(runtimeCodec, directInput);

		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<Record<string, never>>;\n",
		);
		await writeFile(
			join(directory, "client.ts"),
			renderClientContract(
				[
					{
						identity: "mutation:reports.read",
						kind: "mutation",
						name: "reports.read",
						contract: {
							exposure: "network",
							input,
							output,
							declaredErrors: {},
						},
					},
				] as never,
				{
					application: "application:test",
					clientContractDigest: "1".repeat(64),
					wireDigest: "2".repeat(64),
					path: "/_questpie/operation",
					mediaType: "application/vnd.questpie.operation+json;version=1",
				},
			),
		);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as {
			createClient(input: {
				baseUrl: string;
				fetch(request: Request): Promise<Response>;
			}): {
				withContext(input: {}): {
					mutations: Record<
						string,
						(input: {
							at: Date;
							metadata: {
								kind: "json";
								value: unknown;
							};
						}) => Promise<unknown>
					>;
				};
			};
		};
		const payload = {
			amount: "123.45",
			at: "2026-08-28T10:20:30.000",
			day: "2026-08-28",
			metadata: { kind: "json", value: { ok: true } },
			sequence: "9",
			title: "report",
		};
		const invoke = async (next: unknown) => {
			const client = generated.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request) => {
					const frame = (await request.json()) as {
						callId: string;
						input: unknown;
					};
					expect(frame.input).toEqual(expectedWireInput);
					expect(expectedWireInput).toEqual({
						at: "2026-08-28T10:20:30.000",
						metadata: { kind: "json", value: { ok: true } },
					});
					return new Response(
						JSON.stringify({
							protocol: { name: "questpie.operation", version: 1 },
							kind: "result",
							operation: "mutation:reports.read",
							callId: frame.callId,
							payload: next,
						}),
						{
							headers: {
								"content-type":
									"application/vnd.questpie.operation+json;version=1",
							},
						},
					);
				},
			});
			return client.withContext({}).mutations["reports.read"]!({
				...directInput,
			});
		};
		const result = (await invoke(payload)) as typeof payload;
		expect(result).toEqual({
			...payload,
			at: new Date("2026-08-28T10:20:30.000Z"),
		});
		await expect(invoke({ ...payload, amount: "1234.56" })).rejects.toThrow(
			"PROTOCOL_UNSUPPORTED",
		);
		await expect(
			invoke({ ...payload, metadata: { kind: "json", value: "e\u0301" } }),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("compiler-owned input codec rejects lossy tagged JSON before transport", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-adr0030-client-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<Record<string, never>>;\n",
		);
		await writeFile(
			join(directory, "client.ts"),
			renderClientContract(
				[
					{
						identity: "mutation:reports.read",
						kind: "mutation",
						name: "reports.read",
						contract: {
							exposure: "network",
							input,
							output,
							declaredErrors: {},
						},
					},
				] as never,
				{
					application: "application:test",
					clientContractDigest: "1".repeat(64),
					wireDigest: "2".repeat(64),
					path: "/_questpie/operation",
					mediaType: "application/vnd.questpie.operation+json;version=1",
				},
			),
		);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as {
			createClient(input: {
				baseUrl: string;
				fetch(request: Request): Promise<Response>;
			}): {
				withContext(input: {}): {
					mutations: Record<string, (input: unknown) => Promise<unknown>>;
				};
			};
		};
		let transportCalls = 0;
		const call = generated
			.createClient({
				baseUrl: "http://runtime.test",
				fetch: async () => {
					transportCalls += 1;
					throw new Error("transport must not be reached");
				},
			})
			.withContext({}).mutations["reports.read"]!;
		// eslint-disable-next-line no-sparse-arrays -- Lossy JSON transport is the hostile boundary under test.
		const sparse = [, "value"];
		for (const value of [sparse, Number.NaN, -0]) {
			await expect(
				call({
					at: new Date("2026-08-28T10:20:30.000Z"),
					metadata: { kind: "json", value },
				}),
			).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		}
		expect(transportCalls).toBe(0);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("generated transform preserves optional, array, cursor, and object direction", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-adr0030-client-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<Record<string, never>>;\n",
		);
		await writeFile(
			join(directory, "client.ts"),
			renderClientContract(
				[
					{
						identity: "query:reports.list",
						kind: "query",
						name: "reports.list",
						contract: {
							exposure: "network",
							input: {
								kind: "object",
								properties: {
									zonedAt: { kind: "timestamp", withTimezone: true },
									note: {
										kind: "optional",
										codec: { kind: "text", maxLength: 100 },
									},
									items: {
										kind: "array",
										maximum: 2,
										items: { kind: "timestamp", withTimezone: false },
									},
									cursor: { kind: "cursor" },
								},
							},
							output: {
								kind: "object",
								properties: {
									items: {
										kind: "array",
										items: { kind: "timestamp", withTimezone: true },
									},
								},
							},
							declaredErrors: {},
						},
					},
				] as never,
				{
					application: "application:test",
					clientContractDigest: "1".repeat(64),
					wireDigest: "2".repeat(64),
					path: "/_questpie/operation",
					mediaType: "application/vnd.questpie.operation+json;version=1",
				},
			),
		);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as {
			createClient(input: {
				baseUrl: string;
				fetch(request: Request): Promise<Response>;
			}): {
				withContext(input: {}): {
					queries: Record<string, (input: unknown) => Promise<unknown>>;
				};
			};
		};
		let calls = 0;
		const call = generated
			.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request) => {
					calls += 1;
					expect(request.method).toBe("GET");
					expect(request.body).toBeNull();
					const url = new URL(request.url);
					expect([...url.searchParams.keys()]).toEqual([
						"cursor",
						"items",
						"zonedAt",
					]);
					expect(url.searchParams.get("items")).toBe(
						'~json:["2026-08-28T10:20:30.000"]',
					);
					const callId = request.headers.get("Questpie-Call-Id");
					return new Response(
						JSON.stringify({
							callId,
							result: { items: ["2026-08-28T10:20:30.000Z"] },
						}),
						{
							headers: {
								"content-type": "application/json; charset=utf-8",
							},
						},
					);
				},
			})
			.withContext({}).queries["reports.list"]!;
		const result = (await call({
			cursor: "next",
			items: [new Date("2026-08-28T10:20:30.000Z")],
			zonedAt: new Date("2026-08-28T10:20:30.000Z"),
		})) as { items: Date[] };
		expect(result.items).toEqual([new Date("2026-08-28T10:20:30.000Z")]);
		expect(Object.isFrozen(result.items)).toBe(false);
		await expect(
			call({
				cursor: "next",
				items: [],
				unknown: true,
				zonedAt: new Date("2026-08-28T10:20:30.000Z"),
			}),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		expect(calls).toBe(1);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test("generated JSON declarations preserve the exact recursive value grammar", async () => {
	const directory = await mkdtemp(
		join(tmpdir(), "questpie-adr0030-client-types-"),
	);
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<Record<string, never>>;\n",
		);
		await writeFile(
			join(directory, "client.ts"),
			renderClientContract(
				[
					{
						identity: "query:reports.read",
						kind: "query",
						name: "reports.read",
						contract: {
							exposure: "network",
							input,
							output,
							declaredErrors: {},
						},
					},
				] as never,
				{
					application: "application:test",
					clientContractDigest: "1".repeat(64),
					wireDigest: "2".repeat(64),
					path: "/_questpie/operation",
					mediaType: "application/vnd.questpie.operation+json;version=1",
				},
			),
		);
		await writeFile(
			join(directory, "usage.ts"),
			`import { createClient, type JsonValue, type TaggedJsonValue } from "./client.ts";
const value: JsonValue = { nested: [null, true, 1, "text"] };
const tagged: TaggedJsonValue = { kind: "json", value };
const client = createClient({ baseUrl: "http://runtime.test", fetch: globalThis.fetch }).withContext({});
void client.queries["reports.read"]({ at: new Date(), metadata: tagged });
// @ts-expect-error timestamp values are Date at the Operation boundary
void client.queries["reports.read"]({ at: "2026-08-28T10:20:30.000", metadata: tagged });
// @ts-expect-error undefined is outside the recursive JSON value grammar
const undefinedValue: JsonValue = { nested: undefined };
// @ts-expect-error functions are outside the recursive JSON value grammar
const functionValue: TaggedJsonValue = { kind: "json", value: () => true };
void undefinedValue;
void functionValue;
`,
		);
		await writeFile(
			join(directory, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					allowImportingTsExtensions: true,
					lib: ["ESNext", "DOM", "DOM.Iterable"],
					module: "Preserve",
					moduleResolution: "Bundler",
					noEmit: true,
					skipLibCheck: true,
					strict: true,
					target: "ESNext",
				},
				include: ["*.ts"],
			}),
		);
		const typecheck = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "../../node_modules/typescript/bin/tsc"),
				"-p",
				join(directory, "tsconfig.json"),
			],
			{ stderr: "pipe", stdout: "pipe" },
		);
		const [exitCode, stderr, stdout] = await Promise.all([
			typecheck.exited,
			new Response(typecheck.stderr).text(),
			new Response(typecheck.stdout).text(),
		]);
		expect(`${stdout}${stderr}`).toBe("");
		expect(exitCode).toBe(0);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
