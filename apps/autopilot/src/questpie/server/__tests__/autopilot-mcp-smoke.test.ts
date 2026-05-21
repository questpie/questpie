import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiModule } from "@questpie/ai/modules/ai";
import { createMcpServer, mcpModule } from "@questpie/mcp";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import { activity } from "../collections/activity";
import { capabilities } from "../collections/capabilities";
import { chatMessages } from "../collections/chat-messages";
import { chatSessions } from "../collections/chat-sessions";
import { environments } from "../collections/environments";
import { knowledge } from "../collections/knowledge";
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
import { workflowConfigs } from "../collections/workflow-configs";
import mcpConfig from "../config/mcp";
import {
	knowledgeDelete,
	knowledgeList,
	knowledgeRead,
	knowledgeSearch,
	knowledgeWrite,
} from "../mcp-tools/knowledge";
import {
	runEvents as runEventsTool,
	runGet,
	runList,
	taskGet,
	taskList,
} from "../mcp-tools/read-model";
import {
	artifactCreate,
	runArtifactContent,
	runArtifactCreate,
	runArtifacts,
} from "../mcp-tools/run-artifacts";
import taskCreate from "../mcp-tools/task-create";
import knowledgeResource from "../services/knowledge-resource";

async function connect(server: McpServer) {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({ name: "autopilot-smoke", version: "1.0.0" });
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

describe("Autopilot MCP smoke", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;

	beforeEach(async () => {
		setup = await buildMockApp({
			modules: [mcpModule],
			collections: {
				ai_run_events: aiModule.collections.ai_run_events,
				ai_runs: aiModule.collections.ai_runs,
				ai_worker_leases: aiModule.collections.ai_worker_leases,
				ai_workers: aiModule.collections.ai_workers,
				activity,
				capabilities,
				chat_messages: chatMessages,
				chat_sessions: chatSessions,
				environments,
				knowledge,
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
				workflow_configs: workflowConfigs,
			},
			services: {
				knowledgeResource,
			},
			mcpTools: {
				artifact_create: artifactCreate,
				knowledge_delete: knowledgeDelete,
				knowledge_list: knowledgeList,
				knowledge_read: knowledgeRead,
				knowledge_search: knowledgeSearch,
				knowledge_write: knowledgeWrite,
				run_artifact_content: runArtifactContent,
				run_artifact_create: runArtifactCreate,
				run_artifacts: runArtifacts,
				run_events: runEventsTool,
				run_get: runGet,
				run_list: runList,
				task_create: taskCreate,
				task_get: taskGet,
				task_list: taskList,
			},
			config: {
				mcp: mcpConfig,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	it("creates tasks and writes/reads run artifacts through MCP tools", async () => {
		const app = setup!.app;
		const server = await createMcpServer(app, { transport: "stdio" });
		const { client, close } = await connect(server);

		try {
			const tools = await client.listTools();
			const toolNames = tools.tools.map((tool) => tool.name);
			expect(toolNames).toEqual(
				expect.arrayContaining([
					"task_create",
					"task_get",
					"run_artifact_create",
					"run_artifacts",
					"run_artifact_content",
				]),
			);

			const taskResult = await client.callTool({
				name: "task_create",
				arguments: {
					title: "MCP smoke task",
					type: "feature",
					priority: "high",
					description: "Created through MCP",
					start: false,
				},
			});
			expect(taskResult.isError).toBeUndefined();
			const taskId = (taskResult.structuredContent as any).task_id as string;
			expect(taskId).toBeTruthy();

			const fetchedTask = await client.callTool({
				name: "task_get",
				arguments: { id: taskId },
			});
			expect((fetchedTask.structuredContent as any).title).toBe(
				"MCP smoke task",
			);

			const run = await app.collections.run_links.create({
				task: taskId,
				status: "pending",
				initiatedBy: "mcp",
				instructions: "Produce an artifact",
			});

			const artifactResult = await client.callTool({
				name: "run_artifact_create",
				arguments: {
					run_id: run.id,
					title: "note.md",
					content: "# Note",
					kind: "doc",
					ref_kind: "inline",
					mime_type: "text/markdown",
				},
			});
			expect(artifactResult.isError).toBeUndefined();
			const artifactId = (artifactResult.structuredContent as any).id as string;
			expect(artifactId).toBeTruthy();

			const artifacts = await client.callTool({
				name: "run_artifacts",
				arguments: { run_id: run.id },
			});
			expect(artifacts.structuredContent).toMatchObject({
				value: [
					expect.objectContaining({
						id: artifactId,
						run_id: run.id,
						ref_value: "# Note",
					}),
				],
			});

			const content = await client.callTool({
				name: "run_artifact_content",
				arguments: { run_id: run.id, artifact_id: artifactId },
			});
			expect(content.structuredContent).toMatchObject({
				content_type: "text/markdown",
				text: "# Note",
			});
		} finally {
			await close();
		}
	});
});
