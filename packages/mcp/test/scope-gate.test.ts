import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppContext, RequestContext } from "questpie";
import { collection, global, route } from "questpie";
import { z } from "zod";

import { buildMockApp } from "../../questpie/test/utils/mocks/mock-app-builder.js";
import {
	createMockUser,
	createTestContext,
} from "../../questpie/test/utils/test-context.js";
import { runTestDbMigrations } from "../../questpie/test/utils/test-db.js";
import { createMcpServer, mcpTool } from "../src/exports/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// `posts` — RBAC allows everything for an authenticated session. This isolates
// the SCOPE gate: what the oauth caller can reach here is decided purely by the
// scopes they hold (RBAC never denies).
const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required(),
	}))
	.access({
		read: ({ session }) => !!session,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	});

// `lockedNotes` — RBAC allows read but DENIES delete unconditionally. Used to
// prove the gate can never GRANT beyond RBAC: even holding the delete scope, an
// oauth caller cannot get the delete tool (RBAC denies independently).
const lockedNotes = collection("lockedNotes")
	.fields(({ f }) => ({
		title: f.text(255).required(),
	}))
	.access({
		read: ({ session }) => !!session,
		create: false,
		update: false,
		delete: false,
	});

const siteSettings = global("siteSettings")
	.fields(({ f }) => ({
		siteName: f.text(255).required(),
	}))
	.access({
		read: ({ session }) => !!session,
		update: ({ session }) => !!session,
	});

const reportRoute = route()
	.post()
	.schema(z.object({ period: z.enum(["day", "week"]) }))
	.outputSchema(z.object({ period: z.enum(["day", "week"]), ok: z.boolean() }))
	.meta({
		title: "Generate report",
		mcp: { expose: true, name: "reports.generate" },
	})
	.handler(async ({ input }) => ({ period: input.period, ok: true }));

const scopedCustomTool = mcpTool("custom.scoped", {
	description: "A custom tool gated on an explicit scope.",
	inputSchema: z.object({ message: z.string() }),
	scopes: "custom:scoped:use",
}).handler(async ({ input }) => ({
	structuredContent: { message: input.message },
	content: [{ type: "text", text: input.message }],
}));

const openCustomTool = mcpTool("custom.open", {
	description: "A custom tool with no scope requirement.",
	inputSchema: z.object({ message: z.string() }),
}).handler(async ({ input }) => ({
	structuredContent: { message: input.message },
	content: [{ type: "text", text: input.message }],
}));

// ---------------------------------------------------------------------------
// Principal / context fabrication
//
// The scope gate reads `ctx.principal` (kind + scopes) and, for RBAC, `session`.
// We fabricate the request context and hand it to `createMcpServer({ ctx })`,
// which the runtime returns verbatim from `getContext()`. This is exactly the
// shape MO6 populates for a real OAuth request.
// ---------------------------------------------------------------------------

function oauthCtx(scopes: string[]): AppContext & Partial<RequestContext> {
	const user = createMockUser({ id: "oauth-user-1" });
	const session = {
		id: "sess-oauth-1",
		userId: user.id,
		token: "tok",
		expiresAt: new Date(Date.now() + 3_600_000),
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	return createTestContext({
		// `user` accessMode so RBAC actually runs (not the system bypass).
		accessMode: "user",
		session: { user, session } as any,
		principal: {
			kind: "oauth",
			user: user as any,
			clientId: "client-1",
			scopes,
			tokenId: "token-1",
		},
	} as any) as unknown as AppContext & Partial<RequestContext>;
}

// A ctx whose oauth `scopes` array is MUTABLE by reference. Because the runtime
// returns this same ctx object from every `getContext()` call, mutating the
// array between registration and a later call lets us prove the call-time gate
// runs independently of the registration gate.
function mutableOauthCtx(scopesRef: { current: string[] }): {
	ctx: AppContext & Partial<RequestContext>;
} {
	const user = createMockUser({ id: "oauth-user-mut" });
	const session = {
		id: "sess-oauth-mut",
		userId: user.id,
		token: "tok",
		expiresAt: new Date(Date.now() + 3_600_000),
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const principal = {
		kind: "oauth" as const,
		user: user as any,
		clientId: "client-mut",
		tokenId: "token-mut",
		// Live view onto the mutable ref: `scopesFromContext` reads this each call.
		get scopes() {
			return scopesRef.current;
		},
	};
	const ctx = createTestContext({
		accessMode: "user",
		session: { user, session } as any,
		principal: principal as any,
	} as any) as unknown as AppContext & Partial<RequestContext>;
	return { ctx };
}

function userCtx(): AppContext & Partial<RequestContext> {
	const user = createMockUser({ id: "cookie-user-1" });
	const session = {
		id: "sess-user-1",
		userId: user.id,
		token: "tok",
		expiresAt: new Date(Date.now() + 3_600_000),
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	return createTestContext({
		accessMode: "user",
		session: { user, session } as any,
		// First-party cookie session: `user` principal, no scopes.
		principal: { kind: "user", user: user as any, session: session as any },
	} as any) as unknown as AppContext & Partial<RequestContext>;
}

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "questpie-scope-test", version: "1.0.0" });
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

async function listToolNames(
	ctx: AppContext & Partial<RequestContext>,
	app: any,
): Promise<string[]> {
	const server = await createMcpServer(app, { transport: "http", ctx });
	const { client, close } = await connect(server);
	try {
		const tools = await client.listTools();
		return tools.tools.map((tool) => tool.name).sort();
	} finally {
		await close();
	}
}

// List the tools a stdio (trusted `system`) transport exposes. Over stdio the
// runtime derives `accessMode: "system"` from the transport itself — no ctx is
// fabricated. This is how a `system` principal actually arises in production:
// `system` ⇔ `accessMode: "system"` (see `accessModeForPrincipal`); an HTTP
// request can NEVER be `system` (the adapter forces `"user"`), so modelling
// system-over-HTTP would be a fiction. stdio bypasses both RBAC and the scope
// gate, matching `mcp-server.test.ts`'s "stdio policy defaults" contract.
async function listStdioToolNames(app: any): Promise<string[]> {
	const server = await createMcpServer(app, { transport: "stdio" });
	const { client, close } = await connect(server);
	try {
		const tools = await client.listTools();
		return tools.tools.map((tool) => tool.name).sort();
	} finally {
		await close();
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MO8 OAuth scope gate", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { posts, lockedNotes },
			globals: { siteSettings },
			routes: { "reports/generate:POST": reportRoute },
			mcpTools: { scoped: scopedCustomTool, open: openCustomTool },
			// Enable write/delete tools over HTTP at the MCP-policy layer. The HTTP
			// transport default disables write/delete (read-only by default), so
			// without this NO principal ever sees create/update/delete — which would
			// mask the scope gate entirely. Mirrors `mcp-server.test.ts`. RBAC and the
			// scope gate still run on top: `lockedNotes` write/delete stay denied by
			// its `.access()` (proving the gate can only remove, never grant).
			config: {
				mcp: {
					crud: {
						collections: {
							posts: { read: true, write: true, delete: true },
							lockedNotes: { read: true, write: true, delete: true },
						},
						globals: {
							siteSettings: { read: true, write: true },
						},
					},
				},
			},
		});
		await runTestDbMigrations(setup.app);
		await setup.app.collections.posts.create(
			{ title: "Seeded" },
			createTestContext({ accessMode: "system" }),
		);
		await setup.app.collections.lockedNotes.create(
			{ title: "Secret note" },
			createTestContext({ accessMode: "system" }),
		);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	// ---- oauth: scopes narrow the visible tool set (registration) -----------

	it("oauth with only collections:posts:read sees read tools, not write/delete", async () => {
		const names = await listToolNames(
			oauthCtx(["collections:posts:read"]),
			setup.app,
		);

		// Held scope → read operations registered.
		expect(names).toContain("collections.posts.list");
		expect(names).toContain("collections.posts.count");
		expect(names).toContain("collections.posts.get");

		// Missing scopes → write/delete NOT registered.
		expect(names).not.toContain("collections.posts.create");
		expect(names).not.toContain("collections.posts.update");
		expect(names).not.toContain("collections.posts.delete");
	});

	it("oauth with read+write+delete scopes sees the full posts tool set", async () => {
		const names = await listToolNames(
			oauthCtx([
				"collections:posts:read",
				"collections:posts:write",
				"collections:posts:delete",
			]),
			setup.app,
		);
		expect(names).toContain("collections.posts.list");
		expect(names).toContain("collections.posts.create");
		expect(names).toContain("collections.posts.update");
		expect(names).toContain("collections.posts.delete");
	});

	// ---- oauth: the gate is ADDITIVE — scopes cannot exceed RBAC ------------

	it("oauth holding a delete scope still cannot reach an RBAC-denied delete (scopes ∩ RBAC)", async () => {
		const names = await listToolNames(
			oauthCtx([
				"collections:lockedNotes:read",
				"collections:lockedNotes:write",
				"collections:lockedNotes:delete",
			]),
			setup.app,
		);
		// RBAC allows read → read tools present even though scope alone is not enough.
		expect(names).toContain("collections.lockedNotes.list");
		expect(names).toContain("collections.lockedNotes.get");
		// RBAC denies write/delete unconditionally → NOT present despite held scopes.
		// Proves the scope gate can only remove, never grant, access.
		expect(names).not.toContain("collections.lockedNotes.create");
		expect(names).not.toContain("collections.lockedNotes.update");
		expect(names).not.toContain("collections.lockedNotes.delete");
	});

	// ---- oauth: globals, routes, and custom tools gated uniformly ------------

	it("oauth gates globals, routes, and custom tools by their required scopes", async () => {
		// Holds: global write, the route invoke, and the custom-tool scope — but
		// NOT the posts scopes.
		const names = await listToolNames(
			oauthCtx([
				"globals:siteSettings:read",
				"globals:siteSettings:write",
				"routes:reports/generate:invoke",
				"custom:scoped:use",
			]),
			setup.app,
		);
		expect(names).toContain("globals.siteSettings.get");
		expect(names).toContain("globals.siteSettings.update");
		expect(names).toContain("reports.generate");
		expect(names).toContain("custom.scoped");
		// No-scope custom tool is always visible to an oauth caller.
		expect(names).toContain("custom.open");
		// Missing posts scopes → posts tools hidden.
		expect(names).not.toContain("collections.posts.list");
	});

	it("oauth missing the route/global/custom scopes hides exactly those tools", async () => {
		const names = await listToolNames(
			oauthCtx(["collections:posts:read"]),
			setup.app,
		);
		expect(names).not.toContain("globals.siteSettings.get");
		expect(names).not.toContain("globals.siteSettings.update");
		expect(names).not.toContain("reports.generate");
		expect(names).not.toContain("custom.scoped");
		// The no-scope custom tool stays visible even to a narrowly-scoped caller.
		expect(names).toContain("custom.open");
	});

	// ---- user (cookie session): NO scope gate — RBAC only -------------------

	it("the same user via cookie session (kind:user) sees ALL RBAC-allowed tools, no scope gate", async () => {
		const names = await listToolNames(userCtx(), setup.app);
		// Full posts set — user principal carries no scopes, so the gate never fires.
		expect(names).toContain("collections.posts.list");
		expect(names).toContain("collections.posts.create");
		expect(names).toContain("collections.posts.update");
		expect(names).toContain("collections.posts.delete");
		// Global + route + scoped custom tool all visible (RBAC allows, no scope gate).
		expect(names).toContain("globals.siteSettings.get");
		expect(names).toContain("globals.siteSettings.update");
		expect(names).toContain("reports.generate");
		expect(names).toContain("custom.scoped");
		expect(names).toContain("custom.open");
		// RBAC still denies lockedNotes write/delete (unchanged for the user path).
		expect(names).toContain("collections.lockedNotes.list");
		expect(names).not.toContain("collections.lockedNotes.delete");
	});

	// ---- system (stdio): scope gate bypassed entirely -----------------------

	it("a system principal (stdio) bypasses the scope gate (full access)", async () => {
		// stdio ⇒ `accessMode: "system"`, the only way a `system` principal exists.
		// It bypasses RBAC (so RBAC-denied `lockedNotes.delete` is present) and the
		// scope gate (no scopes are consulted): the full tool set is exposed.
		const names = await listStdioToolNames(setup.app);
		expect(names).toContain("collections.posts.delete");
		expect(names).toContain("collections.lockedNotes.delete");
		expect(names).toContain("globals.siteSettings.update");
		expect(names).toContain("reports.generate");
		expect(names).toContain("custom.scoped");
	});

	// ---- Call-time defense in depth: a LISTED tool is denied at call time ----
	// if the scope is gone — proving the call-time gate is independent of the
	// registration gate (not merely "tool absent → tool-not-found error").

	it("denies a scope-gated CRUD call at call time even when the tool is still listed (hidden-tool-also-denied)", async () => {
		// This isolates the CALL-TIME gate from the registration gate. A single
		// server is built from a MUTABLE ctx that holds the delete scope at
		// registration (so `collections.posts.delete` registers AND appears in
		// tools/list). We then REVOKE the delete scope on that same ctx by mutating
		// the shared array. The tool is still listed and callable by name — but the
		// call-time gate re-reads the (now reduced) scopes and must DENY. If only
		// the registration gate existed, this call would go through: the tool was
		// registered while the scope was held. The denial proves defense in depth.
		const scopesRef = {
			current: ["collections:posts:read", "collections:posts:delete"],
		};
		const { ctx } = mutableOauthCtx(scopesRef);
		const server = await createMcpServer(setup.app, { transport: "http", ctx });
		const { client, close } = await connect(server);
		try {
			// Registered while the delete scope was held → present in tools/list.
			const before = (await client.listTools()).tools.map((t) => t.name);
			expect(before).toContain("collections.posts.delete");

			// Positive path: with the scope still held, a direct call succeeds.
			const seeded = await setup.app.collections.posts.create(
				{ title: "To delete (allowed)" },
				createTestContext({ accessMode: "system" }),
			);
			const allowedDel = await client.callTool({
				name: "collections.posts.delete",
				arguments: { id: (seeded as any).id },
			});
			expect(allowedDel.isError).toBeUndefined();

			// REVOKE the delete scope on the shared ctx. The tool stays registered
			// (registration already happened) and still appears in tools/list.
			scopesRef.current = ["collections:posts:read"];
			const stillListed = (await client.listTools()).tools.map((t) => t.name);
			expect(stillListed).toContain("collections.posts.delete");

			// A direct tools/call must now be DENIED by the call-time gate — NOT by
			// the tool being absent (it is present), but by the scope re-check.
			const seeded2 = await setup.app.collections.posts.create(
				{ title: "To delete (denied)" },
				createTestContext({ accessMode: "system" }),
			);
			const deniedDel = await client.callTool({
				name: "collections.posts.delete",
				arguments: { id: (seeded2 as any).id },
			});
			expect(deniedDel.isError).toBe(true);
			expect(JSON.stringify(deniedDel.content)).toContain("MCP access denied");

			// And the row was NOT deleted — the gate stopped the handler before the
			// CRUD call ran (the scope gate prevents the mutation, not just the reply).
			const survivor = await setup.app.collections.posts.findOne(
				{ where: { id: (seeded2 as any).id } },
				createTestContext({ accessMode: "system" }),
			);
			expect(survivor).not.toBeNull();
		} finally {
			await close();
		}
	});

	it("call-time gate denies a directly-invoked custom tool that is still listed after its scope is revoked", async () => {
		// Register the scoped custom tool under a ctx that HELD the scope (so it is
		// registered + listed) via a mutable ctx, then REVOKE the scope and confirm
		// a direct call to the still-listed tool is denied by the CALL-TIME gate —
		// not by the tool being absent (registration hiding), which a fresh
		// under-scoped server already covers, but by the independent re-check.
		const scopesRef = { current: ["custom:scoped:use"] };
		const { ctx } = mutableOauthCtx(scopesRef);
		const server = await createMcpServer(setup.app, { transport: "http", ctx });
		const { client, close } = await connect(server);
		try {
			// Registered while the scope was held → present in tools/list.
			expect((await client.listTools()).tools.map((t) => t.name)).toContain(
				"custom.scoped",
			);

			// Revoke the scope; the tool stays listed but the call-time gate fires.
			scopesRef.current = [];
			expect((await client.listTools()).tools.map((t) => t.name)).toContain(
				"custom.scoped",
			);

			const res = await client.callTool({
				name: "custom.scoped",
				arguments: { message: "sneaky" },
			});
			expect(res.isError).toBe(true);
			expect(JSON.stringify(res.content)).toContain("MCP access denied");
		} finally {
			await close();
		}
	});

	it("a fresh under-scoped server hides the scoped custom tool entirely (registration gate)", async () => {
		// Complements the call-time test: a caller that never held the scope does
		// not even see the tool, and a blind call-by-name errors (tool-not-found).
		const missing = await createMcpServer(setup.app, {
			transport: "http",
			ctx: oauthCtx(["collections:posts:read"]), // no custom:scoped:use
		});
		const m = await connect(missing);
		try {
			const names = (await m.client.listTools()).tools.map((t) => t.name);
			expect(names).not.toContain("custom.scoped");

			const res = await m.client.callTool({
				name: "custom.scoped",
				arguments: { message: "sneaky" },
			});
			expect(res.isError).toBe(true);
		} finally {
			await m.close();
		}
	});

	it("call-time gate: an oauth caller with the scope can invoke; the same operation is denied for a caller without it", async () => {
		// Positive: scoped custom tool callable when the scope is held.
		const allowed = await createMcpServer(setup.app, {
			transport: "http",
			ctx: oauthCtx(["custom:scoped:use"]),
		});
		const a = await connect(allowed);
		try {
			const res = await a.client.callTool({
				name: "custom.scoped",
				arguments: { message: "ok" },
			});
			expect(res.isError).toBeUndefined();
			expect(res.structuredContent).toEqual({ message: "ok" });
		} finally {
			await a.close();
		}
	});
});
