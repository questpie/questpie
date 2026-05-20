import { seed } from "questpie/services";

const SEED_ID = "autopilotDemoStressData";

async function findFirst(
	collection: {
		find: (
			args: { where: Record<string, unknown>; limit: number },
			ctx: unknown,
		) => Promise<{ docs: Array<Record<string, unknown>> }>;
	},
	where: Record<string, unknown>,
	ctx: unknown,
) {
	const result = await collection.find({ where, limit: 1 }, ctx);
	return result.docs[0] ?? null;
}

export default seed({
	id: SEED_ID,
	description:
		"Stress test data for grouped list view: 40+ issues across statuses, priorities, projects",
	category: "dev",
	dependsOn: ["autopilotDemoCoverageData"],
	async run({ collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });

		const existing = await collections.tasks.find(
			{ where: { title: "Implement grouped list view data fetching" }, limit: 1 },
			ctx,
		);
		if (existing.totalDocs > 0) {
			log("Stress test data already exists, skipping");
			return;
		}

		const autopilot = await findFirst(
			collections.projects,
			{ slug: "questpie-autopilot-demo" },
			ctx,
		);
		const website = await findFirst(
			collections.projects,
			{ slug: "questpie-website-demo" },
			ctx,
		);
		const portal = await findFirst(
			collections.projects,
			{ slug: "customer-portal-integration-demo" },
			ctx,
		);
		if (!autopilot || !website || !portal) {
			log("Missing projects, run demo-coverage-data first");
			return;
		}

		const workflow = await findFirst(
			collections.workflow_configs,
			{ name: "Research, implement, verify" },
			ctx,
		);
		const docsWorkflow = await findFirst(
			collections.workflow_configs,
			{ name: "Research and document gaps" },
			ctx,
		);
		const capability = await findFirst(
			collections.capabilities,
			{ name: "Product Engineering Agent" },
			ctx,
		);

		const base = {
			scopeType: "project" as const,
			queue: "default",
			createdBy: `seed:${SEED_ID}`,
			metadata: { seed: SEED_ID },
		};

		const issues = [
			// ── In Progress (8) ──
			{
				title: "Implement grouped list view data fetching",
				type: "feature",
				status: "in_progress",
				priority: "urgent",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
				capability: capability?.id,
			},
			{
				title: "Build collection field introspection API",
				type: "feature",
				status: "in_progress",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Migrate sidebar navigation to product groups",
				type: "task",
				status: "in_progress",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
				capability: capability?.id,
			},
			{
				title: "Add per-group load more pagination",
				type: "feature",
				status: "in_progress",
				priority: "medium",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Fix relation cell display for nested docs",
				type: "bug",
				status: "in_progress",
				priority: "urgent",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
				capability: capability?.id,
			},
			{
				title: "Update landing page hero section",
				type: "task",
				status: "in_progress",
				priority: "medium",
				project: website!.id,
				workflowConfig: docsWorkflow?.id,
			},
			{
				title: "Implement dark mode token audit",
				type: "task",
				status: "in_progress",
				priority: "low",
				project: autopilot!.id,
			},
			{
				title: "Portal SSO integration flow",
				type: "feature",
				status: "in_progress",
				priority: "high",
				project: portal!.id,
			},

			// ── In Review (5) ──
			{
				title: "Review outline expand/collapse animations",
				type: "review",
				status: "in_review",
				priority: "medium",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Review quick filter bar redesign",
				type: "review",
				status: "in_review",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
				capability: capability?.id,
			},
			{
				title: "Review docs site accessibility report",
				type: "review",
				status: "in_review",
				priority: "medium",
				project: website!.id,
				workflowConfig: docsWorkflow?.id,
			},
			{
				title: "Validate bulk action toolbar regressions",
				type: "review",
				status: "in_review",
				priority: "high",
				project: autopilot!.id,
			},
			{
				title: "Review portal onboarding wizard copy",
				type: "review",
				status: "in_review",
				priority: "low",
				project: portal!.id,
			},

			// ── Todo (10) ──
			{
				title: "Add keyboard shortcuts for list navigation",
				type: "feature",
				status: "todo",
				priority: "medium",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Implement saved views persistence",
				type: "feature",
				status: "todo",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
				capability: capability?.id,
			},
			{
				title: "Build status transition validation",
				type: "feature",
				status: "todo",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Create knowledge import from GitHub",
				type: "feature",
				status: "todo",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Add real-time collaboration indicators",
				type: "feature",
				status: "todo",
				priority: "low",
				project: autopilot!.id,
			},
			{
				title: "Redesign project settings page",
				type: "task",
				status: "todo",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Write API reference for collections SDK",
				type: "task",
				status: "todo",
				priority: "high",
				project: website!.id,
				workflowConfig: docsWorkflow?.id,
			},
			{
				title: "Add changelog generation from commits",
				type: "feature",
				status: "todo",
				priority: "low",
				project: website!.id,
			},
			{
				title: "Portal webhook delivery retry logic",
				type: "feature",
				status: "todo",
				priority: "urgent",
				project: portal!.id,
			},
			{
				title: "Implement multi-tenant data isolation",
				type: "feature",
				status: "todo",
				priority: "urgent",
				project: portal!.id,
			},

			// ── Backlog (8) ──
			{
				title: "Explore drag-and-drop issue reordering",
				type: "research",
				status: "backlog",
				priority: "low",
				project: autopilot!.id,
			},
			{
				title: "Research AI-powered issue deduplication",
				type: "research",
				status: "backlog",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Add custom field types for projects",
				type: "feature",
				status: "backlog",
				priority: "low",
				project: autopilot!.id,
			},
			{
				title: "Build notification preferences UI",
				type: "feature",
				status: "backlog",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Create issue templates system",
				type: "feature",
				status: "backlog",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Add Slack integration for issue updates",
				type: "feature",
				status: "backlog",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Docs search with Algolia integration",
				type: "feature",
				status: "backlog",
				priority: "low",
				project: website!.id,
			},
			{
				title: "Portal audit log viewer",
				type: "feature",
				status: "backlog",
				priority: "high",
				project: portal!.id,
			},

			// ── Done (6) ──
			{
				title: "Implement collection list view skeleton",
				type: "task",
				status: "done",
				priority: "high",
				project: autopilot!.id,
				workflowConfig: workflow?.id,
			},
			{
				title: "Add admin sidebar navigation",
				type: "task",
				status: "done",
				priority: "urgent",
				project: autopilot!.id,
			},
			{
				title: "Set up Tailwind CSS for admin package",
				type: "task",
				status: "done",
				priority: "high",
				project: autopilot!.id,
			},
			{
				title: "Create initial docs site with Astro",
				type: "task",
				status: "done",
				priority: "medium",
				project: website!.id,
			},
			{
				title: "Configure CI pipeline for monorepo",
				type: "task",
				status: "done",
				priority: "urgent",
				project: autopilot!.id,
			},
			{
				title: "Portal initial database schema",
				type: "task",
				status: "done",
				priority: "high",
				project: portal!.id,
			},

			// ── Cancelled (3) ──
			{
				title: "Build custom Gantt chart widget",
				type: "feature",
				status: "cancelled",
				priority: "low",
				project: autopilot!.id,
			},
			{
				title: "Add JIRA import tool",
				type: "feature",
				status: "cancelled",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Portal legacy API compatibility layer",
				type: "task",
				status: "cancelled",
				priority: "low",
				project: portal!.id,
			},

			// ── Duplicate (2) ──
			{
				title: "Fix CSS loading in admin (duplicate of ship admin CSS fix)",
				type: "bug",
				status: "duplicate",
				priority: "medium",
				project: autopilot!.id,
			},
			{
				title: "Portal SSO setup (duplicate of SSO integration)",
				type: "task",
				status: "duplicate",
				priority: "low",
				project: portal!.id,
			},
		];

		log(`Creating ${issues.length} stress test issues...`);
		const created: Record<string, unknown>[] = [];
		for (const issue of issues) {
			const doc = await collections.tasks.create(
				{ ...base, ...issue },
				ctx,
			);
			created.push(doc);
		}

		log("Creating parent-child relations for stress data...");
		const parentChildPairs: [string, string][] = [
			[
				"Implement grouped list view data fetching",
				"Add per-group load more pagination",
			],
			[
				"Build collection field introspection API",
				"Fix relation cell display for nested docs",
			],
			[
				"Implement saved views persistence",
				"Add keyboard shortcuts for list navigation",
			],
			[
				"Create knowledge import from GitHub",
				"Build status transition validation",
			],
			[
				"Create issue templates system",
				"Research AI-powered issue deduplication",
			],
			[
				"Implement multi-tenant data isolation",
				"Portal webhook delivery retry logic",
			],
		];

		for (const [parentTitle, childTitle] of parentChildPairs) {
			const parent = created.find((d: any) => d.title === parentTitle);
			const child = created.find((d: any) => d.title === childTitle);
			if (!parent || !child) continue;
			await collections.task_relations.create(
				{
					sourceTask: parent.id,
					targetTask: child.id,
					relationType: "parent_of",
					dedupeKey: `${parent.id}:parent_of:${child.id}`,
					createdBy: `seed:${SEED_ID}`,
					metadata: { seed: SEED_ID },
				},
				ctx,
			);
		}

		log(`Stress test data created: ${created.length} issues, ${parentChildPairs.length} relations`);
	},
});
