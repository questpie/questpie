import { seed } from "questpie/services";

const COVERAGE_SEED_ID = "autopilotDemoCoverageData";

async function findFirst(
	collection: any,
	where: Record<string, unknown>,
	ctx: unknown,
) {
	const result = await collection.find({ where, limit: 1 }, ctx);
	return result.docs[0] ?? null;
}

export default seed({
	id: COVERAGE_SEED_ID,
	description:
		"Additional Autopilot demo coverage for list, outline, relation, and schedule display testing",
	category: "dev",
	dependsOn: ["autopilotDemoProductData"],
	async run({ collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });
		const now = new Date();
		const tomorrow = new Date(now.getTime() + 1000 * 60 * 60 * 24);
		const nextWeek = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);
		const lastWeek = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7);

		const ensureProject = async (project: Record<string, unknown>) => {
			const existing = await findFirst(
				collections.projects,
				{ slug: project.slug },
				ctx,
			);
			if (existing) return existing;
			return collections.projects.create(project as any, ctx);
		};

		const ensureSchedule = async (schedule: Record<string, unknown>) => {
			const existing = await findFirst(
				collections.schedules,
				{ name: schedule.name },
				ctx,
			);
			if (existing) return existing;
			return collections.schedules.create(schedule as any, ctx);
		};

		const ensureIssue = async (issue: Record<string, unknown>) => {
			const existing = await findFirst(
				collections.tasks,
				{ title: issue.title },
				ctx,
			);
			if (existing) return existing;
			return collections.tasks.create(issue as any, ctx);
		};

		const ensureKnowledge = async (entry: Record<string, unknown>) => {
			const existing = await findFirst(
				collections.knowledge,
				{ path: entry.path },
				ctx,
			);
			if (existing) return existing;
			return collections.knowledge.create(entry as any, ctx);
		};

		log("Creating Autopilot coverage projects...");
		const autopilot = await ensureProject({
			name: "QUESTPIE Autopilot",
			slug: "questpie-autopilot-demo",
			path: "/workspaces/questpie-cms/apps/autopilot",
			gitProvider: "github",
			gitRemote: "git@github.com:questpie/questpie-cms.git",
			defaultBranch: "main",
			providerConfig: {
				connectionMode: "local",
				repositoryScope: "apps/autopilot",
				actions: ["inspect", "branch", "create-issue"],
			},
			metadata: {
				seed: COVERAGE_SEED_ID,
				template: "default-company",
			},
		});
		const website = await ensureProject({
			name: "QUESTPIE Website",
			slug: "questpie-website-demo",
			path: "/workspaces/questpie-cms/apps/docs",
			gitProvider: "github",
			gitRemote: "git@github.com:questpie/questpie-cms.git",
			defaultBranch: "main",
			providerConfig: {
				connectionMode: "local",
				repositoryScope: "apps/docs",
				defaultLabels: ["docs", "website"],
			},
			metadata: {
				seed: COVERAGE_SEED_ID,
				template: "default-company",
			},
		});
		const customerPortal = await ensureProject({
			name: "Customer Portal Integration",
			slug: "customer-portal-integration-demo",
			path: "/workspaces/customer-portal",
			gitProvider: "generic",
			gitRemote: "ssh://git.example.com/customer-portal.git",
			defaultBranch: "develop",
			providerConfig: {
				connectionMode: "external",
				requiresHumanApproval: true,
			},
			metadata: {
				seed: COVERAGE_SEED_ID,
				template: "customer-workspace",
			},
		});

		log("Creating Autopilot coverage schedules...");
		await ensureSchedule({
			name: "Daily issue inbox sweep",
			description:
				"Creates an issue every weekday morning for triaging new product work.",
			cron: "0 8 * * 1-5",
			timezone: "Europe/Bratislava",
			mode: "task",
			taskTemplate: {
				title: "Daily Autopilot issue inbox sweep",
				type: "review",
				priority: "medium",
				project: autopilot.id,
				scopeType: "project",
			},
			concurrencyPolicy: "skip",
			enabled: true,
			lastRunAt: lastWeek,
			nextRunAt: tomorrow,
			createdBy: `seed:${COVERAGE_SEED_ID}`,
		});
		await ensureSchedule({
			name: "Weekly docs gap report",
			description:
				"Creates a documentation issue with current product/admin gaps.",
			cron: "0 10 * * 1",
			timezone: "Europe/Bratislava",
			mode: "task",
			taskTemplate: {
				title: "Weekly docs gap report",
				type: "task",
				priority: "low",
				project: website.id,
				scopeType: "project",
			},
			concurrencyPolicy: "allow",
			enabled: true,
			lastRunAt: lastWeek,
			nextRunAt: nextWeek,
			createdBy: `seed:${COVERAGE_SEED_ID}`,
		});
		await ensureSchedule({
			name: "Direct release readiness run",
			description:
				"Advanced schedule that runs a chat prompt directly instead of creating an issue.",
			cron: "30 15 * * 5",
			timezone: "UTC",
			mode: "chat",
			chatPrompt:
				"Review release readiness and summarize blocked work for human approval.",
			concurrencyPolicy: "replace",
			enabled: false,
			lastRunAt: lastWeek,
			nextRunAt: nextWeek,
			createdBy: `seed:${COVERAGE_SEED_ID}`,
		});

		log("Creating Autopilot coverage issues...");
		const issues = await Promise.all([
			ensureIssue({
				title: "Replace raw sort selector with view options sorting",
				description:
					"The top toolbar should not expose a raw createdAt field select. Sorting belongs in view options, table headers, or saved views.",
				type: "bug",
				status: "failed",
				priority: "urgent",
				project: autopilot.id,
				scopeType: "project",
				queue: "default",
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "admin-list",
					designSystem: "packages/admin/DESIGN.md",
					visibleLeak: "createdAt",
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "needs-attention-filter",
				},
			}),
			ensureIssue({
				title: "Create prompt-driven issue action",
				description:
					"Add an issue action that accepts a prompt and dispatches AI to create structured issues.",
				type: "feature",
				status: "backlog",
				priority: "high",
				project: autopilot.id,
				scopeType: "project",
				queue: "default",
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "issue-actions",
					mode: "prompt",
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "open-filter",
				},
			}),
			ensureIssue({
				title: "Create manual Linear-like issue action",
				description:
					"Add a compact manual issue creator with title, markdown description, project, and priority.",
				type: "feature",
				status: "pending",
				priority: "medium",
				project: autopilot.id,
				scopeType: "project",
				queue: "default",
				startAfter: tomorrow,
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "issue-actions",
					mode: "manual",
					scheduled: true,
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "scheduled-filter",
				},
			}),
			ensureIssue({
				title: "Audit Knowledge outline nested folders",
				description:
					"Verify Knowledge groups by scope, project, and synthetic path folders without blank rows.",
				type: "review",
				status: "review",
				priority: "medium",
				project: website.id,
				scopeType: "project",
				queue: "default",
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "knowledge",
					view: "outline",
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "nested-outline",
				},
			}),
			ensureIssue({
				title: "Wait for custom markdown field primitive",
				description:
					"Issue description editing needs a reusable markdown editor field before Autopilot adds product-specific detail UI.",
				type: "task",
				status: "waiting",
				priority: "low",
				project: autopilot.id,
				scopeType: "project",
				queue: "default",
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "fields",
					primitive: "markdown-editor",
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "waiting-filter",
				},
			}),
			ensureIssue({
				title: "Ship admin CSS source scanning fix",
				description:
					"Confirmed the app imports generated Tailwind classes from admin package client files.",
				type: "task",
				status: "done",
				priority: "medium",
				project: autopilot.id,
				scopeType: "project",
				queue: "default",
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "admin-shell",
					verified: true,
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "done-filter",
				},
			}),
			ensureIssue({
				title: "Cancel obsolete provider admin page",
				description:
					"Provider internals should remain in advanced/debug surfaces, not normal product navigation.",
				type: "task",
				status: "cancelled",
				priority: "low",
				project: customerPortal.id,
				scopeType: "project",
				queue: "default",
				createdBy: `seed:${COVERAGE_SEED_ID}`,
				context: {
					area: "navigation",
					reason: "internal-runtime-surface",
				},
				metadata: {
					seed: COVERAGE_SEED_ID,
					testCase: "cancelled-status",
				},
			}),
		]);

		log("Creating Autopilot coverage knowledge...");
		const sortIssue = issues[0]!;
		const outlineIssue = issues[3]!;
		const knowledgeEntries = [
			{
				title: "Admin list view control inventory",
				path: "company/design-system/admin/list-view/controls",
				scopeType: "company",
				project: autopilot.id,
				kind: "document",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "system",
				sourceRef: "seed:admin-list-view-controls",
				body: [
					"# Admin list view controls",
					"",
					"The list header currently contains search, view options, sort field, sort direction, and create/header actions.",
					"",
					"The raw sort field select should move behind a proper view-options sorting primitive.",
				].join("\n"),
				contentHash: "seed-admin-list-view-controls",
				metadata: { seed: COVERAGE_SEED_ID },
			},
			{
				title: "Default company template",
				path: "company/templates/default-company",
				scopeType: "company",
				project: autopilot.id,
				kind: "document",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "system",
				sourceRef: "seed:default-company-template",
				body: [
					"# Default company template",
					"",
					"Seed data should cover issues, schedules, knowledge, projects, nested outlines, relation cells, and advanced/internal metadata without surfacing runtime tables as product navigation.",
				].join("\n"),
				contentHash: "seed-default-company-template",
				metadata: { seed: COVERAGE_SEED_ID },
			},
			{
				title: "Autopilot issue actions spec",
				path: "projects/questpie-autopilot/issues/actions/create-issue",
				scopeType: "project",
				project: autopilot.id,
				task: sortIssue.id,
				kind: "document",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "assistant",
				sourceRef: "agent-board:design-autopilot-custom-issue-creation-actions",
				body: [
					"# Issue creation actions",
					"",
					"Autopilot needs two create modes: prompt-driven structured issue creation and a compact manual issue creator.",
				].join("\n"),
				contentHash: "seed-issue-actions-spec",
				metadata: { seed: COVERAGE_SEED_ID },
			},
			{
				title: "Knowledge outline verification",
				path: "projects/questpie-autopilot/knowledge/outline/nested-folders",
				scopeType: "task",
				project: website.id,
				task: outlineIssue.id,
				kind: "summary",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "worker",
				sourceRef: "seed:knowledge-outline",
				body: [
					"# Knowledge outline verification",
					"",
					"This record tests task-scoped knowledge, relation expansion, and synthetic nested folder rows.",
				].join("\n"),
				contentHash: "seed-knowledge-outline-verification",
				metadata: { seed: COVERAGE_SEED_ID },
			},
			{
				title: "Website docs writing rules",
				path: "projects/questpie-website/docs/rules/writing-style",
				scopeType: "project",
				project: website.id,
				kind: "document",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "human",
				sourceRef: "docs-guidelines",
				body: [
					"# Docs writing rules",
					"",
					"Write concise product documentation with direct links to source files and verification commands.",
				].join("\n"),
				contentHash: "seed-website-doc-rules",
				metadata: { seed: COVERAGE_SEED_ID },
			},
			{
				title: "Release checklist",
				path: "company/release/checklist",
				scopeType: "company",
				project: customerPortal.id,
				kind: "document",
				contentType: "text/markdown",
				renderer: "markdown",
				source: "import",
				sourceRef: "seed-release-checklist",
				body: [
					"# Release checklist",
					"",
					"Release checklist fixture for disabled skills and direct chat schedules.",
				].join("\n"),
				contentHash: "seed-release-checklist",
				metadata: { seed: COVERAGE_SEED_ID },
			},
		];

		for (const entry of knowledgeEntries) {
			await ensureKnowledge(entry);
		}

		log("Autopilot demo coverage data created");
	},
});
