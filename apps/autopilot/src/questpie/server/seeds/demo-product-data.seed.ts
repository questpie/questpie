import { seed } from "questpie/services";

const DEMO_PROJECT_SLUG = "questpie-autopilot-demo";

export default seed({
	id: "autopilotDemoProductData",
	description:
		"Demo Autopilot product data for local testing: project, workflow, schedule, knowledge, and issues",
	category: "dev",
	async run({ collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });

		const existing = await collections.projects.find(
			{ where: { slug: DEMO_PROJECT_SLUG }, limit: 1 },
			ctx,
		);
		if (existing.totalDocs > 0) {
			log("Autopilot demo product data already exists, skipping");
			return;
		}

		log("Creating Autopilot demo project...");
		const project = await collections.projects.create(
			{
				name: "QUESTPIE Autopilot",
				slug: DEMO_PROJECT_SLUG,
				path: "/workspaces/questpie-cms/apps/autopilot",
				gitProvider: "github",
				gitRemote: "git@github.com:questpie/questpie-cms.git",
				defaultBranch: "main",
				providerConfig: {
					connectionMode: "local",
					repositoryScope: "apps/autopilot",
				},
				metadata: {
					seed: "autopilotDemoProductData",
					template: "default-company",
				},
			},
			ctx,
		);

		log("Creating Autopilot demo skill...");
		const capability = await collections.capabilities.create(
			{
				name: "Product Engineering Agent",
				description:
					"Handles issue triage, focused implementation, browser verification, and concise handoff notes.",
				project: project.id,
				enabled: true,
				allowedTools: ["shell", "browser", "agent-board"],
				contextRefs: ["knowledge://company/autopilot/product-model"],
				runtimeHints: {
					mode: "surgical",
					researchFirst: true,
					useAgentBoard: true,
				},
				config: {
					defaultWorkflow: "research-plan-implement-verify",
				},
			},
			ctx,
		);

		log("Creating Autopilot demo workflow...");
		const workflow = await collections.workflow_configs.create(
			{
				name: "Research, implement, verify",
				description:
					"Default issue workflow for focused product engineering tasks.",
				project: project.id,
				defaultCapability: capability.id,
				enabled: true,
				version: 1,
				steps: [
					{
						id: "research",
						name: "Research",
						purpose: "Read product plan, current code, primitives, and i18n.",
					},
					{
						id: "plan",
						name: "Plan",
						purpose: "Write a small implementation plan with success criteria.",
					},
					{
						id: "implement",
						name: "Implement",
						purpose:
							"Make surgical changes through existing framework primitives.",
					},
					{
						id: "verify",
						name: "Verify",
						purpose: "Run generation, lint, typecheck, and browser checks.",
					},
				],
				config: {
					requires: ["research-first", "i18n", "browser-verification"],
				},
			},
			ctx,
		);

		log("Creating Autopilot demo knowledge...");
		await collections.knowledge.create(
			{
				title: "Autopilot product model",
				path: "company/autopilot/product-model",
				scopeType: "company",
				project: project.id,
				kind: "document",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "system",
				sourceRef: "seed:autopilot-product-model",
				body: [
					"# Autopilot product model",
					"",
					"Autopilot is a focused product for Issues, Workflows, Schedules, Knowledge, and Projects.",
					"",
					"Users should not need to understand workers, runs, leases, providers, models, queues, or raw workflow runtime internals.",
					"",
					"Creation should happen through product actions: prompt-driven AI issue creation and a manual Linear-like issue creator.",
				].join("\n"),
				contentHash: "seed-autopilot-product-model",
				metadata: {
					seed: "autopilotDemoProductData",
				},
			},
			ctx,
		);

		const tomorrow = new Date(Date.now() + 1000 * 60 * 60 * 24);
		const nextMonday = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3);

		log("Creating Autopilot demo schedule...");
		await collections.schedules.create(
			{
				name: "Weekly product triage",
				description:
					"Creates a review issue every Monday for product backlog and workflow health.",
				cron: "0 9 * * 1",
				timezone: "Europe/Bratislava",
				mode: "task",
				workflowConfig: workflow.id,
				taskTemplate: {
					title: "Weekly Autopilot product triage",
					type: "review",
					priority: "medium",
					project: project.id,
					scopeType: "project",
				},
				concurrencyPolicy: "skip",
				enabled: true,
				nextRunAt: nextMonday,
				createdBy: "seed:autopilotDemoProductData",
			},
			ctx,
		);

		log("Creating Autopilot demo issues...");
		const issues = [
			{
				title: "Design issue creation actions",
				description:
					"Define prompt-driven and manual issue creation flows using custom admin actions.",
				type: "feature",
				status: "backlog",
				priority: "high",
				context: {
					area: "issues",
					mode: ["prompt", "manual"],
				},
			},
			{
				title: "Implement seeded product workspace",
				description:
					"Create repeatable local data so the Autopilot admin can be tested as a product.",
				type: "task",
				status: "running",
				priority: "urgent",
				context: {
					area: "local-dev",
					testing: true,
				},
			},
			{
				title: "Review workflow list columns",
				description:
					"Confirm workflows read as reusable procedures rather than engine configuration.",
				type: "review",
				status: "review",
				priority: "medium",
				context: {
					area: "workflows",
				},
			},
			{
				title: "Investigate chat rail placement",
				description:
					"Decide whether chat belongs on Home, issue detail, workflow detail, or a persistent rail.",
				type: "research",
				status: "waiting",
				priority: "medium",
				context: {
					area: "chat",
				},
			},
			{
				title: "Fix default sort for system fields",
				description:
					"Make list default sorting support system fields like updatedAt without ugly top-bar selects.",
				type: "bug",
				status: "failed",
				priority: "high",
				context: {
					area: "admin-list",
					needsAttention: true,
				},
			},
			{
				title: "Verify admin CSS loading",
				description:
					"Confirm Tailwind source scanning includes package admin client files.",
				type: "task",
				status: "done",
				priority: "medium",
				context: {
					area: "admin-shell",
				},
			},
			{
				title: "Run scheduled knowledge refresh",
				description:
					"Scheduled issue used to test date filters and start-after behavior.",
				type: "task",
				status: "pending",
				priority: "low",
				startAfter: tomorrow,
				context: {
					area: "knowledge",
					scheduled: true,
				},
			},
		] as const;

		for (const issue of issues) {
			await collections.tasks.create(
				{
					...issue,
					project: project.id,
					scopeType: "project",
					workflowConfig: workflow.id,
					capability: capability.id,
					queue: "default",
					createdBy: "seed:autopilotDemoProductData",
					metadata: {
						seed: "autopilotDemoProductData",
					},
				},
				ctx,
			);
		}

		log("Autopilot demo product data created");
	},
});
