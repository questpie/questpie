import { seed } from "questpie/services";

const DEMO_PROJECT_SLUG = "questpie-autopilot-demo";

export default seed({
	id: "autopilotDemoProductData",
	description:
		"Demo Autopilot product data for local testing: project, schedule, knowledge, and issues",
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

		log("Creating Autopilot demo knowledge...");
		const productModelBody = [
			"# Autopilot product model",
			"",
			"Autopilot is a focused product for Issues, Automations, Knowledge, and Projects.",
			"",
			"Users should not need to understand workers, runs, leases, providers, models, queues, or raw durable runtime internals.",
			"",
			"Creation should happen through product actions: prompt-driven AI issue creation and a manual Linear-like issue creator.",
		].join("\n");
		await collections.assets.create(
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
				body: productModelBody,
				key: "company/autopilot/product-model.md",
				filename: "product-model.md",
				mimeType: "text/markdown",
				size: Buffer.byteLength(productModelBody, "utf8"),
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
					"Creates a review issue every Monday for product backlog and automation health.",
				cron: "0 9 * * 1",
				timezone: "Europe/Bratislava",
				mode: "task",
				taskTemplate: {
					title: "Weekly Autopilot product triage",
					description: "Review backlog and automation health.",
					type: "review",
					priority: "medium",
					projectId: project.id,
					project_id: project.id,
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
				title: "Review automation list columns",
				description:
					"Confirm automations read as simple schedules rather than engine configuration.",
				type: "review",
				status: "review",
				priority: "medium",
				context: {
					area: "automations",
				},
			},
			{
				title: "Investigate chat rail placement",
				description:
					"Decide whether chat belongs on Home, issue detail, automation detail, or a persistent rail.",
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
			const { context, ...issueData } = issue;
			await collections.tasks.create(
				{
					...issueData,
					project: project.id,
					scopeType: "project",
					queue: "default",
					createdBy: "seed:autopilotDemoProductData",
					context,
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
