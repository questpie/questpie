import { beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	codec,
	defineCredentialResolver,
	defineService,
	durable,
	operation,
	policy,
	principal,
} from "questpie";

import { compileApplication } from "@questpie/compiler";

import {
	createRuntimeApplication,
	type ExecutionEventV1,
} from "../../packages/runtime/src/application";
import type { MutationInvoker } from "../../packages/runtime/src/mutation";
import { CommittedResultUnavailable } from "../../packages/runtime/src/operation";
import {
	bindIngressPrincipal,
	readIngressPrincipal,
} from "../../packages/runtime/src/operation/ingress";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4";
const messageId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c1";

type GeneratedCompilation = Awaited<ReturnType<typeof compileApplication>>;
type RuntimeSlot = Readonly<{
	identity: string;
	kind:
		| "context"
		| "credentialResolver"
		| "mutation"
		| "query"
		| "reaction"
		| "route"
		| "service";
	slot: "create" | "dispose" | "handler" | "resolve";
	runtimeGraphDigest: string;
	bundleExport: string;
}>;
type Definition = Readonly<Record<string, unknown>>;

let compilation: GeneratedCompilation;
let runtimeBuild: Readonly<Record<string, unknown>>;
let operationContracts: Readonly<Record<string, unknown>>;
let runtimeExecutables: Readonly<{
	slots: readonly RuntimeSlot[];
}>;
let wireContract: Readonly<Record<string, unknown>>;
let generatedClient: Readonly<{
	createClient(
		input: Readonly<{
			baseUrl: string;
			fetch(request: Request): Promise<Response>;
		}>,
	): Readonly<{
		withContext(context: Readonly<{ companyId: string }>): Readonly<{
			queries: Readonly<{
				"messages.page"(input: QueryInput): Promise<unknown>;
			}>;
		}>;
	}>;
}>;
let collaborationContext: Definition;
let auditConnection: Definition;
let executionAudit: Definition;
let auditReader: Definition;
let publishMessage: Definition;
let recordDelivery: Definition;
let messagePublished: Definition;
let messagePage: Definition;
let channelMessagePage: unknown;
let applicationCredentials: Definition;
let demoAuth: Definition;
let whoami: Definition;

type QueryInput = Readonly<{
	channelId: string;
	first: number;
	after: string | null;
}>;

const expectedWirePage = Object.freeze({
	nodes: Object.freeze([
		Object.freeze({
			author: null,
			body: "one engine",
			createdAt: "2026-08-15T10:00:00.000Z",
			id: messageId,
		}),
	]),
	pageInfo: Object.freeze({ endCursor: "cursor:one", hasNextPage: false }),
});

const expectedPage = Object.freeze({
	...expectedWirePage,
	nodes: Object.freeze(
		expectedWirePage.nodes.map((node) =>
			Object.freeze({ ...node, createdAt: new Date(node.createdAt) }),
		),
	),
});

beforeAll(async () => {
	compilation = await compileApplication({ applicationRoot: fixtureRoot });
	const generated = resolve(fixtureRoot, ".questpie/generated");
	const nonce = `?beta05=${crypto.randomUUID()}`;
	generatedClient = (await import(
		`${pathToFileURL(resolve(generated, "client.ts")).href}${nonce}`
	)) as typeof generatedClient;
	const generatedApp = await import(
		`${pathToFileURL(resolve(generated, "app.ts")).href}${nonce}`
	);
	const execution = await import(
		pathToFileURL(resolve(fixtureRoot, "src/execution.ts")).href
	);
	const structural = await import(
		pathToFileURL(resolve(fixtureRoot, "src/message-page.ts")).href
	);
	const audit = await import(
		pathToFileURL(resolve(fixtureRoot, "packages/audit/src/questpie.ts")).href
	);

	collaborationContext = execution.collaborationContext;
	auditConnection = execution.auditConnection;
	executionAudit = execution.executionAudit;
	auditReader = audit.auditReader;
	demoAuth = defineService({
		name: "collaboration.demo-auth",
		lifetime: "application",
		effect: "external",
		create: () => Object.freeze({}),
	});
	applicationCredentials = defineCredentialResolver({
		name: "collaboration.credentials",
		service: demoAuth as never,
		resolve: () => ({ kind: "anonymous" }),
	});
	whoami = generatedApp.defineRoute({
		name: "collaboration.whoami",
		method: "GET",
		path: "/api/whoami",
		policy: policy.authenticated(),
		credentials: "application",
		limits: { bodyBytes: 0, durationMs: 1_000 },
		handler: () => new Response(null, { status: 204 }),
	});
	channelMessagePage = structural.channelMessagePage;
	publishMessage = generatedApp.defineMutation({
		name: "message.publish",
		network: true,
		input: codec.object({
			channelId: codec.uuid(),
			body: codec.text(),
		}),
		output: codec.object({
			id: codec.uuid(),
			channelId: codec.uuid(),
			body: codec.text(),
			createdAt: codec.timestamp(),
		}),
		policy: policy.authenticated(),
		errors: {
			channelUnavailable: operation.error({
				code: "CHANNEL_UNAVAILABLE",
				status: 404,
			}),
			idempotencyConflict: operation.error({
				code: "IDEMPOTENCY_CONFLICT",
				status: 409,
				payload: codec.object({ callId: codec.uuid() }),
			}),
		},
		handler: () => {
			throw new Error("mutation is outside this Query-only runtime harness");
		},
	});
	recordDelivery = generatedApp.defineMutation({
		name: "message.recordDelivery",
		network: true,
		input: codec.object({ messageId: codec.uuid() }),
		output: codec.object({ eventId: codec.uuid() }),
		policy: policy.authenticated(),
		errors: {
			deliveryUnavailable: operation.error({
				code: "DELIVERY_UNAVAILABLE",
				status: 404,
			}),
		},
		handler: () => ({ eventId: messageId }),
	});
	messagePublished = generatedApp.defineReaction({
		name: "messagePublished",
		input: codec.object({
			channelId: codec.uuid(),
			companyId: codec.uuid(),
			messageId: codec.uuid(),
		}),
		output: codec.object({
			deliveryReceipt: codec.text(),
			eventId: codec.uuid(),
			messageId: codec.uuid(),
		}),
		runAs: durable.caller({ whenDenied: "fail" }),
		retry: durable.retry({
			maximumAttempts: 8,
			initialDelay: "1s",
			backoff: "exponential",
			maximumDelay: "900s",
			jitter: "full",
			horizon: "24h",
		}),
		effects: ["deliver-message"],
		errors: {
			messageUnavailable: operation.error({
				code: "MESSAGE_UNAVAILABLE",
				status: 404,
			}),
		},
		handler: () => ({
			deliveryReceipt: "delivery:none",
			eventId: messageId,
			messageId,
		}),
	});
	messagePage = generatedApp.defineQuery({
		name: "messages.page",
		network: true,
		input: codec.object({
			channelId: codec.uuid(),
			first: codec.integer(),
			after: codec.nullable(codec.text()),
		}),
		output: codec.object({
			nodes: codec.array(
				codec.object({
					author: codec.nullable(
						codec.object({ id: codec.uuid(), role: codec.text() }),
					),
					body: codec.optional(codec.text()),
					createdAt: codec.timestamp(),
					id: codec.uuid(),
				}),
			),
			pageInfo: codec.object({
				endCursor: codec.nullable(codec.text()),
				hasNextPage: codec.boolean(),
			}),
		}),
		handler: ({
			input,
			ctx,
		}: Readonly<{
			input: QueryInput;
			ctx: Readonly<{
				data: Readonly<{
					run(definition: unknown, queryInput: QueryInput): Promise<unknown>;
				}>;
			}>;
		}>) => ctx.data.run(channelMessagePage, input),
	});
	runtimeBuild = JSON.parse(compilation.generatedFiles["runtime-build.json"]!);
	runtimeExecutables = JSON.parse(
		compilation.generatedFiles["runtime-executables.json"]!,
	);
	operationContracts = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	);
	wireContract = JSON.parse(compilation.generatedFiles["wire-contract.json"]!);
});

function definitions(): ReadonlyMap<string, Definition> {
	return new Map([
		["context:app.context", collaborationContext],
		["credentialResolver:collaboration.credentials", applicationCredentials],
		["mutation:message.publish", publishMessage],
		["mutation:message.recordDelivery", recordDelivery],
		["query:messages.page", messagePage],
		["reaction:messagePublished", messagePublished],
		["route:collaboration.whoami", whoami],
		["service:collaboration.demo-auth", demoAuth],
		["service:audit.connection", auditConnection],
		["service:audit.execution", executionAudit],
		["service:questpie.auditReader", auditReader],
	]);
}

function executableBindings() {
	const byIdentity = definitions();
	const serverExports: Record<string, unknown> = {};
	const slots = runtimeExecutables.slots.map((slot) => {
		const definition = byIdentity.get(slot.identity);
		if (!definition) throw new Error(`missing Definition ${slot.identity}`);
		const implementation =
			slot.kind === "query" ||
			slot.kind === "mutation" ||
			slot.kind === "reaction" ||
			slot.kind === "route"
				? definition.handler
				: definition[slot.slot];
		serverExports[slot.bundleExport] = implementation;
		return Object.freeze({
			identity: slot.identity,
			kind: slot.kind,
			slot: slot.slot,
			runtimeGraphDigest: slot.runtimeGraphDigest,
			bundleExport: slot.bundleExport,
			definition,
			...(slot.kind === "query" ||
			slot.kind === "mutation" ||
			slot.kind === "reaction" ||
			slot.kind === "route"
				? { execute: implementation }
				: {}),
		});
	});
	return { serverExports: Object.freeze(serverExports), slots };
}

function artifactFiles(): Readonly<Record<string, string>> {
	const inventory = runtimeBuild.inventory as readonly Readonly<{
		path: string;
	}>[];
	return Object.freeze(
		Object.fromEntries(
			inventory.map(({ path }) => {
				const bytes = compilation.generatedFiles[path];
				if (bytes === undefined) throw new Error(`missing artifact ${path}`);
				return [path, bytes];
			}),
		),
	);
}

async function runtimeHarness(
	mutationInvoker?: MutationInvoker<Readonly<Record<string, unknown>>>,
) {
	let bootstrapGets = 0;
	let dataRuns = 0;
	const events: ExecutionEventV1[] = [];
	const bindings = executableBindings();
	const runtime = await createRuntimeApplication({
		artifacts: {
			runtimeBuild,
			runtimeExecutables,
			operationContracts,
			wireContract,
		},
		artifactFiles: artifactFiles(),
		serverExports: bindings.serverExports,
		bindings: {
			application: "application:collaboration",
			runtimeBuildDigest: String(runtimeBuild.digest),
			slots: bindings.slots as never,
		},
		program: {
			services: [
				demoAuth,
				auditConnection,
				executionAudit,
				auditReader,
			] as never,
			context: collaborationContext as never,
			bootstrap: () => ({
				get: (async () => {
					bootstrapGets += 1;
					return Object.freeze({
						companyId,
						principalId,
						role: "admin",
						scopeKey: "company",
						status: "active",
					});
				}) as never,
			}),
			resolvePrincipal: readIngressPrincipal,
			project: ({ facts }) =>
				Object.freeze({
					data: Object.freeze({
						run: async (definition: unknown) => {
							expect(definition).toBe(channelMessagePage);
							dataRuns += 1;
							return expectedWirePage;
						},
					}),
					signal: facts.signal,
				}),
			...(mutationInvoker === undefined
				? {}
				: { projectMutation: () => mutationInvoker }),
		},
		events: (event) => events.push(event),
	});
	return {
		bootstrapGets: () => bootstrapGets,
		dataRuns: () => dataRuns,
		events,
		runtime,
	};
}

function operationFrame(
	input: QueryInput,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	return {
		application: runtimeBuild.application,
		callId: crypto.randomUUID(),
		clientContractDigest: runtimeBuild.clientContractDigest,
		context: { companyId },
		input,
		operation: "query:messages.page",
		protocol: wireContract.protocol,
		timeoutMilliseconds: 5_000,
		wireDigest: runtimeBuild.wireDigest,
		...overrides,
	};
}

function operationRequest(
	frame: unknown,
	user = principal.user({ id: principalId }),
) {
	return bindIngressPrincipal(
		new Request("http://runtime.test/_questpie/operation", {
			method: "POST",
			headers: { "content-type": String(wireContract.mediaType) },
			body: JSON.stringify(frame),
		}),
		user,
	);
}

test("uses one compiled Message Query engine for direct, Fetch, and generated client calls", async () => {
	const harness = await runtimeHarness();
	const user = principal.user({ id: principalId });
	const context = { companyId };
	const input = { channelId, first: 20, after: null };
	try {
		const direct = (await harness.runtime.execution(
			{ principal: user, context } as never,
			(operations) => operations.invoke("query:messages.page", input),
		)) as Readonly<{ nodes: readonly Readonly<{ createdAt: unknown }>[] }>;
		const raw = await harness.runtime.fetch(
			operationRequest(operationFrame(input), user),
		);
		expect(raw.status).toBe(200);
		const rawFrame = (await raw.json()) as Readonly<{
			kind: string;
			payload: unknown;
		}>;
		expect(rawFrame.kind).toBe("result");

		let generatedFetches = 0;
		const client = generatedClient.createClient({
			baseUrl: "http://runtime.test",
			fetch: (request) => {
				generatedFetches += 1;
				return harness.runtime.fetch(bindIngressPrincipal(request, user));
			},
		});
		const clientResult = (await client
			.withContext(context)
			.queries["messages.page"](input)) as Readonly<{
			nodes: readonly Readonly<{ createdAt: unknown }>[];
		}>;
		expect({ direct, fetch: rawFrame.payload, client: clientResult }).toEqual({
			direct: expectedPage,
			fetch: expectedWirePage,
			client: expectedPage,
		});
		expect(direct.nodes[0]?.createdAt).toBeInstanceOf(Date);
		expect(clientResult.nodes[0]?.createdAt).toBeInstanceOf(Date);
		expect(generatedFetches).toBe(1);
		expect(harness.dataRuns()).toBe(3);
		expect(harness.bootstrapGets()).toBe(3);

		const beforeAdmissionHostiles = {
			bootstrap: harness.bootstrapGets(),
			data: harness.dataRuns(),
		};
		const stale = await harness.runtime.fetch(
			operationRequest(
				operationFrame(input, { clientContractDigest: "0".repeat(64) }),
				user,
			),
		);
		expect(stale.status).toBe(409);
		expect(await stale.json()).toEqual({
			kind: "failure",
			error: { code: "CLIENT_OUTDATED", retryable: false },
		});
		const unknown = await harness.runtime.fetch(
			operationRequest(
				operationFrame(input, { operation: "query:messages.unknown" }),
				user,
			),
		);
		expect(unknown.status).toBe(404);
		const malformed = await harness.runtime.fetch(
			operationRequest({ ...operationFrame(input), authority: "system" }, user),
		);
		expect(malformed.status).toBe(400);
		expect({
			bootstrap: harness.bootstrapGets(),
			data: harness.dataRuns(),
		}).toEqual(beforeAdmissionHostiles);

		let lostResponses = 0;
		const responseLossClient = generatedClient.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				lostResponses += 1;
				const response = await harness.runtime.fetch(
					bindIngressPrincipal(request, user),
				);
				expect(response.status).toBe(200);
				throw new Error("response lost");
			},
		});
		const dataBeforeLoss = harness.dataRuns();
		await expect(
			responseLossClient.withContext(context).queries["messages.page"](input),
		).rejects.toThrow("response lost");
		expect(lostResponses).toBe(1);
		expect(harness.dataRuns()).toBe(dataBeforeLoss + 1);

		const beforeDeclaredError = harness.dataRuns();
		const declaredErrorClient = generatedClient.createClient({
			baseUrl: "http://runtime.test",
			fetch: async (request) => {
				const call = (await request.json()) as Readonly<{ callId: string }>;
				return new Response(
					JSON.stringify({
						kind: "declaredError",
						callId: call.callId,
						operation: "query:messages.page",
						protocol: wireContract.protocol,
						error: { code: "NOT_DECLARED", payload: {}, status: 400 },
					}),
					{ headers: { "content-type": String(wireContract.mediaType) } },
				);
			},
		});
		await expect(
			declaredErrorClient.withContext(context).queries["messages.page"](input),
		).rejects.toThrow("PROTOCOL_UNSUPPORTED");
		expect(harness.dataRuns()).toBe(beforeDeclaredError);
	} finally {
		await harness.runtime.close({ deadlineAt: Date.now() + 2_000 });
	}

	expect(harness.events.map(({ event }) => event.kind)).toEqual([
		"ready",
		"accepted",
		"result",
		"accepted",
		"result",
		"accepted",
		"result",
		"accepted",
		"result",
		"drainStarted",
		"stopped",
	]);
	const eventBytes = JSON.stringify(harness.events);
	expect(eventBytes).not.toContain("companyId");
	expect(eventBytes).not.toContain("one engine");
});

test("executes retained v1 Queries but rejects v1 Mutations and unknown operations before context", async () => {
	const harness = await runtimeHarness();
	const input = { channelId, first: 20, after: null };
	const compatibility = wireContract.compatibility as Readonly<{
		wireV1Digest: string;
	}>;
	try {
		const query = await harness.runtime.fetch(
			operationRequest(
				operationFrame(input, {
					callId: "retained:v1:query",
					wireDigest: compatibility.wireV1Digest,
				}),
			),
		);
		expect(query.status).toBe(200);
		expect(await query.json()).toMatchObject({
			kind: "result",
			callId: "retained:v1:query",
			operation: "query:messages.page",
		});
		expect({
			bootstrap: harness.bootstrapGets(),
			data: harness.dataRuns(),
		}).toEqual({ bootstrap: 1, data: 1 });

		for (const operation of [
			"mutation:message.publish",
			"query:messages.unknown",
		]) {
			const rejected = await harness.runtime.fetch(
				operationRequest(
					operationFrame(input, {
						callId: `retained:v1:${operation}`,
						operation,
						wireDigest: compatibility.wireV1Digest,
					}),
				),
			);
			expect(rejected.status).toBe(409);
			expect(await rejected.json()).toEqual({
				kind: "failure",
				error: { code: "CLIENT_OUTDATED", retryable: false },
			});
		}
		expect({
			bootstrap: harness.bootstrapGets(),
			data: harness.dataRuns(),
		}).toEqual({ bootstrap: 1, data: 1 });
	} finally {
		await harness.runtime.close({ deadlineAt: Date.now() + 2_000 });
	}
});

test("request abort cannot mask a known post-commit Mutation outcome", async () => {
	const callId = "abort:after:commit";
	const controller = new AbortController();
	const harness = await runtimeHarness(async (_operation, actualCallId) => {
		expect(actualCallId).toBe(callId);
		controller.abort(new DOMException("caller disconnected", "AbortError"));
		throw new CommittedResultUnavailable(
			actualCallId,
			"18446744073709551615",
			new Error("result serialization failed"),
		);
	});
	try {
		const request = operationRequest(
			operationFrame(
				{ channelId, first: 20, after: null },
				{
					callId,
					operation: "mutation:message.publish",
					input: { channelId, body: "committed before abort" },
				},
			),
		);
		const correlated = new Request(request, { signal: controller.signal });
		bindIngressPrincipal(correlated, principal.user({ id: principalId }));
		const response = await harness.runtime.fetch(correlated);
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			protocol: wireContract.protocol,
			kind: "failure",
			operation: "mutation:message.publish",
			callId,
			error: {
				code: "COMMITTED_RESULT_UNAVAILABLE",
				retryable: true,
				transactionId: "18446744073709551615",
			},
		});
	} finally {
		await harness.runtime.close({ deadlineAt: Date.now() + 2_000 });
	}
});
