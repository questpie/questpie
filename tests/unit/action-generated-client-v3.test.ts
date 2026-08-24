import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";

const mediaType = "application/vnd.questpie.operation+json;version=1";
const protocol = Object.freeze({ name: "questpie.operation", version: 1 });

type Generated = Readonly<{
	ActionOutcomeAmbiguous: new (...args: never[]) => Error;
	createClient(
		input: Readonly<{
			baseUrl: string;
			fetch(request: Request): Promise<Response>;
		}>,
	): Readonly<{
		withContext(input: Readonly<Record<string, never>>): Readonly<{
			actions: Readonly<{
				"delivery.publish"(
					input: Readonly<{ credential: string; message: string }>,
					options: Readonly<{
						callId: string;
						effectKey: string;
						signal?: AbortSignal;
						timeoutMilliseconds?: number;
					}>,
				): Promise<unknown>;
			}>;
		}>;
	}>;
}>;

async function generatedClient(): Promise<
	Readonly<{ directory: string; module: Generated }>
> {
	const directory = await mkdtemp(join(tmpdir(), "questpie-action-client-v3-"));
	await writeFile(
		join(directory, "app.ts"),
		"export type AppContextInput = Readonly<Record<string, never>>;\n",
	);
	await writeFile(
		join(directory, "client.ts"),
		renderClientContract(
			[
				{
					kind: "action",
					name: "delivery.publish",
					identity: "action:delivery.publish",
					contract: {
						exposure: "network",
						input: {
							kind: "object",
							properties: {
								credential: { kind: "text" },
								message: { kind: "text" },
							},
						},
						output: {
							kind: "object",
							properties: { receipt: { kind: "text" } },
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
				mediaType,
			},
		),
	);
	return Object.freeze({
		directory,
		module: (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as Generated,
	});
}

function validFrame(callId: string) {
	return {
		protocol,
		kind: "result",
		operation: "action:delivery.publish",
		callId,
		payload: { receipt: "ok" },
	};
}

test("Action client makes one call and closes all eight ambiguity families", async () => {
	const generated = await generatedClient();
	try {
		const callId = "call:action-ambiguity";
		const secret = "provider-secret-never-disclose";
		const cases: readonly Readonly<{
			name: string;
			fetch(request: Request): Promise<Response>;
		}>[] = [
			{
				name: "fetchRejectedAfterDispatch",
				fetch: async () => Promise.reject(new Error(secret)),
			},
			{
				name: "responseLostAfterDispatch",
				fetch: async () => Promise.reject(new TypeError(`lost ${secret}`)),
			},
			{
				name: "cancellationRaceAfterDispatch",
				fetch: async (request) =>
					new Promise((_resolve, reject) =>
						request.signal.addEventListener(
							"abort",
							() => reject(request.signal.reason),
							{ once: true },
						),
					),
			},
			{
				name: "malformedContentTypeAfterDispatch",
				fetch: async () =>
					new Response(JSON.stringify(validFrame(callId)), {
						headers: { "content-type": "text/plain" },
					}),
			},
			{
				name: "invalidJsonAfterDispatch",
				fetch: async () =>
					new Response("{", { headers: { "content-type": mediaType } }),
			},
			{
				name: "unknownFrameAfterDispatch",
				fetch: async () =>
					new Response(JSON.stringify({ kind: "mystery", secret }), {
						headers: { "content-type": mediaType },
					}),
			},
			{
				name: "miscorrelatedFrameAfterDispatch",
				fetch: async () =>
					new Response(JSON.stringify(validFrame("wrong-call")), {
						headers: { "content-type": mediaType },
					}),
			},
			{
				name: "connectionTruncatedAfterDispatch",
				fetch: async () =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode("{"));
								controller.error(new Error(secret));
							},
						}),
						{ headers: { "content-type": mediaType } },
					),
			},
		];

		for (const candidate of cases) {
			let calls = 0;
			const controller = new AbortController();
			const client = generated.module.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request) => {
					calls += 1;
					if (candidate.name === "cancellationRaceAfterDispatch")
						queueMicrotask(() => controller.abort(new Error(secret)));
					return candidate.fetch(request);
				},
			});
			const pending = client.withContext({}).actions["delivery.publish"](
				{ credential: secret, message: "hello" },
				{
					callId,
					effectKey: "effect-key-never-disclose",
					...(candidate.name === "cancellationRaceAfterDispatch"
						? { signal: controller.signal }
						: {}),
				},
			);
			await pending.catch((error: unknown) => {
				expect(error, candidate.name).toBeInstanceOf(
					generated.module.ActionOutcomeAmbiguous,
				);
				expect(error).toMatchObject({
					code: "ACTION_OUTCOME_AMBIGUOUS",
					retryable: false,
					payload: { callId },
				});
				expect(JSON.stringify(error)).not.toContain(secret);
				expect(JSON.stringify(error)).not.toContain(
					"effect-key-never-disclose",
				);
			});
			expect(calls, candidate.name).toBe(1);
		}
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});

test("Action client rejects invalid metadata and prior cancellation before transport", async () => {
	const generated = await generatedClient();
	try {
		let calls = 0;
		const client = generated.module.createClient({
			baseUrl: "http://runtime.test",
			fetch: async () => {
				calls += 1;
				return new Response();
			},
		});
		const action = client.withContext({}).actions["delivery.publish"];
		await expect(
			action(
				{ credential: "secret", message: "hello" },
				{ callId: "call:invalid", effectKey: "e\u0301" },
			),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		const controller = new AbortController();
		const reason = new Error("caller cancellation");
		controller.abort(reason);
		await expect(
			action(
				{ credential: "secret", message: "hello" },
				{
					callId: "call:cancelled",
					effectKey: "stable",
					signal: controller.signal,
				},
			),
		).rejects.toBe(reason);
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		await expect(
			action(cyclic as never, {
				callId: "call:cyclic",
				effectKey: "stable",
			}),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		await expect(
			action({ credential: 1n, message: "hello" } as never, {
				callId: "call:bigint",
				effectKey: "stable",
			}),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		expect(calls).toBe(0);
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});

test("Action client sends no implicit deadline and preserves a safe-integer caller limit", async () => {
	const generated = await generatedClient();
	try {
		const observed: unknown[] = [];
		const client = generated.module.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				observed.push(await request.json());
				const callId = String(
					(observed.at(-1) as Readonly<{ callId: unknown }>).callId,
				);
				return new Response(JSON.stringify(validFrame(callId)), {
					headers: { "content-type": mediaType },
				});
			},
		});
		const action = client.withContext({}).actions["delivery.publish"];
		await action(
			{ credential: "secret", message: "implicit" },
			{ callId: "call:implicit", effectKey: "stable" },
		);
		await action(
			{ credential: "secret", message: "maximum" },
			{
				callId: "call:maximum",
				effectKey: "stable",
				timeoutMilliseconds: Number.MAX_SAFE_INTEGER,
			},
		);
		expect(observed).toMatchObject([
			{ timeoutMilliseconds: null },
			{ timeoutMilliseconds: Number.MAX_SAFE_INTEGER },
		]);
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});

test("Action client preserves a correlated PROTOCOL_UNSUPPORTED framework failure", async () => {
	const generated = await generatedClient();
	try {
		const callId = "call:framework-failure";
		let calls = 0;
		const client = generated.module.createClient({
			baseUrl: "http://runtime.test",
			fetch: async () => {
				calls += 1;
				return new Response(
					JSON.stringify({
						callId,
						error: { code: "PROTOCOL_UNSUPPORTED", retryable: false },
						kind: "failure",
						operation: "action:delivery.publish",
						protocol,
					}),
					{ status: 400, headers: { "content-type": mediaType } },
				);
			},
		});
		await client
			.withContext({})
			.actions["delivery.publish"](
				{ credential: "secret", message: "hello" },
				{ callId, effectKey: "stable" },
			)
			.catch((error: unknown) => {
				expect(error).not.toBeInstanceOf(
					generated.module.ActionOutcomeAmbiguous,
				);
				expect(error).toMatchObject({
					code: "PROTOCOL_UNSUPPORTED",
					retryable: false,
				});
			});
		expect(calls).toBe(1);
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});
