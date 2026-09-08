import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";
import { installQuestpieForTracer } from "../support/beta12-packed-questpie";
import {
	http02ActionIdentity,
	http02Context,
	http02ContextCodec,
	http02InputCodec,
	http02MutationIdentity,
	http02OutputCodec,
} from "../support/http02-contract";

test("generated Mutation and Action use exact canonical POST endpoints", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-http02-client-"));
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ tenantId: string }>;\n",
		);
		const clientSource = renderClientContract(
			[
				{
					identity: http02MutationIdentity,
					kind: "mutation",
					name: "messages.publish",
					contract: {
						exposure: "network",
						input: http02InputCodec,
						output: http02OutputCodec,
						declaredErrors: {},
					},
				},
				{
					identity: http02ActionIdentity,
					kind: "action",
					name: "delivery.send",
					contract: {
						exposure: "network",
						input: http02InputCodec,
						output: http02OutputCodec,
						declaredErrors: {},
					},
				},
			] as never,
			{
				application: "application:test",
				clientContractDigest: "1".repeat(64),
				httpContractDigest: "2".repeat(64),
				contextCodec: http02ContextCodec,
			},
		);
		expect(clientSource).toContain(
			"UNAUTHENTICATED: Object.freeze({ status: 401, retryable: false })",
		);
		await writeFile(join(directory, "client.ts"), clientSource);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as {
			createClient(input: {
				baseUrl: string;
				fetch(request: Request): Promise<Response>;
			}): {
				withContext(context: { tenantId: string }): {
					mutations: Record<
						string,
						(
							input: { value: string },
							options: { callId: string; timeoutMilliseconds?: number },
						) => Promise<{ ok: boolean }>
					>;
					actions: Record<
						string,
						(
							input: { value: string },
							options: { effectKey: string; callId?: string },
						) => Promise<{ ok: boolean }>
					>;
				};
			};
		};
		const requests: Request[] = [];
		const client = generated
			.createClient({
				baseUrl: "https://runtime.test/prefix",
				fetch: async (request) => {
					requests.push(request);
					if (
						request.url.includes("/_questpie/action/") &&
						(await request.clone().text()).includes("ambiguous")
					)
						throw new TypeError("response lost after dispatch");
					return new Response(
						JSON.stringify({
							callId:
								request.headers.get("Questpie-Call-Id") ??
								decodeURIComponent(
									request.headers.get("Idempotency-Key") ?? "",
								),
							result: { ok: true },
						}),
						{
							headers: {
								"content-type": "application/json; charset=utf-8",
							},
						},
					);
				},
			})
			.withContext(http02Context);

		await expect(
			client.mutations["messages.publish"]!(
				{ value: "mutation" },
				{ callId: "mutation key,é", timeoutMilliseconds: 5000 },
			),
		).resolves.toEqual({ ok: true });
		await expect(
			client.mutations["messages.publish"]!(
				{ value: "mutation" },
				{ callId: "mutation key,é", timeoutMilliseconds: 5000 },
			),
		).resolves.toEqual({ ok: true });
		await expect(
			client.actions["delivery.send"]!(
				{ value: "action" },
				{ effectKey: "effect key,é", callId: "action-call" },
			),
		).resolves.toEqual({ ok: true });
		await expect(
			client.actions["delivery.send"]!(
				{ value: "ambiguous" },
				{ effectKey: "ambiguous-effect", callId: "ambiguous-call" },
			),
		).rejects.toMatchObject({
			code: "ACTION_OUTCOME_AMBIGUOUS",
			payload: { callId: "ambiguous-call" },
			retryable: false,
		});

		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			"/_questpie/mutation/messages.publish",
			"/_questpie/mutation/messages.publish",
			"/_questpie/action/delivery.send",
			"/_questpie/action/delivery.send",
		]);
		for (const request of requests) {
			expect(request.method).toBe("POST");
			expect(request.headers.get("content-type")).toBe("application/json");
			expect(await request.clone().json()).toEqual({
				context: http02Context,
				input: expect.objectContaining({ value: expect.any(String) }),
			});
		}
		expect(requests[0]!.headers.get("Idempotency-Key")).toBe(
			"mutation%20key%2C%C3%A9",
		);
		expect(requests[0]!.headers.get("Questpie-Call-Id")).toBeNull();
		expect(requests[0]!.headers.get("Effect-Key")).toBeNull();
		expect(requests[1]!.headers.get("Idempotency-Key")).toBe(
			"mutation%20key%2C%C3%A9",
		);
		expect(requests[2]!.headers.get("Effect-Key")).toBe(
			"effect%20key%2C%C3%A9",
		);
		expect(requests[2]!.headers.get("Questpie-Call-Id")).toBe("action-call");
		expect(requests[2]!.headers.get("Idempotency-Key")).toBeNull();
		expect(requests[0]!.headers.get("Questpie-Timeout-Milliseconds")).toBe(
			"5000",
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
