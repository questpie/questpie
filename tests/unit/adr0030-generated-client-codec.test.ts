import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
	renderClientContract,
	renderCodecType,
} from "../../packages/compiler/src/runtime/client";

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

test("generated declarations preserve lossless scalar runtime value types", () => {
	expect(renderCodecType(output)).toBe(
		'Readonly<{ readonly "amount": string; readonly "at": Date; readonly "day": string; readonly "metadata": Readonly<{ readonly kind: "json"; readonly value: unknown }>; readonly "sequence": string; readonly "title": string; }>',
	);
});

test("generated client decodes and enforces lossless Operation outputs", async () => {
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
						identity: "query:reports.read",
						kind: "query",
						name: "reports.read",
						contract: {
							exposure: "network",
							input: { kind: "object", properties: {} },
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
					queries: Record<string, (input: {}) => Promise<unknown>>;
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
					const callId = String(
						((await request.json()) as { callId: string }).callId,
					);
					return new Response(
						JSON.stringify({
							protocol: { name: "questpie.operation", version: 1 },
							kind: "result",
							operation: "query:reports.read",
							callId,
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
			return client.withContext({}).queries["reports.read"]!({});
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
