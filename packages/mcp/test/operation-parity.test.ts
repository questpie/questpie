import { describe, expect, it } from "bun:test";
/** Adapter/context experiment; fixture credentials and an in-memory domain, no DB. */
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError, route } from "questpie";
import { z } from "zod";

import { createFetchHandler } from "../../questpie/src/server/adapters/http.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
} from "../src/exports/index.js";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "operation-parity-prototype",
		version: "1.0.0",
	});
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	await client.listTools();
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}

function toolBody(result: {
	isError?: unknown;
	structuredContent?: unknown;
	content?: unknown;
}) {
	if (!result.isError)
		return JSON.parse(JSON.stringify(result.structuredContent ?? null));
	expect(result.structuredContent).toBeUndefined();
	expect(Array.isArray(result.content)).toBe(true);
	const text = (result.content as Array<{ type: string; text?: string }>).find(
		(item) => item.type === "text",
	)?.text;
	expect(text).toBeDefined();
	return JSON.parse(text!);
}

async function fixture(workloadActorIsHuman = false) {
	const toolName = "tasks.rename";
	let transforms = 0;
	let failure: unknown;
	let accessCalls = 0;
	let invalidOutput = false;
	const inputSchema = z
		.object({
			companyId: z.literal("company-a"),
			taskId: z.literal("task-1"),
			expectedVersion: z.number().int().positive(),
			idempotencyKey: z.string().min(1),
			title: z
				.string()
				.min(1)
				.transform((value) => {
					transforms++;
					return value.trim();
				}),
		})
		.strict();
	const outputSchema = z
		.object({
			taskId: z.string(),
			title: z.string(),
			version: z.number().int(),
			replayed: z.boolean(),
		})
		.strict();
	type Input = z.infer<typeof inputSchema>;
	type Output = z.infer<typeof outputSchema>;
	type Actor =
		| { kind: "human"; subjectId: string }
		| {
				kind: "agent";
				subjectId: string;
				credentialId: string;
				issuer: string;
				scopes: string[];
				expiresAt: Date;
		  };
	type FixtureAuthority = {
		actor: Actor;
		workload?: { type: string; id: string };
		requesterRunId?: string;
	};
	const human: FixtureAuthority = {
		actor: { kind: "human", subjectId: "human-1" },
	};
	const agent: FixtureAuthority = {
		actor: {
			kind: "agent",
			subjectId: "agent-1",
			credentialId: "fixture-credential",
			issuer: "fixture-issuer",
			scopes: [toolName],
			expiresAt: new Date("2099-01-01"),
		},
		workload: { type: "agent-run", id: "run-1" },
		requesterRunId: "run-1",
	};
	if (workloadActorIsHuman) agent.actor = human.actor;
	const members = new Set([human.actor.subjectId, agent.actor.subjectId]);
	let allowed = true;
	let state = { taskId: "task-1", title: "Before", version: 1 };
	const receipts = new Map<string, { payload: string; result: Output }>();
	const invocations: Array<{
		actor: Actor;
		workload?: FixtureAuthority["workload"];
		flatRun?: string;
		bundledRun?: unknown;
	}> = [];
	const productPolicy = (verifiedSubjectId: string | undefined) =>
		allowed && !!verifiedSubjectId && members.has(verifiedSubjectId);

	function execute(
		input: Input,
		ctx: FixtureAuthority & { "~contextExtensions"?: Record<string, unknown> },
	): Output {
		assert(
			productPolicy(ctx.actor.subjectId),
			"shared executor requires product access",
		);
		if (failure) throw failure;
		invocations.push({
			actor: ctx.actor,
			workload: ctx.workload,
			flatRun: ctx.requesterRunId,
			bundledRun: ctx["~contextExtensions"]?.requesterRunId,
		});
		const key = `${input.companyId}:${ctx.actor.subjectId}:${input.idempotencyKey}`;
		const payload = JSON.stringify(input);
		const prior = receipts.get(key);
		if (prior) {
			if (prior.payload !== payload)
				throw ApiError.conflict("Idempotency key reused");
			return { ...prior.result, replayed: true };
		}
		if (input.expectedVersion !== state.version)
			throw ApiError.conflict("Task version changed");
		state = {
			taskId: input.taskId,
			title: input.title,
			version: state.version + 1,
		};
		const result = { ...state, replayed: false };
		receipts.set(key, { payload, result });
		return invalidOutput
			? ({ taskId: "private-output-secret" } as Output)
			: result;
	}

	// The ONLY product definition, validation, output and access declaration.
	const operation = route()
		.post()
		.schema(inputSchema)
		.outputSchema(outputSchema)
		.access((ctx) => {
			accessCalls++;
			return productPolicy(
				(ctx as { verifiedSubjectId?: string }).verifiedSubjectId,
			);
		})
		.meta({
			mcp: {
				expose: true,
				name: toolName,
				annotations: { readOnlyHint: false },
			},
		})
		.handler((args) =>
			execute(args.input, args as unknown as Parameters<typeof execute>[1]),
		);

	// Controlled app/auth/context fixture. Real route matching, executor, MCP catalog,
	// execution boundary and SDK transports below. This is not credential crypto proof.
	const db = Object.freeze({ fixture: "unused-database" });
	const span = { setAttributes() {}, recordError() {} };
	const appFixture = {
		db,
		collections: {},
		globals: {},
		getCollections: () => ({}),
		getGlobals: () => ({}),
		config: {
			routes: { "tasks/rename:POST": operation },
			logger: { requests: false },
		},
		state: {
			config: {
				mcp: {
					routes: {
						routes: {
							"tasks/rename": {
								operations: { execute: true },
								requiredScopes: false,
								workload: { capabilities: [toolName] },
							},
						},
					},
				},
			},
		},
		logger: { info() {}, warn() {}, error() {} },
		observability: {
			histogram: () => ({ record() {} }),
			span: async (_name: string, fn: (value: typeof span) => unknown) =>
				fn(span),
		},
		t: (key: string, _params?: unknown, locale?: string) =>
			`${locale ?? "en"}:${key}`,
		createContext: async (options: Record<string, unknown> = {}) => {
			const authority = options.actor ? agent : human;
			return {
				...options,
				...authority,
				locale: "sk",
				db,
				accessMode: "user" as const,
				principal:
					options.actor && !workloadActorIsHuman
						? undefined
						: {
								kind: "user",
								user: { id: "human-1" },
								session: { id: "fixture-session" },
							},
				verifiedSubjectId: authority.actor.subjectId,
				"~contextExtensions": {
					verifiedSubjectId: authority.actor.subjectId,
					...(authority.requesterRunId
						? { requesterRunId: authority.requesterRunId }
						: {}),
				},
			};
		},
	};
	const app = appFixture as unknown as Parameters<typeof createMcpServer>[0];
	const fetchHandler = createFetchHandler(app, {
		getSession: async () => ({
			user: { id: "human-1" },
			session: { id: "fixture-session" },
		}),
	});

	const humanMcp = await connect(
		await createMcpServer(app, {
			ctx: (await appFixture.createContext()) as never,
		}),
	);
	const authorizationRequests: unknown[] = [];
	const envelope = Object.freeze({
		credential: "fixture-verified-agent",
		runId: "run-1",
	});
	const agentMcp = await connect(
		await createWorkloadMcpServer(app, {
			envelope,
			authorizer: {
				authorize: async (request) => {
					authorizationRequests.push(request);
					assert.equal(request.envelope, envelope);
					assert.equal(request.tool.name, toolName);
					assert.deepEqual(request.tool.capabilities, [toolName]);
					return { context: envelope };
				},
			},
			contextBinder: {
				bind: async ({ authorizationContext }) => {
					assert.equal(authorizationContext, envelope);
					const context = await appFixture.createContext({
						actor: agent.actor,
					});
					assert.equal(context.requesterRunId, "run-1");
					return context as never;
				},
			},
		}),
	);

	const input: Input = {
		companyId: "company-a",
		taskId: "task-1",
		expectedVersion: 1,
		idempotencyKey: "rename-1",
		title: "After",
	};

	const lanes = [
		{
			name: "http",
			call: async (body: unknown) => {
				const response = await fetchHandler(
					new Request("http://fixture.local/tasks/rename", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
				);
				expect(response).toBeDefined();
				return { status: response!.status, body: await response!.json() };
			},
		},
		...[
			{ name: "human", connection: humanMcp },
			{ name: "agent", connection: agentMcp },
		].map((lane) => ({
			name: lane.name,
			call: async (body: unknown) => {
				const result = await lane.connection.client.callTool({
					name: toolName,
					arguments: body as Record<string, unknown>,
				});
				return {
					status: undefined,
					body: toolBody(result),
					meta: result._meta,
					isError: result.isError,
				};
			},
		})),
	];
	return {
		input,
		lanes,
		invocations,
		authorizationRequests,
		humanMcp,
		agentMcp,
		setInvalidOutput() {
			invalidOutput = true;
		},
		setAllowed(value: boolean) {
			allowed = value;
		},
		setFailure(value: unknown) {
			failure = value;
		},
		reset() {
			state = { taskId: "task-1", title: "Before", version: 1 };
			receipts.clear();
			accessCalls = 0;
			transforms = 0;
		},
		counts: () => ({ accessCalls, transforms }),
		close: async () => {
			await humanMcp.close();
			await agentMcp.close();
		},
	};
}

async function usingFixture(
	run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
) {
	const f = await fixture();
	try {
		await run(f);
	} finally {
		await f.close();
	}
}

describe("one product operation over HTTP, Human MCP and Agent MCP", () => {
	it("uses the same operation and product policy for one actor through session and delegated credentials", async () => {
		const f = await fixture(true);
		try {
			const descriptors = await Promise.all(
				[f.humanMcp, f.agentMcp].map(async ({ client }) => {
					const catalog = await client.listTools();
					const tool = catalog.tools.find(
						(item) => item.name === "tasks.rename",
					)!;
					return {
						name: tool.name,
						inputSchema: tool.inputSchema,
						outputSchema: tool.outputSchema,
					};
				}),
			);
			expect(descriptors[1]).toEqual(descriptors[0]);
			for (const [index, lane] of f.lanes.entries()) {
				const result = await lane.call(f.input);
				expect(result.body).toEqual({
					taskId: "task-1",
					title: "After",
					version: 2,
					replayed: index > 0,
				});
				expect(f.invocations.at(-1)!.actor).toEqual({
					kind: "human",
					subjectId: "human-1",
				});
			}
			f.setAllowed(false);
			for (const lane of f.lanes) {
				const result = await lane.call(f.input);
				expect(result.body.error.code).toBe("FORBIDDEN");
			}
			expect(f.invocations).toHaveLength(3);
			expect(f.counts()).toEqual({ accessCalls: 6, transforms: 6 });
		} finally {
			await f.close();
		}
	});
	it("returns the same result/replay and verified actor/workload provenance, with one transform and target policy per call", () =>
		usingFixture(async (f) => {
			for (const lane of f.lanes) {
				f.reset();
				const result = await lane.call(f.input);
				const replay = await lane.call(f.input);
				expect(result.body).toEqual({
					taskId: "task-1",
					title: "After",
					version: 2,
					replayed: false,
				});
				expect(replay.body).toEqual({ ...result.body, replayed: true });
				expect(f.counts()).toEqual({ accessCalls: 2, transforms: 2 });
				const invocation = f.invocations.at(-1)!;
				expect(invocation.actor.subjectId).toBe(
					lane.name === "agent" ? "agent-1" : "human-1",
				);
				expect(invocation.workload).toEqual(
					lane.name === "agent"
						? { type: "agent-run", id: "run-1" }
						: undefined,
				);
				expect(invocation.flatRun).toBe(
					lane.name === "agent" ? "run-1" : undefined,
				);
			}
		}));
	it("keeps canonical localized conflict, forbidden, and invalid input errors across carriers", () =>
		usingFixture(async (f) => {
			const bodies: unknown[] = [];
			for (const lane of f.lanes) {
				f.reset();
				await lane.call(f.input);
				const conflict = await lane.call({
					...f.input,
					idempotencyKey: "conflict",
				});
				expect(conflict.body).toEqual({
					error: { code: "CONFLICT", message: "sk:error.conflict" },
				});
				if (lane.name === "http") expect(conflict.status).toBe(409);
				else
					expect(Reflect.get(conflict, "meta")["questpie/error"].code).toBe(
						"CONFLICT",
					);
				f.setAllowed(false);
				const denied = await lane.call(f.input);
				f.setAllowed(true);
				expect(denied.body.error.code).toBe("FORBIDDEN");
				if (lane.name === "http") expect(denied.status).toBe(403);
				const before = f.invocations.length;
				const invalid = await lane.call({ ...f.input, title: 123 });
				expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
				expect(invalid.body.error.fieldErrors[0].path).toBe("title");
				const injection = await lane.call({
					...f.input,
					actor: { subjectId: "forged" },
					requesterRunId: "forged",
				});
				expect(injection.body.error.code).toBe("VALIDATION_ERROR");
				expect(f.invocations.length).toBe(before);
				bodies.push({
					conflict: conflict.body,
					denied: denied.body,
					invalid: invalid.body,
					injection: injection.body,
				});
			}
			expect(bodies[1]).toEqual(bodies[0]);
			expect(bodies[2]).toEqual(bodies[0]);
		}));
	it("retains explicit product details without cause, values, hook or DB internals", () =>
		usingFixture(async (f) => {
			f.setFailure(
				new ApiError({
					code: "CONFLICT",
					message: "Stale version",
					context: {
						custom: { currentVersion: 2 },
						db: { operation: "insert", table: "secret-table" },
					},
					fieldErrors: [
						{
							path: "title",
							message: "Use a new title",
							value: "secret-input",
						},
					],
					cause: new Error("SELECT secret"),
				}),
			);
			for (const lane of f.lanes)
				expect((await lane.call(f.input)).body).toEqual({
					error: {
						code: "CONFLICT",
						message: "Stale version",
						context: { custom: { currentVersion: 2 } },
						fieldErrors: [{ path: "title", message: "Use a new title" }],
					},
				});
		}));
	it("makes unknown exceptions and handler Zod errors opaque without running getters", () =>
		usingFixture(async (f) => {
			let getterCalls = 0;
			const hostile = Object.defineProperty({}, "cause", {
				get() {
					getterCalls++;
					throw new Error("secret");
				},
			});
			for (const error of [
				new Error("SELECT credential='secret'"),
				hostile,
				z.string().safeParse(1).error,
			]) {
				f.setFailure(error);
				for (const lane of f.lanes) {
					const result = await lane.call(f.input);
					expect(result.body).toEqual({
						error: {
							code: "INTERNAL_SERVER_ERROR",
							message: "sk:error.internal",
						},
					});
					if (lane.name === "http") expect(result.status).toBe(500);
				}
			}
			expect(getterCalls).toBe(0);
		}));
	it("does not publish database constraint values or hook internals over either carrier", () =>
		usingFixture(async (f) => {
			const dbCause = Object.assign(new Error("private SQL"), {
				code: "23505",
				constraint: "users_email_unique",
				detail: "Key (email)=(secret@example.com) already exists.",
				table: "private-table",
			});
			const failures = [
				new Error("SELECT secret", { cause: dbCause }),
				ApiError.hookError(
					{
						hook: "beforeChange",
						operation: "update",
						collection: "private-collection",
					},
					"private hook message",
					new Error("hook secret"),
				),
			];
			for (const failure of failures) {
				f.setFailure(failure);
				const bodies: unknown[] = [];
				for (const lane of f.lanes) {
					const response = await lane.call(f.input);
					bodies.push(response.body);
					for (const secret of [
						"secret@example.com",
						"private SQL",
						"SELECT",
						"private-table",
						"constraint",
						"cause",
						"stack",
						"private hook",
						"private-collection",
					])
						expect(JSON.stringify(response.body)).not.toContain(secret);
				}
				expect(bodies[1]).toEqual(bodies[0]);
				expect(bodies[2]).toEqual(bodies[0]);
			}
		}));

	it("reports invalid output as an opaque server failure across all carriers", () =>
		usingFixture(async (f) => {
			f.setInvalidOutput();
			for (const lane of f.lanes) {
				f.reset();
				const result = await lane.call(f.input);
				expect(result.body).toEqual({
					error: {
						code: "INTERNAL_SERVER_ERROR",
						message: "sk:error.internal",
					},
				});
				if (lane.name === "http") expect(result.status).toBe(500);
				expect(JSON.stringify(result)).not.toContain("private-output-secret");
			}
		}));

	it("advertises input wire types for transforms identically for humans and workloads", () =>
		usingFixture(async (f) => {
			const human = (await f.humanMcp.client.listTools()).tools[0]!;
			const agent = (await f.agentMcp.client.listTools()).tools[0]!;
			expect(agent.inputSchema).toEqual(human.inputSchema);
			expect(human.inputSchema.properties?.title).toEqual(
				expect.objectContaining({ type: "string" }),
			);
			expect(agent.outputSchema).toEqual(human.outputSchema);
		}));
});

// Separate fixture routes exercise wire representations independently of the domain above.
describe("route schema boundary", () => {
	it("rejects an exposed unrepresentable schema instead of advertising an empty object", async () => {
		const { buildMockApp } =
			await import("../../questpie/test/utils/mocks/mock-app-builder.js");
		const setup = await buildMockApp({
			routes: {
				"opaque:POST": route()
					.post()
					.schema(z.object({ value: z.custom() }))
					.meta({ mcp: { expose: true } })
					.handler(({ input }) => input),
			},
		});
		try {
			await expect(
				createMcpServer(setup.app, {
					config: {
						routes: {
							routes: {
								opaque: {
									operations: { execute: true },
									requiredScopes: false,
								},
							},
						},
					},
				}),
			).rejects.toThrow("cannot be represented");
		} finally {
			await setup.cleanup();
		}
	});
	it("wraps scalar wire inputs, runs non-idempotent transforms once, and checks target access only with real params", async () => {
		const { buildMockApp } =
			await import("../../questpie/test/utils/mocks/mock-app-builder.js");
		let transforms = 0;
		const seenParams: unknown[] = [];
		const scalar = route()
			.post()
			.params<{ id: string }>()
			.schema(
				z.string().transform((value) => {
					transforms++;
					return Number(value) + 1;
				}),
			)
			.access(({ params }) => {
				seenParams.push(params);
				return params?.id === "real";
			})
			.meta({ mcp: { expose: true, name: "scalar" } })
			.handler(({ input }) => ({ value: input }));
		const setup = await buildMockApp({
			routes: { "scalar/[id]:POST": scalar },
		});
		let connection: Awaited<ReturnType<typeof connect>> | undefined;
		try {
			connection = await connect(
				await createMcpServer(setup.app, {
					config: {
						routes: {
							routes: {
								"scalar/[id]": {
									operations: { execute: true },
									requiredScopes: false,
								},
							},
						},
					},
				}),
			);
			const descriptor = (await connection.client.listTools()).tools[0]!;
			expect(seenParams).toEqual([]);
			expect(descriptor.inputSchema.properties?.input).toEqual(
				expect.objectContaining({ type: "string" }),
			);
			const result = await connection.client.callTool({
				name: "scalar",
				arguments: { params: { id: "real" }, input: "41" },
			});
			expect(result.structuredContent).toEqual({ value: 42 });
			expect(transforms).toBe(1);
			expect(seenParams).toEqual([{ id: "real" }]);
			for (const arguments_ of [
				{ params: { id: "real", forged: "secret" }, input: "41" },
				{ params: { id: "real" }, input: "41", forged: "secret" },
			]) {
				const invalid = await connection.client.callTool({
					name: "scalar",
					arguments: arguments_,
				});
				expect(toolBody(invalid).error).toEqual(
					expect.objectContaining({ code: "VALIDATION_ERROR" }),
				);
			}
			expect(transforms).toBe(1);
		} finally {
			await connection?.close();
			await setup.cleanup();
		}
	});
});

it("distinguishes explicit ISO input from domain Date output and its JSON wire encoding", async () => {
	const { buildMockApp } =
		await import("../../questpie/test/utils/mocks/mock-app-builder.js");
	const dates = route()
		.post()
		.schema(z.object({ at: z.iso.datetime().pipe(z.coerce.date()) }))
		.outputSchema(z.object({ at: z.date() }))
		.access(true)
		.meta({ mcp: { expose: true, name: "dates" } })
		.handler(({ input }) => input);
	const setup = await buildMockApp({ routes: { "dates:POST": dates } });
	let connection: Awaited<ReturnType<typeof connect>> | undefined;
	try {
		connection = await connect(
			await createMcpServer(setup.app, {
				config: {
					routes: {
						routes: {
							dates: { operations: { execute: true }, requiredScopes: false },
						},
					},
				},
			}),
		);
		const descriptor = (await connection.client.listTools()).tools[0]!;
		expect(descriptor.inputSchema.properties?.at).toEqual(
			expect.objectContaining({ type: "string", format: "date-time" }),
		);
		expect(descriptor.outputSchema?.properties?.at).toEqual(
			expect.objectContaining({ type: "string", format: "date-time" }),
		);
		const result = await connection.client.callTool({
			name: "dates",
			arguments: { at: "2026-10-22T12:00:00.000Z" },
		});
		expect(result.structuredContent).toEqual({
			at: "2026-10-22T12:00:00.000Z",
		});
	} finally {
		await connection?.close();
		await setup.cleanup();
	}
});

it("keeps referenced schemas valid inside parameter and union-result envelopes", async () => {
	const { buildMockApp } =
		await import("../../questpie/test/utils/mocks/mock-app-builder.js");
	const { AjvJsonSchemaValidator } =
		await import("@modelcontextprotocol/sdk/validation/ajv-provider.js");
	const shared = z.object({ text: z.string() }).strict();
	const payload = z.object({ left: shared, right: shared }).strict();
	const referenced = route()
		.post()
		.params<{ id: string }>()
		.schema(payload)
		.outputSchema(z.union([payload, z.string()]))
		.access(true)
		.meta({ mcp: { expose: true, name: "referenced" } })
		.handler(({ input }) => input);
	const setup = await buildMockApp({
		routes: { "referenced/[id]:POST": referenced },
	});
	let connection: Awaited<ReturnType<typeof connect>> | undefined;
	try {
		connection = await connect(
			await createMcpServer(setup.app, {
				config: {
					routes: {
						routes: {
							"referenced/[id]": {
								operations: { execute: true },
								requiredScopes: false,
							},
						},
					},
				},
			}),
		);
		const descriptor = (await connection.client.listTools()).tools[0]!;
		const input = {
			params: { id: "real" },
			input: { left: { text: "left" }, right: { text: "right" } },
		};
		expect(descriptor.inputSchema.properties?.input).not.toHaveProperty(
			"$schema",
		);
		expect(descriptor.outputSchema?.properties?.value).not.toHaveProperty(
			"$schema",
		);
		expect(
			new AjvJsonSchemaValidator().getValidator(descriptor.inputSchema)(input)
				.valid,
		).toBe(true);

		const result = await connection.client.callTool({
			name: "referenced",
			arguments: input,
		});
		expect(result.structuredContent).toEqual({ value: input.input });
		expect(
			new AjvJsonSchemaValidator().getValidator(descriptor.outputSchema!)(
				result.structuredContent,
			).valid,
		).toBe(true);
	} finally {
		await connection?.close();
		await setup.cleanup();
	}
});
