/** Adapter/context experiment; fixture credentials and an in-memory domain, no DB. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

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

const toolName = "tasks.rename";
const inputSchema = z
	.object({
		companyId: z.literal("company-a"),
		taskId: z.literal("task-1"),
		expectedVersion: z.number().int().positive(),
		idempotencyKey: z.string().min(1),
		title: z.string().min(1),
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
	return result;
}

// The ONLY product definition, validation, output and access declaration.
const operation = route()
	.post()
	.schema(inputSchema)
	.outputSchema(outputSchema)
	.access((ctx) =>
		productPolicy((ctx as { verifiedSubjectId?: string }).verifiedSubjectId),
	)
	.meta({
		mcp: { expose: true, name: toolName, annotations: { readOnlyHint: false } },
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
	t: (key: string) => key,
	createContext: async (options: Record<string, unknown> = {}) => {
		const authority = options.actor ? agent : human;
		return {
			...options,
			...authority,
			db,
			accessMode: "user" as const,
			principal: options.actor
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

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "operation-parity-prototype",
		version: "1.0.0",
	});
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return {
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
}
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
				const context = await appFixture.createContext({ actor: agent.actor });
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
const raw: Record<string, unknown> = {};
// InMemoryTransport preserves null prototypes; compare the JSON wire contract.
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const checks: string[] = [];
const check = (name: string, fn: () => void) => {
	fn();
	checks.push(name);
};
const mcpCode = (value: unknown) =>
	(value as { _meta?: { "questpie/error"?: { code: string } } })._meta?.[
		"questpie/error"
	]?.code;

try {
	const humanCatalog = (await humanMcp.client.listTools()).tools;
	const agentCatalog = (await agentMcp.client.listTools()).tools;
	check("same catalog name/input/output schemas", () => {
		assert.equal(humanCatalog.length, 1);
		assert.equal(agentCatalog.length, 1);
		assert.equal(humanCatalog[0]!.name, toolName);
		assert.equal(agentCatalog[0]!.name, toolName);
		assert.deepEqual(
			wire(agentCatalog[0]!.inputSchema),
			wire(humanCatalog[0]!.inputSchema),
		);
		assert.deepEqual(
			wire(agentCatalog[0]!.outputSchema),
			wire(humanCatalog[0]!.outputSchema),
		);
		assert(humanCatalog[0]!.outputSchema);
		assert.deepEqual(
			Object.keys(humanCatalog[0]!.inputSchema.properties!).sort(),
			Object.keys(input).sort(),
		);
	});
	raw.catalog = { human: humanCatalog, agent: agentCatalog };
	const lanes = [
		{
			name: "human-http",
			authority: human,
			call: async (body: unknown) => {
				const response = await fetchHandler(
					new Request("http://fixture.local/tasks/rename", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
				);
				assert(response);
				return { status: response.status, body: await response.json() };
			},
		},
		...[
			{ name: "human-mcp", connection: humanMcp, authority: human },
			{ name: "agent-workload-mcp", connection: agentMcp, authority: agent },
		].map((lane) => ({
			name: lane.name,
			authority: lane.authority,
			call: (body: unknown) =>
				lane.connection.client.callTool({
					name: toolName,
					arguments: body as Record<string, unknown>,
				}),
		})),
	];
	for (const lane of lanes) {
		state = { taskId: "task-1", title: "Before", version: 1 };
		receipts.clear();
		const read = (value: unknown) =>
			wire(
				lane.name === "human-http"
					? (value as { body: unknown }).body
					: (value as { structuredContent?: unknown }).structuredContent,
			);
		const applied = await lane.call(input);
		const replay = await lane.call(input);
		check(
			`${lane.name}: same success, replay and server actor/workload`,
			() => {
				assert.deepEqual(read(applied), {
					taskId: "task-1",
					title: "After",
					version: 2,
					replayed: false,
				});
				assert.deepEqual(read(replay), {
					taskId: "task-1",
					title: "After",
					version: 2,
					replayed: true,
				});
				assert.deepEqual(invocations.at(-1)!.actor, lane.authority.actor);
				assert.deepEqual(invocations.at(-1)!.workload, lane.authority.workload);
			},
		);
		const conflict = await lane.call({ ...input, idempotencyKey: "rename-2" });
		const before = invocations.length;
		const injection = await lane.call({
			...input,
			actor: { kind: "agent", subjectId: "forged" },
			requesterRunId: "forged",
		});
		check(`${lane.name}: injection rejected before executor`, () =>
			assert.equal(invocations.length, before),
		);
		allowed = false;
		const denied = await lane.call(input);
		allowed = true;
		check(`${lane.name}: shared product policy blocks executor`, () =>
			assert.equal(invocations.length, before),
		);
		check(`${lane.name}: native error behavior reproduced`, () => {
			if (lane.name === "human-http") {
				assert.equal((conflict as { status: number }).status, 409);
				assert.equal((denied as { status: number }).status, 403);
				assert.equal((injection as { status: number }).status, 400);
			} else {
				assert.equal(mcpCode(conflict), "internal");
				assert.equal(mcpCode(denied), "access_denied");
				assert.equal((injection as { isError?: boolean }).isError, true);
			}
			assert.equal(state.version, 2);
		});
		raw[lane.name] = { applied, replay, conflict, injection, denied };
	}
	const agentInvocation = invocations.find(
		(call) => call.actor.kind === "agent",
	)!;
	check("custom run extension bundle survives but flat field is lost", () => {
		assert.equal(agentInvocation.bundledRun, "run-1");
		assert.equal(agentInvocation.flatRun, undefined);
	});
	console.log(
		JSON.stringify(
			{
				sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
					cwd: import.meta.dir,
					encoding: "utf8",
				}).trim(),
				bunVersion: Bun.version,
				resolvedModules: {
					questpie: import.meta.resolve("questpie"),
					mcpSdk: import.meta
						.resolve("@modelcontextprotocol/sdk/client/index.js"),
					zod: import.meta.resolve("zod"),
				},
				fixtureOnly: true,
				checks,
				invocations,
				authorizationRequests,
				raw,
				gaps: [
					"Thrown ApiError.conflict becomes MCP internal; HTTP preserves CONFLICT/409.",
					"Custom requesterRunId survives only inside ~contextExtensions, not as a flat route-handler field.",
				],
			},
			null,
			2,
		),
	);
} finally {
	await humanMcp.close();
	await agentMcp.close();
}
