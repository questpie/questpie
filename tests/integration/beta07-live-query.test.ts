import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	projectRealtimeWireContract,
	renderClientContract,
} from "../../packages/compiler/src/runtime";
import type { NormalizedResource } from "../../packages/compiler/src/types";
import { installQuestpieForTracer } from "../support/beta12-packed-questpie";

const input = {
	kind: "object",
	properties: {
		after: { codec: { kind: "text" }, kind: "nullable" },
		channelId: { kind: "uuid" },
		first: { kind: "integer" },
	},
} as const;
const output = {
	kind: "object",
	properties: {
		nodes: {
			kind: "array",
			items: {
				kind: "object",
				properties: {
					body: { kind: "text" },
					createdAt: { kind: "timestamp" },
					id: { kind: "uuid" },
				},
			},
		},
	},
} as const;

function resource(
	kind: "mutation" | "query",
	name: string,
): NormalizedResource {
	return {
		identity: `${kind}:${name}`,
		kind,
		name,
		contract: {
			exposure: "network",
			input,
			output,
			declaredErrors: {},
		},
		contributions: [],
		origin: {
			logicalPath: "src/operations.ts",
			exportName: name.replaceAll(".", "_"),
			packageId: null,
			span: null,
			memberSpans: {},
		},
		value: {},
	};
}

const resources = [
	resource("query", "messages.page"),
	resource("query", "reports.unsafeRaw"),
	resource("mutation", "message.publish"),
];
const operationHttpContractDigest = "2".repeat(64);
const clientContractDigest = "1".repeat(64);

test("binds the sibling realtime wire to the canonical HTTP contract", () => {
	const realtime = projectRealtimeWireContract({
		application: "application:collaboration",
		clientContractDigest,
		operationHttpContractDigest,
		resources,
		watchableQueries: ["query:messages.page"],
	});

	expect(realtime).toEqual({
		format: "questpie.realtime-wire",
		version: 1,
		application: "application:collaboration",
		path: "/_questpie/realtime",
		commandMediaType: "application/vnd.questpie.realtime+json;version=1",
		streamMediaType: "text/event-stream",
		protocol: { name: "questpie.realtime", version: 1 },
		operationHttpContractDigest,
		clientContractDigest,
		watchableQueries: [
			{
				identity: "query:messages.page",
				input,
				output,
			},
		],
		commands: {
			open: [
				"application",
				"bindingId",
				"clientContractDigest",
				"command",
				"context",
				"input",
				"protocol",
				"query",
				"realtimeWireDigest",
				"resumeToken",
				"scopeId",
			],
			ack: [
				"application",
				"bindingId",
				"clientContractDigest",
				"command",
				"protocol",
				"realtimeWireDigest",
				"resumeToken",
				"scopeId",
			],
			close: [
				"application",
				"bindingId",
				"clientContractDigest",
				"command",
				"protocol",
				"realtimeWireDigest",
				"scopeId",
			],
		},
		frames: {
			ready: ["kind", "protocol", "scopeId"],
			delivery: [
				"bindingId",
				"delivery",
				"kind",
				"payload",
				"protocol",
				"query",
				"resetReason",
				"resumeToken",
			],
			failure: ["bindingId", "error", "kind", "protocol", "query"],
			closed: ["kind", "protocol", "reason", "retryable", "scopeId"],
		},
		deliveryKinds: ["initial", "reset", "update"],
		resetReasons: [
			"authority-changed",
			"deployment-changed",
			"resume-unavailable",
		],
		failureCodes: [
			"AUTHORIZATION_FAILED",
			"OUTPUT_INVALID",
			"RESOURCE_LIMIT",
			"TRANSPORT_FAILED",
			"VERSION_INCOMPATIBLE",
		],
		limits: {
			activeWatchesPerPrincipal: 64,
			bufferedBytesPerClient: 2_097_152,
			dependencyTokensPerPlan: 256,
			fanoutPerBatch: 1_024,
			ledgerLagMilliseconds: 30_000,
			resultBytes: 1_048_576,
			retainedTokenAgeMilliseconds: 86_400_000,
			retainedTokensPerPrincipal: 128,
		},
		resumeTokenVisibility: "generatedClientOnly",
		acknowledgement: "afterCompleteResultAccepted",
		digest: "96353f66fff54f5b2e2c2dea254318a5bb6597c53fc24db853a7bf5e71ea6259",
	});
});

test("adds watch only to the same compiler-proven Query method", () => {
	const source = renderClientContract(resources, {
		application: "application:collaboration",
		clientContractDigest,
		httpContractDigest: operationHttpContractDigest,
		realtime: projectRealtimeWireContract({
			application: "application:collaboration",
			clientContractDigest,
			operationHttpContractDigest,
			resources,
			watchableQueries: ["query:messages.page"],
		}),
	});
	const declarations = source.slice(0, source.indexOf("export class"));

	expect(declarations).toContain('"messages.page": WatchableQueryMethod<');
	expect(declarations).toContain('"reports.unsafeRaw"(operationInput:');
	expect(declarations).not.toContain(
		'"reports.unsafeRaw": WatchableQueryMethod<',
	);
	expect(declarations).not.toContain(
		'"message.publish": WatchableQueryMethod<',
	);
	expect(declarations).not.toContain("resumeToken");
	expect(source).toContain("Object.assign(");
});

test("multiplexes private resume acknowledgements behind the public watch method", async () => {
	const realtime = projectRealtimeWireContract({
		application: "application:collaboration",
		clientContractDigest,
		operationHttpContractDigest,
		resources,
		watchableQueries: ["query:messages.page"],
	});
	const source = renderClientContract(resources, {
		application: "application:collaboration",
		clientContractDigest,
		httpContractDigest: operationHttpContractDigest,
		realtime,
	});
	const directory = await mkdtemp(join(tmpdir(), "questpie-beta07-client-"));
	try {
		await installQuestpieForTracer(directory);
		await writeFile(
			join(directory, "app.ts"),
			"export type AppContextInput = Readonly<{ companyId: string }>;\n",
		);
		await writeFile(join(directory, "client.ts"), source);
		await writeFile(
			join(directory, "tsconfig.json"),
			JSON.stringify({
				extends: resolve(import.meta.dir, "../../tsconfig.base.json"),
				compilerOptions: { noEmit: true, types: [] },
				files: ["app.ts", "client.ts"],
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
		const generated = (await import(
			`${pathToFileURL(join(directory, "client.ts")).href}?${crypto.randomUUID()}`
		)) as Readonly<{
			createClient(
				input: Readonly<{
					baseUrl: string;
					fetch(request: Request): Promise<Response>;
				}>,
			): Readonly<{
				withContext(context: Readonly<{ companyId: string }>): Readonly<{
					queries: Readonly<{
						"messages.page": Readonly<{
							watch(
								input: unknown,
								callback: (result: unknown, delivery: unknown) => void,
							): () => void;
						}>;
					}>;
				}>;
			}>;
		}>;
		const commands: Record<string, unknown>[] = [];
		let streamController:
			| ReadableStreamDefaultController<Uint8Array>
			| undefined;
		let downstreams = 0;
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
		const method = client.withContext({ companyId: "company:one" }).queries[
			"messages.page"
		];
		const delivery = new Promise<Readonly<{ result: unknown; meta: unknown }>>(
			(resolve) => {
				method.watch(
					{
						after: null,
						channelId: "00000000-0000-4000-8000-000000000001",
						first: 20,
					},
					(result, meta) => resolve({ result, meta }),
				);
			},
		);
		await Bun.sleep(0);
		const encoder = new TextEncoder();
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "ready", scopeId })}\n\n`,
			),
		);
		await Bun.sleep(0);
		const open = commands.find(({ command }) => command === "open");
		expect(open).toEqual(
			expect.objectContaining({
				command: "open",
				query: "query:messages.page",
				resumeToken: null,
			}),
		);
		streamController?.enqueue(
			encoder.encode(
				`data: ${JSON.stringify({ protocol: realtime.protocol, kind: "delivery", bindingId: open?.bindingId, query: "query:messages.page", delivery: "initial", resetReason: null, payload: { nodes: [] }, resumeToken: "opaque-server-token" })}\n\n`,
			),
		);
		const accepted = await delivery;
		await Bun.sleep(0);
		expect(accepted).toEqual({
			result: { nodes: [] },
			meta: { kind: "initial" },
		});
		expect(commands).toContainEqual(
			expect.objectContaining({
				command: "ack",
				resumeToken: "opaque-server-token",
			}),
		);
		expect(accepted).not.toHaveProperty("resumeToken");
		expect(downstreams).toBe(1);
	} finally {
		await rm(directory, { recursive: true });
	}
});
