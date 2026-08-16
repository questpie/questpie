import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";
import { decodeOperationWireContract } from "../../packages/runtime/src/application/artifacts";
import {
	createOperationEngine,
	DeclaredOperationError,
	encodeDeclaredOperationError,
	OperationFailure,
} from "../../packages/runtime/src/operation";

const callId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const timestamp = new Date("2026-08-16T08:09:10.000Z");

function wireOperation(declaredErrors: unknown) {
	return {
		identity: "mutation:message.publish",
		input: { kind: "object", properties: {} },
		output: { kind: "object", properties: {} },
		declaredErrors,
	};
}

test("decodes exact declared-error contracts from the operation wire artifact", () => {
	const decoded = decodeOperationWireContract(
		wireOperation({
			committedResultUnavailable: {
				code: "COMMITTED_RESULT_UNAVAILABLE",
				status: 503,
				payload: {
					kind: "object",
					properties: {
						at: { kind: "timestamp" },
						callId: { kind: "uuid" },
					},
				},
			},
			channelUnavailable: {
				code: "CHANNEL_UNAVAILABLE",
				status: 404,
				payload: null,
			},
		}),
		0,
	);

	expect(decoded.declaredErrors).toEqual([
		{
			key: "channelUnavailable",
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
			payload: null,
		},
		{
			key: "committedResultUnavailable",
			code: "COMMITTED_RESULT_UNAVAILABLE",
			status: 503,
			payload: {
				kind: "object",
				properties: {
					at: { kind: "timestamp" },
					callId: { kind: "uuid" },
				},
			},
		},
	]);

	for (const declaredErrors of [
		{
			bad: { code: "BAD", status: 400, payload: null, authority: "system" },
		},
		{ bad: { code: "BAD", status: 200, payload: null } },
		{ bad: { code: "BAD", status: 400, payload: { kind: "unknown" } } },
		{
			first: { code: "DUPLICATE", status: 400, payload: null },
			second: { code: "DUPLICATE", status: 409, payload: null },
		},
	])
		expect(() =>
			decodeOperationWireContract(wireOperation(declaredErrors), 0),
		).toThrow();
});

test("prepares normalized contracts and encodes only exact declared errors", () => {
	const contract = decodeOperationWireContract(
		wireOperation({
			committedResultUnavailable: {
				code: "COMMITTED_RESULT_UNAVAILABLE",
				status: 503,
				payload: {
					kind: "object",
					properties: {
						at: { kind: "timestamp" },
						callId: { kind: "uuid" },
					},
				},
			},
		}),
		0,
	);
	const engine = createOperationEngine(
		[
			{
				identity: contract.identity,
				kind: "mutation",
				slot: "handler",
				runtimeGraphDigest: "0".repeat(64),
				bundleExport: "message_publish",
				execute: () => ({}),
				definition: { name: "message.publish", handler: () => ({}) },
			},
		],
		[contract],
	);
	const prepared = engine.prepare(contract.identity, {});

	expect(prepared.declaredErrors).toEqual(contract.declaredErrors);
	expect(
		encodeDeclaredOperationError(
			prepared,
			new DeclaredOperationError("COMMITTED_RESULT_UNAVAILABLE", 503, {
				at: timestamp,
				callId,
			}),
		),
	).toEqual({
		code: "COMMITTED_RESULT_UNAVAILABLE",
		status: 503,
		payload: { at: timestamp.toISOString(), callId },
	});

	for (const error of [
		new DeclaredOperationError("NOT_DECLARED", 503, { at: timestamp, callId }),
		new DeclaredOperationError("COMMITTED_RESULT_UNAVAILABLE", 409, {
			at: timestamp,
			callId,
		}),
		new DeclaredOperationError("COMMITTED_RESULT_UNAVAILABLE", 503, {
			at: "not-a-Date",
			callId,
		}),
	]) {
		try {
			encodeDeclaredOperationError(prepared, error);
			throw new Error("expected validation failure");
		} catch (caught) {
			expect(caught).toBeInstanceOf(OperationFailure);
			expect((caught as OperationFailure).code).toBe("INTERNAL");
		}
	}
});

test("generated client verifies declared-error status and decodes its exact payload", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-declared-error-"));
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
						kind: "mutation",
						name: "message.recover",
						identity: "mutation:message.recover",
						contract: {
							exposure: "network",
							input: { kind: "object", properties: {} },
							output: { kind: "object", properties: {} },
							declaredErrors: {
								committedResultUnavailable: {
									code: "COMMITTED_RESULT_UNAVAILABLE",
									status: 503,
									payload: {
										kind: "object",
										properties: {
											at: { kind: "timestamp" },
											callId: { kind: "uuid" },
										},
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
					mediaType: "application/vnd.questpie.operation+json;version=1",
				},
			),
		);
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as Readonly<{
			createClient(
				input: Readonly<{
					baseUrl: string;
					fetch(request: Request): Promise<Response>;
				}>,
			): Readonly<{
				withContext(context: Readonly<Record<string, never>>): Readonly<{
					mutations: Readonly<{
						"message.recover"(
							input: Readonly<Record<string, never>>,
						): Promise<unknown>;
					}>;
				}>;
			}>;
		}>;
		const invoke = async (
			responseStatus: number,
			detail: Readonly<Record<string, unknown>>,
		) => {
			const client = generated.createClient({
				baseUrl: "http://runtime.test",
				fetch: async (request) => {
					const sent = (await request.json()) as Readonly<{
						callId: string;
						operation: string;
					}>;
					return new Response(
						JSON.stringify({
							protocol: { name: "questpie.operation", version: 1 },
							kind: "declaredError",
							operation: sent.operation,
							callId: sent.callId,
							error: detail,
						}),
						{
							status: responseStatus,
							headers: {
								"content-type":
									"application/vnd.questpie.operation+json;version=1",
							},
						},
					);
				},
			});
			return client.withContext({}).mutations["message.recover"]({});
		};

		try {
			await invoke(503, {
				code: "COMMITTED_RESULT_UNAVAILABLE",
				status: 503,
				payload: { at: timestamp.toISOString(), callId },
			});
			throw new Error("expected declared error");
		} catch (error) {
			expect((error as Error).message).toBe("COMMITTED_RESULT_UNAVAILABLE");
			expect((error as { status: number }).status).toBe(503);
			expect((error as { payload: { at: unknown } }).payload.at).toBeInstanceOf(
				Date,
			);
			expect((error as { payload: unknown }).payload).toEqual({
				at: timestamp,
				callId,
			});
		}

		for (const [status, detail] of [
			[
				409,
				{
					code: "COMMITTED_RESULT_UNAVAILABLE",
					status: 503,
					payload: { at: timestamp.toISOString(), callId },
				},
			],
			[
				503,
				{
					code: "COMMITTED_RESULT_UNAVAILABLE",
					status: 409,
					payload: { at: timestamp.toISOString(), callId },
				},
			],
			[
				503,
				{
					code: "COMMITTED_RESULT_UNAVAILABLE",
					status: 503,
					payload: { callId },
				},
			],
			[
				503,
				{
					code: "COMMITTED_RESULT_UNAVAILABLE",
					status: 503,
					payload: { at: timestamp.toISOString(), callId, secret: true },
				},
			],
		] as const)
			await expect(invoke(status, detail)).rejects.toThrow(
				"PROTOCOL_UNSUPPORTED",
			);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
