import { createContextFactory } from "questpie/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { aiModule } from "@questpie/ai/modules/ai";

import {
	buildMockApp,
	type MockApp,
} from "../../../../../../packages/questpie/test/utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../../../../../packages/questpie/test/utils/test-db";
import { activity } from "../collections/activity";
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
import {
	resolveRuntimeSelection,
	type RuntimeResolution,
} from "../lib/runtime-selection";

describe("runtime selection", () => {
	let setup:
		| {
				app: MockApp;
				cleanup: () => Promise<void>;
		  }
		| undefined;

	let resolve: (input?: {
		modelId?: string | null;
		projectId?: string | null;
		runtime?: "claude-code" | "codex" | null;
	}) => Promise<RuntimeResolution>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				ai_run_events: aiModule.collections.ai_run_events,
				ai_runs: aiModule.collections.ai_runs,
				ai_worker_leases: aiModule.collections.ai_worker_leases,
				ai_workers: aiModule.collections.ai_workers,
				activity,
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
			},
		});
		await runTestDbMigrations(setup.app);

		const createContext = createContextFactory(setup.app);
		const ctx = await createContext({ accessMode: "system" });
		resolve = (input) => resolveRuntimeSelection(ctx, input);
	});

	afterEach(async () => {
		await setup?.cleanup();
		setup = undefined;
	});

	it("returns codex as default runtime when no models exist", async () => {
		const result = await resolve();

		expect(result.runtime).toBe("codex");
		expect(result.model).toBeNull();
		expect(result.provider).toBeNull();
	});

	it("resolves an explicit model by ID", async () => {
		const provider = await setup!.app.collections.providers.create({
			name: "Anthropic",
			type: "anthropic",
			enabled: true,
			config: { maxTokens: 8192 },
		} as any);
		const model = await setup!.app.collections.models.create({
			name: "Claude Opus",
			provider: provider.id,
			modelId: "claude-opus-4",
			runtime: "claude-code",
			enabled: true,
			config: { temperature: 0.7 },
		} as any);

		const result = await resolve({ modelId: model.id });

		expect(result.runtime).toBe("claude-code");
		expect(result.modelId).toBe(model.id);
		expect(result.providerId).toBe(provider.id);
		expect(result.providerConfig).toMatchObject({
			maxTokens: 8192,
			temperature: 0.7,
		});
	});

	it("falls back to the first enabled model when no explicit model", async () => {
		const provider = await setup!.app.collections.providers.create({
			name: "Default Provider",
			type: "anthropic",
			enabled: true,
		} as any);
		await setup!.app.collections.models.create({
			name: "Default Model",
			provider: provider.id,
			modelId: "claude-sonnet-4",
			runtime: "claude-code",
			enabled: true,
		} as any);

		const result = await resolve();

		expect(result.runtime).toBe("claude-code");
		expect(result.modelId).toBeTruthy();
	});

	it("prefers project-scoped provider model over global model", async () => {
		const project = await setup!.app.collections.projects.create({
			name: "Scoped Project",
			slug: "scoped-project",
			gitProvider: "github",
			defaultBranch: "main",
		} as any);
		const globalProvider = await setup!.app.collections.providers.create({
			name: "Global Provider",
			type: "anthropic",
			enabled: true,
		} as any);
		const projectProvider = await setup!.app.collections.providers.create({
			name: "Project Provider",
			type: "openai",
			project: project.id,
			enabled: true,
		} as any);
		await setup!.app.collections.models.create({
			name: "Global Model",
			provider: globalProvider.id,
			modelId: "claude-sonnet-4",
			runtime: "claude-code",
			enabled: true,
		} as any);
		const projectModel = await setup!.app.collections.models.create({
			name: "Project Model",
			provider: projectProvider.id,
			modelId: "gpt-5-codex",
			runtime: "codex",
			enabled: true,
		} as any);

		const result = await resolve({ projectId: project.id });

		expect(result.modelId).toBe(projectModel.id);
		expect(result.runtime).toBe("codex");
	});

	it("explicit runtime input overrides model runtime", async () => {
		const provider = await setup!.app.collections.providers.create({
			name: "Provider",
			type: "anthropic",
			enabled: true,
		} as any);
		const model = await setup!.app.collections.models.create({
			name: "Model",
			provider: provider.id,
			modelId: "claude-opus-4",
			runtime: "claude-code",
			enabled: true,
		} as any);

		const result = await resolve({
			modelId: model.id,
			runtime: "codex",
		});

		expect(result.runtime).toBe("codex");
		expect(result.modelId).toBe(model.id);
	});

	it("throws when explicit model ID is not found", async () => {
		await expect(
			resolve({ modelId: "non-existent-model-id" }),
		).rejects.toThrow();
	});

});
