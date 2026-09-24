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
