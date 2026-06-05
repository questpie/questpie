import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createContextFactory } from "questpie/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiModule } from "@questpie/ai/modules/ai";
import { createMcpServer, mcpModule } from "@questpie/mcp";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import { activity } from "../collections/activity";
import { chatMessages } from "../collections/chat-messages";
import { chatSessions } from "../collections/chat-sessions";
import { environments } from "../collections/environments";
import assets from "../collections/assets";
import { models } from "../collections/models";
import { projects } from "../collections/projects";
import { providers } from "../collections/providers";
import { runLinks } from "../collections/run-links";
import { scheduleExecutions } from "../collections/schedule-executions";
import { schedules } from "../collections/schedules";
import { scripts } from "../collections/scripts";
import { secrets } from "../collections/secrets";
import { taskRelations } from "../collections/task-relations";
import { tasks } from "../collections/tasks";
import mcpConfig from "../config/mcp";
import { runCode } from "../mcp-tools/run-code";
import knowledgeResource from "../services/knowledge-resource";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "run-code-test", version: "1.0.0" });
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

function structured(result: { structuredContent?: unknown }) {
	return (result.structuredContent ?? {}) as Record<string, unknown>;
}

// The trusted in-process executor adapter runs the guest by `import()`-ing it as
// a `data:text/typescript` module. Bun transpiles+executes that natively; Node
// (the default Vitest pool) cannot import a `text/typescript` data URL, so the
// trusted exec path is Bun-only by design. Run this suite under `bun test`; it
// is skipped under Node so `vitest run` stays green. (Bun is the framework's
// production runtime.)
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

describe.skipIf(!isBun)("run_code code-mode tool (trusted executor path)", () => {
	let setup: { app: MockApp; cleanup: () => Promise<void> } | undefined;

	beforeEach(async () => {
		setup = await buildMockApp({
			modules: [mcpModule],
			collections: {
				ai_run_events: aiModule.collections.ai_run_events,
				ai_runs: aiModule.collections.ai_runs,
				ai_worker_leases: aiModule.collections.ai_worker_leases,
				ai_workers: aiModule.collections.ai_workers,
				activity,
				chat_messages: chatMessages,
				chat_sessions: chatSessions,
				environments,
				assets,
				models,
				projects,
				providers,
				run_links: runLinks,
				schedule_executions: scheduleExecutions,
				schedules,
				scripts,
				secrets,
				task_relations: taskRelations,
				tasks,
			},
			services: { knowledgeResource },
			mcpTools: { run_code: runCode },
			config: { mcp: mcpConfig },
		},
		{
			// Empty executor config = ENABLED with the built-in in-process trusted
			// adapter (unconfigured would disable it). This is the M2.5 trusted path.
			executor: {},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	it("executes a multi-step script (query -> transform -> write knowledge) in ONE call", async () => {
		const app = setup!.app;

		// Seed two tasks the script will query + summarize.
		await app.collections.tasks.create({
			title: "Ship onboarding",
			status: "backlog",
		} as never);
		await app.collections.tasks.create({
			title: "Fix login bug",
			status: "backlog",
		} as never);

		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		const server = await createMcpServer(app, {
			transport: "stdio",
			ctx: ctx as never,
		});
		const { client, close } = await connect(server);

		try {
			// The tool is advertised to the agent like any other MCP tool.
			const tools = await client.listTools();
			expect(tools.tools.map((t) => t.name)).toContain("run_code");

			// ONE call that would otherwise be: knowledge_list/collection query +
			// (transform) + knowledge_write + (read-back). The script reads
			// `globalThis.questpie`, loops, writes a note, and returns a summary.
			const source = [
				"export default async function (input) {",
				"  const q = globalThis.questpie;",
				"  const tasks = await q.collections.tasks.find({ where: { status: input.status }, orderBy: { title: 'asc' } });",
				"  const titles = tasks.docs.map((t) => t.title);",
				"  console.log('found', titles.length, 'tasks');",
				"  const lines = titles.map((t, i) => `${i + 1}. ${t}`).join('\\n');",
				"  await q.files.write({",
				"    path: 'company/digests/backlog.md',",
				"    title: 'Backlog digest',",
				"    content: `# Backlog\\n${lines}`,",
				"    scope: { scope_type: 'company' },",
				"  });",
				"  const back = await q.files.read({ path: 'company/digests/backlog.md', scope: { scope_type: 'company' } });",
				"  console.log('wrote digest at', back.path);",
				"  return { count: titles.length, titles, digestPath: back.path };",
				"}",
			].join("\n");

			const result = await client.callTool({
				name: "run_code",
				arguments: { source, input: { status: "backlog" } },
			});

			expect(result.isError).toBeUndefined();
			const out = structured(result);
			expect(out.ok).toBe(true);
			expect(out.timed_out).toBe(false);

			// Script return value is surfaced.
			const output = out.output as {
				count: number;
				titles: string[];
				digestPath: string;
			};
			expect(output.count).toBe(2);
			expect(output.titles).toEqual(["Fix login bug", "Ship onboarding"]);
			expect(output.digestPath).toBe("company/digests/backlog.md");

			// Console logs are captured and returned.
			expect(out.logs).toEqual([
				"log: found 2 tasks",
				"log: wrote digest at company/digests/backlog.md",
			]);

			// The side effect (file write) actually persisted via the real ctx.
			const stored = (await app.collections.assets.findOne({
				where: { path: "company/digests/backlog.md" },
			})) as { body?: string; sourceRef?: string } | null;
			expect(stored?.body).toBe("# Backlog\n1. Fix login bug\n2. Ship onboarding");
			expect(stored?.sourceRef).toBe("system");
		} finally {
			await close();
		}
	});

	it("returns ok:false with the guest error when the script throws (no host crash)", async () => {
		const app = setup!.app;
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		const server = await createMcpServer(app, {
			transport: "stdio",
			ctx: ctx as never,
		});
		const { client, close } = await connect(server);

		try {
			const result = await client.callTool({
				name: "run_code",
				arguments: {
					source:
						"export default async function () { throw new Error('boom'); }",
				},
			});
			expect(result.isError).toBeUndefined();
			const out = structured(result);
			expect(out.ok).toBe(false);
			expect(out.error).toContain("boom");
		} finally {
			await close();
		}
	});
});
