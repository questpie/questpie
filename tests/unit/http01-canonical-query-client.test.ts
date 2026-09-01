import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";

type GeneratedClientModule = Readonly<{
	createClient(
		input: Readonly<{
			baseUrl: string;
			fetch(request: Request): Promise<Response>;
		}>,
	): Readonly<{
		withContext(context: Readonly<{ companyId: string }>): Readonly<{
			queries: Readonly<{
				"messages.page"(
					input: Readonly<{
						after: string | null;
						first: number;
						search: string;
					}>,
					options: Readonly<{
						callId: string;
						timeoutMilliseconds: number;
					}>,
				): Promise<Readonly<{ count: number }>>;
			}>;
		}>;
	}>;
}>;

test("generated Query uses its visible bodyless canonical GET endpoint", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-http01-query-"));
	try {
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>\n",
		);
		await writeFile(
			join(directory, "client.ts"),
			renderClientContract(
				[
					{
						kind: "query",
						name: "messages.page",
						identity: "query:messages.page",
						contract: {
							exposure: "network",
							input: {
								kind: "object",
								properties: {
									after: {
										kind: "nullable",
										codec: { kind: "cursor" },
									},
									first: { kind: "integer", minimum: 1, maximum: 100 },
									search: { kind: "text", maxLength: 100 },
								},
							},
							output: {
								kind: "object",
								properties: { count: { kind: "integer" } },
							},
							declaredErrors: {},
						},
					},
				] as never,
				{
					application: "application:collaboration",
					clientContractDigest: "1".repeat(64),
					wireDigest: "2".repeat(64),
					path: "/_questpie/operation",
					mediaType: "application/vnd.questpie.operation+json;version=1",
					contextCodec: {
						kind: "object",
						properties: { companyId: { kind: "uuid" } },
					},
				} as never,
			),
		);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as GeneratedClientModule;

		let observed: Request | undefined;
		const client = generated.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				observed = request.clone();
				return new Response(
					JSON.stringify({ callId: "query-visible-1", result: { count: 20 } }),
					{
						status: 200,
						headers: { "content-type": "application/json; charset=utf-8" },
					},
				);
			},
		});
		const result = await client
			.withContext({
				companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			})
			.queries["messages.page"](
				{ after: null, first: 20, search: "one two" },
				{ callId: "query-visible-1", timeoutMilliseconds: 5_000 },
			);

		expect(result).toEqual({ count: 20 });
		expect(observed?.method).toBe("GET");
		expect(observed?.url).toBe(
			"http://runtime.test/_questpie/query/messages.page?after=~null&first=20&search=one%20two",
		);
		expect(observed?.body).toBeNull();
		expect(observed?.headers.get("Questpie-Context")).toBe(
			"eyJjb21wYW55SWQiOiIwMThmNWY2ZS01ZjJjLTdiNDEtYTg1NC0zZDlhNmI2YjYxYTAifQ",
		);
		expect(observed?.headers.get("Questpie-Call-Id")).toBe("query-visible-1");
		expect(observed?.headers.get("Questpie-Timeout-Milliseconds")).toBe("5000");
		expect(observed?.headers.get("Questpie-Application")).toBe(
			"application:collaboration",
		);
		expect(observed?.headers.get("Questpie-Client-Contract")).toBe(
			"1".repeat(64),
		);
		expect(observed?.headers.get("Questpie-Wire-Digest")).toBe("2".repeat(64));
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
