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
import {
	scheduleGet,
	scheduleList,
	scheduleTrigger,
} from "../mcp-tools/schedule-tools";
import taskCreate from "../mcp-tools/task-create";
import { taskDependencies, taskDependents } from "../mcp-tools/task-graph";
import { taskCancel, taskRetry, taskUpdate } from "../mcp-tools/task-mutations";
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

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value && "id" in value) {
		const id = (value as { id?: unknown }).id;
		return typeof id === "string" ? id : null;
	}
	return null;
}

function arrayValue<T = Record<string, unknown>>(result: {
	structuredContent?: unknown;
}): T[] {
	const value = (result.structuredContent as { value?: unknown })?.value;
	return Array.isArray(value) ? (value as T[]) : [];
}

async function connectMcp(app: MockApp) {
	const triggeredWorkflows: Array<{
		name: string;
		input: Record<string, unknown>;
		options?: Record<string, unknown>;
	}> = [];
	const createContext = createContextFactory(app);
	const ctx = await createContext({ accessMode: "system" });
	(ctx as any).workflows = {
		async trigger(
			name: string,
			input: Record<string, unknown>,
			options?: Record<string, unknown>,
		) {
			triggeredWorkflows.push({ name, input, options });
			return { instanceId: `wf-${triggeredWorkflows.length}`, existing: false };
		},
		async sendEvent() {},
	};
	const server = await createMcpServer(app, {
		transport: "stdio",
		ctx: ctx as any,
	});
	const { client, close } = await connect(server);
	return { client, close, triggeredWorkflows };
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
				schedule_get: scheduleGet,
				schedule_list: scheduleList,
				schedule_trigger: scheduleTrigger,
				task_cancel: taskCancel,
				task_create: taskCreate,
				task_dependencies: taskDependencies,
				task_dependents: taskDependents,
				task_get: taskGet,
				task_list: taskList,
				task_retry: taskRetry,
				task_update: taskUpdate,
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
		const triggeredWorkflows: Array<{
			name: string;
			input: Record<string, unknown>;
			options?: Record<string, unknown>;
		}> = [];
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "system" });
		(ctx as any).workflows = {
			async trigger(
				name: string,
				input: Record<string, unknown>,
				options?: Record<string, unknown>,
			) {
				triggeredWorkflows.push({ name, input, options });
				return {
					instanceId: `wf-${triggeredWorkflows.length}`,
					existing: false,
				};
			},
			async sendEvent() {},
		};
		const server = await createMcpServer(app, {
			transport: "stdio",
			ctx: ctx as any,
		});
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
					start: true,
				},
			});
			expect(taskResult.isError).toBeUndefined();
			const taskId = (taskResult.structuredContent as any).task_id as string;
			expect(taskId).toBeTruthy();
			expect(
				(await app.collections.tasks.findOne({ where: { id: taskId } }))
					?.createdBy,
			).toBe("system");

			const fetchedTask = await client.callTool({
				name: "task_get",
				arguments: { id: taskId },
			});
			expect((fetchedTask.structuredContent as any).title).toBe(
				"MCP smoke task",
			);
			expect(triggeredWorkflows).toEqual([
				expect.objectContaining({
					name: "task-pipeline",
					input: expect.objectContaining({
						taskId,
						runReason: "mcp",
						requestedBy: "system",
					}),
					options: expect.objectContaining({
						idempotencyKey: `task-pipeline:${taskId}`,
					}),
				}),
			]);

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
			const resource = await app.collections.assets.findOne({
				where: { id: artifactId } as any,
			});
			expect(resource).toMatchObject({
				title: "note.md",
				body: "# Note",
				contentType: "text/markdown",
			});
			expect(relationId(resource?.run)).toBe(run.id);
			expect(relationId(resource?.task)).toBe(taskId);

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

	it("decomposes work into child tasks that re-enter task-pipeline (no DSL)", async () => {
		const app = setup!.app;
		const { client, close, triggeredWorkflows } = await connectMcp(app);
		try {
			const parent = await client.callTool({
				name: "task_create",
				arguments: { title: "Parent goal", start: false },
			});
			const parentId = (parent.structuredContent as any).task_id as string;
			expect(parentId).toBeTruthy();

			const child1 = await client.callTool({
				name: "task_create",
				arguments: { title: "Subtask 1", depends_on: [parentId], start: true },
			});
			const child1Id = (child1.structuredContent as any).task_id as string;
			const child2 = await client.callTool({
				name: "task_create",
				arguments: { title: "Subtask 2", depends_on: [parentId], start: true },
			});
			const child2Id = (child2.structuredContent as any).task_id as string;

			// Decomposition is recursion through the SAME thin primitive: each started
			// child re-enters task-pipeline. No fanout/join graph node.
			const pipelineTaskIds = triggeredWorkflows
				.filter((wf) => wf.name === "task-pipeline")
				.map((wf) => wf.input.taskId);
			expect(pipelineTaskIds.sort()).toEqual([child1Id, child2Id].sort());

			// The dependency graph is recorded and inspectable through MCP.
			const dependents = await client.callTool({
				name: "task_dependents",
				arguments: { id: parentId },
			});
			expect(
				arrayValue<{ id: string }>(dependents)
					.map((task) => task.id)
					.sort(),
			).toEqual([child1Id, child2Id].sort());

			const dependencies = await client.callTool({
				name: "task_dependencies",
				arguments: { id: child1Id },
			});
			expect(
				arrayValue<{ id: string }>(dependencies).map((task) => task.id),
			).toEqual([parentId]);
		} finally {
			await close();
		}
	});

	it("writes, reads, lists, and searches knowledge artifacts through MCP", async () => {
		const app = setup!.app;
		const { client, close } = await connectMcp(app);
		try {
			const written = await client.callTool({
				name: "knowledge_write",
				arguments: {
					path: "company/smoke/note.md",
					title: "Smoke note",
					content: "# Smoke artifact",
					scope_type: "company",
				},
			});
			expect(written.isError).toBeUndefined();
			const writtenPath = (written.structuredContent as any).path as string;
			expect(writtenPath).toBeTruthy();

			const read = await client.callTool({
				name: "knowledge_read",
				arguments: { path: writtenPath, scope_type: "company" },
			});
			expect((read.structuredContent as any).body).toBe("# Smoke artifact");
			expect((read.structuredContent as any).title).toBe("Smoke note");
			expect((read.structuredContent as any).sourceRef).toBe("system");

			const listed = await client.callTool({
				name: "knowledge_list",
				arguments: { path: "company/smoke", scope_type: "company" },
			});
			expect(
				arrayValue<{ path: string }>(listed).map((doc) => doc.path),
			).toContain(writtenPath);

			const found = await client.callTool({
				name: "knowledge_search",
				arguments: { query: "Smoke", scope_type: "company" },
			});
			expect(
				arrayValue<{ path: string }>(found).map((doc) => doc.path),
			).toContain(writtenPath);
		} finally {
			await close();
		}
	});

	it("exposes task and run state through read-model MCP tools", async () => {
		const app = setup!.app;
		const { client, close } = await connectMcp(app);
		try {
			const created = await client.callTool({
				name: "task_create",
				arguments: { title: "Readable task", start: false },
			});
			const taskId = (created.structuredContent as any).task_id as string;

			const run = await app.collections.run_links.create({
				task: taskId,
				status: "running",
				initiatedBy: "mcp",
				instructions: "Inspect me",
			});

			const tasksList = await client.callTool({
				name: "task_list",
				arguments: { status: "backlog" },
			});
			expect(
				arrayValue<{ id: string }>(tasksList).map((task) => task.id),
			).toContain(taskId);

			const runs = await client.callTool({
				name: "run_list",
				arguments: { task_id: taskId },
			});
			expect(arrayValue<{ id: string }>(runs).map((item) => item.id)).toContain(
				run.id,
			);

			const got = await client.callTool({
				name: "run_get",
				arguments: { id: run.id },
			});
			expect((got.structuredContent as any).status).toBe("running");

			const events = await client.callTool({
				name: "run_events",
				arguments: { id: run.id },
			});
			expect(arrayValue(events)).toEqual([]);
		} finally {
			await close();
		}
	});

	it("updates, cancels, and retries tasks through MCP mutation tools", async () => {
		const app = setup!.app;
		const { client, close, triggeredWorkflows } = await connectMcp(app);
		try {
			const created = await client.callTool({
				name: "task_create",
				arguments: { title: "Mutable task", start: false },
			});
			const taskId = (created.structuredContent as any).task_id as string;

			await client.callTool({
				name: "task_update",
				arguments: { id: taskId, priority: "urgent", status: "review" },
			});
			const afterUpdate = await app.collections.tasks.findOne({
				where: { id: taskId },
			});
			expect(afterUpdate?.priority).toBe("urgent");
			expect(afterUpdate?.status).toBe("review");

			const cancelTarget = await client.callTool({
				name: "task_create",
				arguments: { title: "Cancel me", start: false },
			});
			const cancelId = (cancelTarget.structuredContent as any)
				.task_id as string;
			await client.callTool({
				name: "task_cancel",
				arguments: { id: cancelId, reason: "obsolete" },
			});
			expect(
				(await app.collections.tasks.findOne({ where: { id: cancelId } }))
					?.status,
			).toBe("cancelled");

			// Retry resets to pending and re-enters task-pipeline (same primitive).
			const retry = await client.callTool({
				name: "task_retry",
				arguments: { id: cancelId },
			});
			expect(retry.isError).toBeUndefined();
			expect(
				(await app.collections.tasks.findOne({ where: { id: cancelId } }))
					?.status,
			).toBe("pending");
			expect(
				triggeredWorkflows.some(
					(wf) =>
						wf.name === "task-pipeline" &&
						wf.input.taskId === cancelId &&
						wf.input.runReason === "retry",
				),
			).toBe(true);
		} finally {
			await close();
		}
	});

	it("lists, gets, and triggers schedules through MCP", async () => {
		const app = setup!.app;
		const { client, close } = await connectMcp(app);
		try {
			const schedule = await app.collections.schedules.create({
				name: "Daily review",
				cron: "0 9 * * *",
				timezone: "UTC",
				mode: "task",
				enabled: true,
				concurrencyPolicy: "allow",
				taskTemplate: {
					title: "Daily review",
					type: "review",
					priority: "medium",
				},
			} as any);

			const listed = await client.callTool({
				name: "schedule_list",
				arguments: { mode: "task" },
			});
			expect(
				arrayValue<{ id: string }>(listed).map((item) => item.id),
			).toContain(schedule.id);

			const got = await client.callTool({
				name: "schedule_get",
				arguments: { id: schedule.id },
			});
			expect((got.structuredContent as any).name).toBe("Daily review");

			const triggered = await client.callTool({
				name: "schedule_trigger",
				arguments: { id: schedule.id },
			});
			expect((triggered.structuredContent as any).schedule_id).toBe(
				schedule.id,
			);
			expect(
				(
					await app.collections.schedules.findOne({
						where: { id: schedule.id },
					})
				)?.nextRunAt,
			).toBeTruthy();
		} finally {
			await close();
		}
	});

	it("writes project-scoped knowledge with provenance and deletes it through MCP", async () => {
		const app = setup!.app;
		const { client, close } = await connectMcp(app);
		try {
			const project = await app.collections.projects.create({
				name: "Docs Project",
				slug: "docs-project",
				gitProvider: "github",
				defaultBranch: "main",
			} as any);

			const written = await client.callTool({
				name: "knowledge_write",
				arguments: {
					path: "projects/docs-project/spec.md",
					title: "Project spec",
					content: "scoped body",
					scope_type: "project",
					project_id: project.id,
				},
			});
			expect(written.isError).toBeUndefined();
			const resourceId = (written.structuredContent as any).id as string;
			const stored = (await app.collections.assets.findOne({
				where: { id: resourceId } as any,
			})) as
				| { scopeType?: string; project?: unknown; sourceRef?: string }
				| null;
			expect(stored?.scopeType).toBe("project");
			expect(relationId(stored?.project)).toBe(project.id);
			expect(stored?.sourceRef).toBe("system");

			const read = await client.callTool({
				name: "knowledge_read",
				arguments: {
					path: "projects/docs-project/spec.md",
					scope_type: "project",
					project_id: project.id,
				},
			});
			expect((read.structuredContent as any).body).toBe("scoped body");

			const deleted = await client.callTool({
				name: "knowledge_delete",
				arguments: {
					path: "projects/docs-project/spec.md",
					scope_type: "project",
					project_id: project.id,
				},
			});
			expect((deleted.structuredContent as any).deleted).toBe(true);
			expect(
				await app.collections.assets.findOne({
					where: { id: resourceId } as any,
				}),
			).toBeFalsy();
		} finally {
			await close();
		}
	});

	it("attributes authenticated MCP session mutations to the session user id", async () => {
		const app = setup!.app;
		const triggeredWorkflows: Array<{
			name: string;
			input: Record<string, unknown>;
			options?: Record<string, unknown>;
		}> = [];
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "user" });
		(ctx as any).session = {
			user: { id: "agent-user-1" },
			session: { id: "agent-session-1" },
		};
		(ctx as any).workflows = {
			async trigger(
				name: string,
				input: Record<string, unknown>,
				options?: Record<string, unknown>,
			) {
				triggeredWorkflows.push({ name, input, options });
				return {
					instanceId: `wf-${triggeredWorkflows.length}`,
					existing: false,
				};
			},
			async sendEvent() {},
		};
		const server = await createMcpServer(app, {
			transport: "http",
			ctx: ctx as any,
		});
		const { client, close } = await connect(server);

		try {
			const created = await client.callTool({
				name: "task_create",
				arguments: { title: "Agent-authored task", start: true },
			});
			expect(created.isError).toBeUndefined();
			const taskId = (created.structuredContent as any).task_id as string;
			const task = await app.collections.tasks.findOne({
				where: { id: taskId },
			});
			expect(task?.createdBy).toBe("agent-user-1");
			expect(triggeredWorkflows[0]?.input).toMatchObject({
				taskId,
				requestedBy: "agent-user-1",
			});
			const activity = await app.collections.activity.findOne({
				where: { task: taskId, type: "task.intake" },
			});
			expect(activity?.actor).toBe("agent-user-1");

			const written = await client.callTool({
				name: "knowledge_write",
				arguments: {
					path: "company/agent-authored-note.md",
					content: "agent body",
					scope_type: "company",
				},
			});
			expect(written.isError).toBeUndefined();
			expect((written.structuredContent as any).sourceRef).toBe("agent-user-1");
		} finally {
			await close();
		}
	});

	it("rejects HTTP MCP mutations when no authenticated principal is present", async () => {
		const app = setup!.app;
		const createContext = createContextFactory(app);
		const ctx = await createContext({ accessMode: "user" });
		const server = await createMcpServer(app, {
			transport: "http",
			ctx: ctx as any,
		});
		const { client, close } = await connect(server);

		try {
			const result = await client.callTool({
				name: "task_create",
				arguments: { title: "Unauthenticated task" },
			});
			expect(result.isError).toBe(true);
			expect(result.content?.[0]?.text).toContain(
				"MCP authentication required",
			);
		} finally {
			await close();
		}
	});
});
