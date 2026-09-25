import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { AppContext, RequestContext } from "questpie";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createMockUser,
	createTestContext,
} from "../../questpie/test/utils/test-context.js";
import {
	createMcpServer,
	createWorkloadMcpServer,
	mcpPrompts,
	resolveMcpCatalog,
} from "../src/exports/index.js";

// Each user owns the playbooks named here; the provider shows a caller only
// their own, which is what makes the list per-request.
const PLAYBOOKS: Record<string, Record<string, string>> = {
	alice: { onboarding: "Welcome aboard, step one.", release: "Cut the tag." },
	bob: { triage: "Sort the inbox by severity." },
};

let providerAllowed = true;
const seenCalls: string[] = [];

const playbookPrompts = mcpPrompts("playbooks", {
	access: ({ session }) => providerAllowed && !!session,
	scopes: "playbooks:read",
	list: ({ ctx }) => {
		seenCalls.push(`list:${ctx.session?.user.id}`);
		return Object.keys(PLAYBOOKS[ctx.session?.user.id ?? ""] ?? {}).map(
			(name) => ({ name, description: `Playbook ${name}` }),
		);
	},
	get: ({ ctx, name, arguments: args }) => {
		seenCalls.push(`get:${ctx.session?.user.id}:${name}`);
		const body = PLAYBOOKS[ctx.session?.user.id ?? ""]?.[name];
		if (body === undefined) return null;
		return {
			description: `Playbook ${name}`,
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: args.audience ? `${body} (for ${args.audience})` : body,
					},
				},
			],
		};
	},
});

const brokenPrompts = mcpPrompts("broken", {
	access: true,
	scopes: false,
	list: () => [{ description: "missing a name" } as never],
	get: () => ({ messages: "not an array" }) as never,
});

type Ctx = AppContext & Partial<RequestContext>;

function sessionFor(userId: string) {
	const user = createMockUser({ id: userId });
	return {
		user,
		session: {
			id: `sess-${userId}`,
			userId,
			token: "tok",
			expiresAt: new Date(Date.now() + 3_600_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	};
}

function oauthCtx(userId: string, scopes: string[]): Ctx {
	const session = sessionFor(userId);
	return createTestContext({
		accessMode: "user",
		session: session as any,
		principal: {
			kind: "oauth",
			user: session.user as any,
			clientId: "client-1",
			scopes,
			tokenId: "token-1",
		},
	} as any) as unknown as Ctx;
}

function userCtx(userId: string): Ctx {
	const session = sessionFor(userId);
	return createTestContext({
		accessMode: "user",
		session: session as any,
		principal: {
			kind: "user",
			user: session.user as any,
			session: session.session as any,
		},
	} as any) as unknown as Ctx;
}

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({
		name: "questpie-prompts-test",
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

async function withClient<T>(
	app: any,
	ctx: Ctx,
	run: (client: Client) => Promise<T>,
): Promise<T> {
	const server = await createMcpServer(app, { transport: "http", ctx });
	const { client, close } = await connect(server);
	try {
		return await run(client);
	} finally {
		await close();
	}
}

async function expectPromptNotFound(promise: Promise<unknown>) {
	const error = await promise.then(
		() => undefined,
		(caught: unknown) => caught,
	);
	expect(error).toBeInstanceOf(McpError);
	expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
	expect((error as McpError).message).toContain("Prompt not found");
}

describe("@questpie/mcp prompts", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		providerAllowed = true;
		seenCalls.length = 0;
		setup = await buildMockApp({ mcpPrompts: { playbookPrompts } });
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("advertises the prompts capability only when a provider is released", async () => {
		const withPrompts = await withClient(
			setup.app,
			userCtx("alice"),
			async (client) => client.getServerCapabilities(),
		);
		expect(withPrompts?.prompts).toEqual({});

		const bare = await buildMockApp({});
		try {
			const capabilities = await withClient(
				bare.app,
				userCtx("alice"),
				async (client) => client.getServerCapabilities(),
			);
			expect(capabilities?.prompts).toBeUndefined();
		} finally {
			await bare.cleanup();
		}
	});

	it("does not release a provider without an explicit access and scopes policy", async () => {
		const catalog = resolveMcpCatalog(
			{
				getCollections: () => ({}),
				getGlobals: () => ({}),
				state: {
					mcpPrompts: {
						noAccess: {
							...playbookPrompts,
							name: "no-access",
							config: { ...playbookPrompts.config, access: undefined },
						},
						denied: {
							...playbookPrompts,
							name: "denied",
							config: { ...playbookPrompts.config, access: false },
						},
						noScopes: {
							...playbookPrompts,
							name: "no-scopes",
							config: { ...playbookPrompts.config, scopes: undefined },
						},
						released: playbookPrompts,
					},
				},
			},
			{},
		);
		expect([...catalog.promptProviders.keys()]).toEqual(["playbooks"]);
		expect(catalog.oauth.scopes).toContain("playbooks:read");
	});

	it("lists only the caller's prompts, computed per request", async () => {
		const alice = await withClient(setup.app, userCtx("alice"), (client) =>
			client.listPrompts(),
		);
		expect(alice.prompts).toEqual([
			{ name: "onboarding", description: "Playbook onboarding" },
			{ name: "release", description: "Playbook release" },
		]);

		const bob = await withClient(setup.app, userCtx("bob"), (client) =>
			client.listPrompts(),
		);
		expect(bob.prompts).toEqual([
			{ name: "triage", description: "Playbook triage" },
		]);
		expect(seenCalls).toEqual(["list:alice", "list:bob"]);
	});

	it("renders a prompt with the caller's arguments", async () => {
		const result = await withClient(setup.app, userCtx("alice"), (client) =>
			client.getPrompt({
				name: "onboarding",
				arguments: { audience: "new hires" },
			}),
		);
		expect(result).toEqual({
			description: "Playbook onboarding",
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: "Welcome aboard, step one. (for new hires)",
					},
				},
			],
		});
	});

	it("answers not-found for an unknown name and for another caller's prompt alike", async () => {
		await withClient(setup.app, userCtx("bob"), async (client) => {
			await expectPromptNotFound(client.getPrompt({ name: "no-such-thing" }));
			await expectPromptNotFound(client.getPrompt({ name: "onboarding" }));
		});
	});

	it("re-evaluates access on every request and hides a denied provider entirely", async () => {
		await withClient(setup.app, userCtx("alice"), async (client) => {
			expect((await client.listPrompts()).prompts).toHaveLength(2);
			providerAllowed = false;
			expect((await client.listPrompts()).prompts).toEqual([]);
			await expectPromptNotFound(client.getPrompt({ name: "onboarding" }));
		});
		// The provider's own handlers never ran for the denied requests.
		expect(seenCalls).toEqual(["list:alice"]);
	});

	it("applies the OAuth scope gate to list and get", async () => {
		await withClient(setup.app, oauthCtx("alice", []), async (client) => {
			expect((await client.listPrompts()).prompts).toEqual([]);
			await expectPromptNotFound(client.getPrompt({ name: "onboarding" }));
		});
		await withClient(
			setup.app,
			oauthCtx("alice", ["playbooks:read"]),
			async (client) => {
				expect(
					(await client.listPrompts()).prompts.map((prompt) => prompt.name),
				).toEqual(["onboarding", "release"]);
				expect(
					(await client.getPrompt({ name: "release" })).messages[0]?.content,
				).toEqual({ type: "text", text: "Cut the tag." });
			},
		);
	});

	it("fails closed when a provider returns a malformed prompt", async () => {
		const broken = await buildMockApp({ mcpPrompts: { brokenPrompts } });
		try {
			await withClient(broken.app, userCtx("alice"), async (client) => {
				await expect(client.listPrompts()).rejects.toThrow(/internal/);
				await expect(client.getPrompt({ name: "anything" })).rejects.toThrow(
					/internal/,
				);
			});
		} finally {
			await broken.cleanup();
		}
	});

	it("rejects a cursor, since prompts/list never issues one", async () => {
		await withClient(setup.app, userCtx("alice"), async (client) => {
			const error = await client.listPrompts({ cursor: "page-2" }).then(
				() => undefined,
				(caught: unknown) => caught,
			);
			expect(error).toBeInstanceOf(McpError);
			expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
			expect((await client.listPrompts({})).prompts).toHaveLength(2);
		});
		expect(seenCalls).toEqual(["list:alice"]);
	});

	it("passes a provider's InvalidParams through and masks every other throw", async () => {
		const strict = mcpPrompts("strict", {
			access: true,
			scopes: false,
			list: () => [{ name: "needs-topic" }],
			get: ({ name, arguments: args }) => {
				if (name === "explodes") throw new Error("db password is hunter2");
				if (name === "wrong-code") {
					throw new McpError(ErrorCode.InternalError, "secret detail");
				}
				if (!args.topic) {
					throw new McpError(ErrorCode.InvalidParams, "topic is required");
				}
				return {
					messages: [
						{ role: "user", content: { type: "text", text: args.topic } },
					],
				};
			},
		});
		const app = await buildMockApp({ mcpPrompts: { strict } });
		try {
			await withClient(app.app, userCtx("alice"), async (client) => {
				const invalid = await client.getPrompt({ name: "needs-topic" }).then(
					() => undefined,
					(caught: unknown) => caught,
				);
				expect(invalid).toBeInstanceOf(McpError);
				expect((invalid as McpError).code).toBe(ErrorCode.InvalidParams);
				// The SDK prefixes an McpError's text once on each side of the wire.
				expect((invalid as McpError).message).toBe(
					"MCP error -32602: MCP error -32602: topic is required",
				);

				for (const name of ["explodes", "wrong-code"]) {
					const masked = await client.getPrompt({ name }).then(
						() => undefined,
						(caught: unknown) => caught,
					);
					expect((masked as McpError).code).toBe(ErrorCode.InternalError);
					expect((masked as McpError).message).toContain("internal");
					expect((masked as McpError).message).not.toContain("hunter2");
					expect((masked as McpError).message).not.toContain("secret detail");
				}

				expect(
					(
						await client.getPrompt({
							name: "needs-topic",
							arguments: { topic: "release" },
						})
					).messages[0]?.content,
				).toEqual({ type: "text", text: "release" });
			});
		} finally {
			await app.cleanup();
		}
	});

	it("lets the first released provider win a shared name in both list and get", async () => {
		const render = (text: string) => ({
			messages: [
				{ role: "user" as const, content: { type: "text" as const, text } },
			],
		});
		const first = mcpPrompts("first", {
			access: true,
			scopes: false,
			list: () => [{ name: "shared", description: "from first" }],
			get: ({ name }) => (name === "shared" ? render("first") : null),
		});
		const second = mcpPrompts("second", {
			access: true,
			scopes: false,
			list: () => [
				{ name: "shared", description: "from second" },
				{ name: "only-second", description: "second only" },
			],
			get: ({ name }) =>
				name === "shared" || name === "only-second"
					? render(`second:${name}`)
					: null,
		});
		const app = await buildMockApp({ mcpPrompts: { first, second } });
		try {
			await withClient(app.app, userCtx("alice"), async (client) => {
				expect((await client.listPrompts()).prompts).toEqual([
					{ name: "shared", description: "from first" },
					{ name: "only-second", description: "second only" },
				]);
				expect(
					(await client.getPrompt({ name: "shared" })).messages[0]?.content,
				).toEqual({ type: "text", text: "first" });
				expect(
					(await client.getPrompt({ name: "only-second" })).messages[0]
						?.content,
				).toEqual({ type: "text", text: "second:only-second" });
			});
		} finally {
			await app.cleanup();
		}
	});

	it("keeps title, arguments and _meta through the bounded copy", async () => {
		const described = mcpPrompts("described", {
			access: true,
			scopes: false,
			list: () => [
				{
					name: "brief",
					title: "Write a brief",
					description: "Draft a brief",
					arguments: [
						{ name: "audience", description: "Who reads it", required: true },
					],
					_meta: { "example.com/origin": { id: "brief-1" } },
				},
			],
			get: () => ({
				description: "Draft a brief",
				_meta: { "example.com/snapshot": "s-1" },
				messages: [
					{ role: "user", content: { type: "text", text: "Write it." } },
					{ role: "assistant", content: { type: "text", text: "On it." } },
				],
			}),
		});
		const app = await buildMockApp({ mcpPrompts: { described } });
		try {
			await withClient(app.app, userCtx("alice"), async (client) => {
				expect((await client.listPrompts()).prompts).toEqual([
					{
						name: "brief",
						title: "Write a brief",
						description: "Draft a brief",
						arguments: [
							{ name: "audience", description: "Who reads it", required: true },
						],
						_meta: { "example.com/origin": { id: "brief-1" } },
					},
				]);
				expect(await client.getPrompt({ name: "brief" })).toEqual({
					description: "Draft a brief",
					_meta: { "example.com/snapshot": "s-1" },
					messages: [
						{ role: "user", content: { type: "text", text: "Write it." } },
						{ role: "assistant", content: { type: "text", text: "On it." } },
					],
				});
			});
		} finally {
			await app.cleanup();
		}
	});

	it("never serves prompts to a remote workload", async () => {
		const server = await createWorkloadMcpServer(setup.app, {
			envelope: { opaque: true },
			authorizer: { authorize: () => ({ context: {} }) },
			contextBinder: {
				bind: async () => setup.app.createContext({ accessMode: "user" }),
			},
		});
		const { client, close } = await connect(server);
		try {
			expect(client.getServerCapabilities()?.prompts).toBeUndefined();
			await expect(client.listPrompts()).rejects.toThrow(/Method not found/);
		} finally {
			await close();
		}
	});
});
