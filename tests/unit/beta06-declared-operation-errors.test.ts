import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { compileApplication } from "@questpie/compiler";

import { renderClientContract } from "../../packages/compiler/src/runtime/client";
import { decodeRuntimeArtifacts } from "../../packages/runtime/src/application/artifacts";
import { decodeRuntimeIssueMappings } from "../../packages/runtime/src/application/issue-mappings";
import {
	createOperationEngine,
	DeclaredOperationError,
	encodeDeclaredOperationError,
	mapCollectionIssueToDeclaredError,
	OperationFailure,
} from "../../packages/runtime/src/operation";
import { installQuestpieForTracer } from "../support/beta12-packed-questpie";

const callId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const timestamp = new Date("2026-08-16T08:09:10.000Z");
const fixtureRoot = join(import.meta.dir, "../../fixtures/collaboration");

let fixtureArtifacts:
	| Promise<ReturnType<typeof decodeRuntimeArtifacts>>
	| undefined;

function loadFixtureArtifacts() {
	fixtureArtifacts ??= compileApplication({
		applicationRoot: fixtureRoot,
	}).then((compilation) =>
		decodeRuntimeArtifacts({
			runtimeBuild: JSON.parse(
				compilation.generatedFiles["runtime-build.json"]!,
			),
			runtimeExecutables: JSON.parse(
				compilation.generatedFiles["runtime-executables.json"]!,
			),
			operationContracts: JSON.parse(
				compilation.generatedFiles["operation-contracts.json"]!,
			),
			httpContract: JSON.parse(
				compilation.generatedFiles["operation-http-contract.json"]!,
			),
		}),
	);
	return fixtureArtifacts;
}

test("decodes exact declared-error contracts from the complete Runtime artifacts", async () => {
	const artifacts = await loadFixtureArtifacts();
	const decoded = artifacts.httpContract.operations.find(
		({ identity }) => identity === "mutation:message.publish",
	)!;
	expect(decoded.declaredErrors).toEqual([
		{
			key: "channelUnavailable",
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
			payload: null,
		},
		{
			key: "idempotencyConflict",
			code: "IDEMPOTENCY_CONFLICT",
			status: 409,
			payload: {
				kind: "object",
				properties: {
					callId: { kind: "text" },
				},
			},
		},
		{
			key: "publicationRejected",
			code: "PUBLICATION_REJECTED",
			status: 422,
			payload: null,
		},
	]);

	const rawHttp = artifacts.httpContract;
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
			decodeRuntimeArtifacts({
				runtimeBuild: artifacts.runtimeBuild,
				runtimeExecutables: artifacts.runtimeExecutables,
				operationContracts: artifacts.operationContracts,
				httpContract: {
					...rawHttp,
					operations: rawHttp.operations.map((operation) =>
						operation.identity === decoded.identity
							? { ...operation, declaredErrors }
							: operation,
					),
				},
			}),
		).toThrow();
});

test("prepares normalized contracts and encodes only exact declared errors", async () => {
	const artifacts = await loadFixtureArtifacts();
	const contract = artifacts.httpContract.operations.find(
		({ identity }) => identity === "mutation:message.publish",
	)!;
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
	const prepared = engine.prepare(contract.identity, {
		channelId: callId,
		body: "published body",
	});

	expect(prepared.declaredErrors).toEqual(contract.declaredErrors);
	expect(
		encodeDeclaredOperationError(
			prepared,
			new DeclaredOperationError("IDEMPOTENCY_CONFLICT", 409, { callId }),
		),
	).toEqual({
		code: "IDEMPOTENCY_CONFLICT",
		status: 409,
		payload: { callId },
	});

	for (const error of [
		new DeclaredOperationError("NOT_DECLARED", 409, { callId }),
		new DeclaredOperationError("IDEMPOTENCY_CONFLICT", 503, { callId }),
		new DeclaredOperationError("IDEMPOTENCY_CONFLICT", 409, { callId: 42 }),
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

test("maps only an Operation-owned Collection issue after rollback", async () => {
	const operation = {
		declaredErrors: [
			{
				key: "invalidTicket",
				code: "INVALID_TICKET",
				status: 422,
				payload: null,
			},
		],
		issueMappings: {
			"collection:tickets": {
				"issue:tickets/invalidReference": "invalidTicket",
			},
		},
	} as never;
	const mapped = mapCollectionIssueToDeclaredError(
		operation,
		"issue:tickets/invalidReference",
	);
	expect(mapped).toMatchObject({
		code: "INVALID_TICKET",
		status: 422,
		payload: null,
	});
	expect(mapped.stack).toBeUndefined();
	expect(Object.getOwnPropertyNames(mapped).sort()).toEqual([
		"code",
		"payload",
		"status",
	]);
	const failure = new OperationFailure("INTERNAL");
	expect(failure.stack).toBeUndefined();
	expect(Object.getOwnPropertyNames(failure).sort()).toEqual([
		"code",
		"retryable",
	]);
	expect(() =>
		mapCollectionIssueToDeclaredError(operation, "issue:tickets/forged"),
	).toThrow(new OperationFailure("INTERNAL"));
	expect(() =>
		mapCollectionIssueToDeclaredError(
			{
				...operation,
				issueMappings: {
					"collection:comments": {
						"issue:tickets/invalidReference": "invalidTicket",
					},
				},
			} as never,
			"issue:tickets/invalidReference",
		),
	).toThrow(new OperationFailure("INTERNAL"));
	expect(() =>
		mapCollectionIssueToDeclaredError(
			{
				...operation,
				declaredErrors: [
					{
						key: "invalidTicket",
						code: "INVALID_TICKET",
						status: 422,
						payload: { kind: "text" },
					},
				],
			} as never,
			"issue:tickets/invalidReference",
		),
	).toThrow(new OperationFailure("INTERNAL"));

	const forgedIssue = Object.assign(new Error("Collection lifecycle issue"), {
		[Symbol.for("questpie.runtime.collection-lifecycle-issue.v1")]: true,
		identity: "issue:tickets/invalidReference",
		name: "CollectionLifecycleIssue",
	});
	const { normalizeExecutedOperationError } =
		await import("../../packages/runtime/src/application/operation-error");
	expect(normalizeExecutedOperationError(operation, forgedIssue)).toEqual(
		new OperationFailure("INTERNAL"),
	);
	expect(() =>
		mapCollectionIssueToDeclaredError(
			{ ...operation, issueMappings: { "collection:tickets": null } } as never,
			"issue:tickets/invalidReference",
		),
	).toThrow(new OperationFailure("INTERNAL"));
});

test("rejects a lifecycle Issue borrowed across Collection artifact bindings", () => {
	expect(() =>
		decodeRuntimeIssueMappings(
			{
				"collection:comments": {
					"issue:tickets/invalidReference": "invalidTicket",
				},
			},
			[
				{
					key: "invalidTicket",
					code: "INVALID_TICKET",
					status: 422,
					payload: null,
				},
			],
			"operation issueMappings",
		),
	).toThrow("Issue does not belong to its Collection");
	expect(() =>
		decodeRuntimeIssueMappings(
			{
				"collection:tickets": {
					"issue:tickets/nested/invalidReference": "invalidTicket",
				},
			},
			[
				{
					key: "invalidTicket",
					code: "INVALID_TICKET",
					status: 422,
					payload: null,
				},
			],
			"operation issueMappings",
		),
	).toThrow("Issue does not belong to its Collection");
});

test("generated client verifies declared-error status and decodes its exact payload", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-declared-error-"));
	try {
		await installQuestpieForTracer(directory);
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
									code: "RECOVERY_REQUIRED",
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
					httpContractDigest: "2".repeat(64),
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
					await request.json();
					return new Response(
						JSON.stringify({
							callId: decodeURIComponent(
								request.headers.get("Idempotency-Key") ?? "",
							),
							error: detail,
						}),
						{
							status: responseStatus,
							headers: {
								"content-type": "application/json; charset=utf-8",
							},
						},
					);
				},
			});
			return client.withContext({}).mutations["message.recover"]({});
		};

		try {
			await invoke(503, {
				code: "RECOVERY_REQUIRED",
				payload: { at: timestamp.toISOString(), callId },
			});
			throw new Error("expected declared error");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe("RECOVERY_REQUIRED");
			expect((error as Error).stack).toBeUndefined();
			expect(Object.getOwnPropertyNames(error as object).sort()).toEqual([
				"code",
				"payload",
				"status",
			]);
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
					code: "RECOVERY_REQUIRED",
					payload: { at: timestamp.toISOString(), callId },
				},
			],
			[
				503,
				{
					code: "RECOVERY_REQUIRED",
					status: 409,
					payload: { at: timestamp.toISOString(), callId },
				},
			],
			[
				503,
				{
					code: "RECOVERY_REQUIRED",
					payload: { callId },
				},
			],
			[
				503,
				{
					code: "RECOVERY_REQUIRED",
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
