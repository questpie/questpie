import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";
import {
	CommittedResultUnavailable,
	committedResultUnavailableFrame,
	failureFrame,
	isOperationCallId,
	isPostgresTransactionId,
	operationFailureStatus,
} from "../../packages/runtime/src/operation";

const protocol = Object.freeze({ name: "questpie.operation", version: 1 });
const mediaType = "application/vnd.questpie.operation+json;version=1";

test("accepts only exact Call Identity and canonical xid8 boundaries", () => {
	const fourByteScalar = String.fromCodePoint(0x10ffff);
	for (const value of ["a", "é", "a".repeat(256), fourByteScalar.repeat(256)])
		expect(isOperationCallId(value), JSON.stringify(value.slice(0, 16))).toBe(
			true,
		);
	for (const value of [
		"",
		"e\u0301",
		"before\0after",
		"\ud800",
		"\udc00",
		"a\ud800b",
		"a\udc00b",
		"a".repeat(257),
		fourByteScalar.repeat(257),
	])
		expect(isOperationCallId(value), JSON.stringify(value.slice(0, 16))).toBe(
			false,
		);

	for (const value of ["1", "9", "901", "18446744073709551615"])
		expect(isPostgresTransactionId(value)).toBe(true);
	for (const value of [
		"",
		"0",
		"00",
		"01",
		"+1",
		"-1",
		" 1",
		"1 ",
		"1.0",
		"1e1",
		"18446744073709551616",
		"999999999999999999999",
	])
		expect(isPostgresTransactionId(value)).toBe(false);
});

test("uses one exact committed failure and never widens ordinary failures", () => {
	const correlation = {
		callId: "call:committed",
		operation: "mutation:message.publish",
	};
	const disposition = new CommittedResultUnavailable(
		correlation.callId,
		"18446744073709551615",
		new Error("secret postgres detail"),
	);
	const committed = committedResultUnavailableFrame(correlation, disposition);
	const ordinary = failureFrame(correlation, "INTERNAL");

	expect(operationFailureStatus("COMMITTED_RESULT_UNAVAILABLE")).toBe(500);
	expect(committed).toEqual({
		protocol,
		kind: "failure",
		operation: correlation.operation,
		callId: correlation.callId,
		error: {
			code: "COMMITTED_RESULT_UNAVAILABLE",
			retryable: true,
			transactionId: "18446744073709551615",
		},
	});
	expect(Object.keys(committed).sort()).toEqual([
		"callId",
		"error",
		"kind",
		"operation",
		"protocol",
	]);
	expect(Object.keys(committed.error).sort()).toEqual([
		"code",
		"retryable",
		"transactionId",
	]);
	expect(ordinary).toEqual({
		protocol,
		kind: "failure",
		operation: correlation.operation,
		callId: correlation.callId,
		error: { code: "INTERNAL", retryable: false },
	});
	expect(JSON.stringify(committed)).not.toContain("secret postgres detail");
	expect(Object.isFrozen(disposition)).toBe(true);
	expect(Object.isFrozen(disposition.payload)).toBe(true);
	expect(Object.isFrozen(committed)).toBe(true);
	expect(Object.isFrozen(committed.error)).toBe(true);
});

type GeneratedClientModule = Readonly<{
	CommittedResultUnavailable: new (...args: never[]) => Error;
	createClient(
		input: Readonly<{
			baseUrl: string;
			fetch(request: Request): Promise<Response>;
		}>,
	): Readonly<{
		withContext(input: Readonly<Record<string, never>>): Readonly<{
			queries: Readonly<{
				"health.read"(input: Readonly<Record<string, never>>): Promise<unknown>;
			}>;
			mutations: Readonly<{
				"message.publish"(
					input: Readonly<Record<string, never>>,
					options: Readonly<{ callId: string }>,
				): Promise<unknown>;
			}>;
		}>;
	}>;
}>;

async function generatedClientModule(): Promise<
	Readonly<{
		directory: string;
		module: GeneratedClientModule;
	}>
> {
	const directory = await mkdtemp(join(tmpdir(), "questpie-wire-v2-hostile-"));
	await writeFile(
		join(directory, "app.ts"),
		"export type AppContextInput = Readonly<Record<string, never>>;\n",
	);
	await writeFile(
		join(directory, "client.ts"),
		renderClientContract(
			[
				{
					kind: "query",
					name: "health.read",
					identity: "query:health.read",
					contract: {
						exposure: "network",
						input: { kind: "object", properties: {} },
						output: {
							kind: "object",
							properties: { ok: { kind: "boolean" } },
						},
						declaredErrors: {},
					},
				},
				{
					kind: "mutation",
					name: "message.publish",
					identity: "mutation:message.publish",
					contract: {
						exposure: "network",
						input: { kind: "object", properties: {} },
						output: {
							kind: "object",
							properties: { ok: { kind: "boolean" } },
						},
						declaredErrors: {
							idempotencyConflict: {
								code: "IDEMPOTENCY_CONFLICT",
								status: 409,
								payload: {
									kind: "object",
									properties: { callId: { kind: "text" } },
								},
							},
						},
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
	const module = (await import(
		`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
	)) as GeneratedClientModule;
	return Object.freeze({ directory, module });
}

function wireResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": mediaType },
	});
}

test("generated client carries CRU exactly, freezes it, and never retries", async () => {
	const generated = await generatedClientModule();
	try {
		let requests = 0;
		const client = generated.module.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				requests += 1;
				const sent = (await request.json()) as Readonly<{
					callId: string;
					operation: string;
				}>;
				return wireResponse(
					{
						protocol,
						kind: "failure",
						operation: sent.operation,
						callId: sent.callId,
						error: {
							code: "COMMITTED_RESULT_UNAVAILABLE",
							retryable: true,
							transactionId: "901",
						},
					},
					500,
				);
			},
		});
		const pending = client
			.withContext({})
			.mutations["message.publish"]({}, { callId: "call:one" });
		await pending.catch((error: unknown) => {
			expect(error).toBeInstanceOf(generated.module.CommittedResultUnavailable);
			expect(error).toMatchObject({
				name: "CommittedResultUnavailable",
				code: "COMMITTED_RESULT_UNAVAILABLE",
				retryable: true,
				payload: { callId: "call:one", transactionId: "901" },
			});
			expect(Object.isFrozen(error)).toBe(true);
			expect(Object.isFrozen((error as { payload: object }).payload)).toBe(
				true,
			);
		});
		expect(requests).toBe(1);
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});

test("generated client rejects every wrong CRU frame without widening failures", async () => {
	const generated = await generatedClientModule();
	try {
		const exact = (callId: string) => ({
			protocol,
			kind: "failure",
			operation: "mutation:message.publish",
			callId,
			error: {
				code: "COMMITTED_RESULT_UNAVAILABLE",
				retryable: true,
				transactionId: "901",
			},
		});
		const cases: readonly Readonly<{ body: unknown; status: number }>[] = [
			{ body: exact("wrong-call"), status: 500 },
			{ body: exact("call:hostile"), status: 200 },
			{
				body: {
					...exact("call:hostile"),
					error: { ...exact("call:hostile").error, retryable: false },
				},
				status: 500,
			},
			{
				body: {
					...exact("call:hostile"),
					error: {
						...exact("call:hostile").error,
						transactionId: "0",
					},
				},
				status: 500,
			},
			{
				body: {
					...exact("call:hostile"),
					error: {
						...exact("call:hostile").error,
						secret: "postgres detail",
					},
				},
				status: 500,
			},
			{
				body: {
					kind: "failure",
					error: exact("call:hostile").error,
				},
				status: 500,
			},
			{
				body: {
					...exact("call:hostile"),
					error: {
						code: "INTERNAL",
						retryable: false,
						transactionId: "901",
					},
				},
				status: 500,
			},
		];

		for (const candidate of cases) {
			let requests = 0;
			const client = generated.module.createClient({
				baseUrl: "http://runtime.test",
				fetch: async () => {
					requests += 1;
					return wireResponse(candidate.body, candidate.status);
				},
			});
			await expect(
				client
					.withContext({})
					.mutations["message.publish"]({}, { callId: "call:hostile" }),
			).rejects.toThrow("PROTOCOL_UNSUPPORTED");
			expect(requests).toBe(1);
		}
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});

test("generated wire v2 preserves result and declared-error decoding", async () => {
	const generated = await generatedClientModule();
	try {
		const resultClient = generated.module.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				const sent = (await request.json()) as Readonly<{
					callId: string;
					operation: string;
				}>;
				return wireResponse(
					{
						protocol,
						kind: "result",
						operation: sent.operation,
						callId: sent.callId,
						payload: { ok: true },
					},
					200,
				);
			},
		});
		await expect(
			resultClient.withContext({}).queries["health.read"]({}),
		).resolves.toEqual({ ok: true });

		const declaredClient = generated.module.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				const sent = (await request.json()) as Readonly<{
					callId: string;
					operation: string;
				}>;
				return wireResponse(
					{
						protocol,
						kind: "declaredError",
						operation: sent.operation,
						callId: sent.callId,
						error: {
							code: "IDEMPOTENCY_CONFLICT",
							status: 409,
							payload: { callId: "general:text-call" },
						},
					},
					409,
				);
			},
		});
		await expect(
			declaredClient
				.withContext({})
				.mutations["message.publish"]({}, { callId: "call:declared" }),
		).rejects.toMatchObject({
			code: "IDEMPOTENCY_CONFLICT",
			status: 409,
			payload: { callId: "general:text-call" },
		});
	} finally {
		await rm(generated.directory, { force: true, recursive: true });
	}
});
