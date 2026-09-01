import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderClientContract } from "../../../../packages/compiler/src/runtime/client";
import type { NormalizedResource } from "../../../../packages/compiler/src/types";

const scalarMembers = {
	big: { kind: "bigint" },
	count: { kind: "integer" },
	cursor: { kind: "cursor" },
	day: { kind: "date" },
	money: { kind: "numeric", precision: 8, scale: 2 },
	search: { kind: "text", maxLength: 20 },
	tags: { kind: "array", maximum: 2, items: { kind: "text", maxLength: 8 } },
	when: { kind: "timestamp", withTimezone: true },
	id: { kind: "uuid" },
	nested: { kind: "object", properties: { enabled: { kind: "boolean" } } },
} as const;
const codec = { kind: "object", properties: scalarMembers } as const;
const outputCodec = {
	kind: "object",
	properties: Object.fromEntries(
		Object.entries(scalarMembers).filter(([name]) => name !== "cursor"),
	),
} as const;
const resource = {
	identity: "query:codec.all",
	kind: "query",
	name: "codec.all",
	contract: {
		exposure: "network",
		input: codec,
		output: outputCodec,
		declaredErrors: {},
	},
	contributions: [],
	origin: {
		logicalPath: "codec.ts",
		exportName: "all",
		packageId: null,
		span: null,
		memberSpans: {},
	},
	value: {},
} satisfies NormalizedResource;

test("the accepted generated-client codec performs the wire round trip", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-http-codec-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ tenantId: string }>;\n",
		);
		await writeFile(
			join(directory, "client.ts"),
			renderClientContract([resource], {
				application: "application:codec-proof",
				clientContractDigest: "a".repeat(64),
				wireDigest: "b".repeat(64),
				path: "/_questpie/operation",
				mediaType: "application/vnd.questpie.operation+json;version=1",
			}),
		);
		const { createClient } = await import(join(directory, "client.ts"));
		let request: Record<string, unknown> | undefined;
		const input = {
			big: "9223372036854775807",
			count: 9007199254740991,
			cursor: "opaque-cursor",
			day: "2026-09-01",
			money: "123456.78",
			search: "~literal",
			tags: ["one", "two"],
			when: new Date("2026-09-01T10:11:12.345Z"),
			id: "018f3b79-b78e-7f08-936d-81e995fd2251",
			nested: { enabled: true },
		};
		const client = createClient({
			baseUrl: "https://example.test",
			fetch: async (requestInfo: RequestInfo | URL, init?: RequestInit) => {
				const body =
					requestInfo instanceof Request
						? await requestInfo.text()
						: String(init?.body);
				request = JSON.parse(body);
				return new Response(
					JSON.stringify({
						protocol: { name: "questpie.operation", version: 1 },
						kind: "result",
						operation: "query:codec.all",
						callId: "codec-call",
						payload: Object.fromEntries(
							Object.entries(request!.input as Record<string, unknown>).filter(
								([name]) => name !== "cursor",
							),
						),
					}),
					{
						status: 200,
						headers: {
							"content-type":
								"application/vnd.questpie.operation+json;version=1",
						},
					},
				);
			},
		});
		const result = await client
			.withContext({ tenantId: input.id })
			.queries["codec.all"](input, { callId: "codec-call" });
		expect(request?.context).toEqual({ tenantId: input.id });
		expect(request?.input).toMatchObject({
			...input,
			when: "2026-09-01T10:11:12.345Z",
		});
		expect(result.when).toEqual(input.when);
		await expect(
			client
				.withContext({ tenantId: input.id })
				.queries["codec.all"](
					{ ...input, count: -0 },
					{ callId: "codec-call" },
				),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		await expect(
			client
				.withContext({ tenantId: input.id })
				.queries["codec.all"](
					{ ...input, big: "9223372036854775808" },
					{ callId: "codec-call" },
				),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		await expect(
			client
				.withContext({ tenantId: input.id })
				.queries["codec.all"](
					{ ...input, money: "1234567.89" },
					{ callId: "codec-call" },
				),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
