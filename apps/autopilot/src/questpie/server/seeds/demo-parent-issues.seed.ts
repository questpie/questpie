import { seed } from "questpie/services";

const PARENT_SEED_ID = "autopilotDemoParentIssues";

async function findIssue(collections: any, title: string, ctx: unknown) {
	const result = await collections.tasks.find(
		{ where: { title }, limit: 1 },
		ctx,
	);
	return result.docs[0] ?? null;
}

async function ensureParentRelation(
	collections: any,
	parent: Record<string, unknown>,
	child: Record<string, unknown>,
	ctx: unknown,
) {
	const existing = await collections.task_relations.find(
		{
			where: {
				sourceTask: parent.id,
				targetTask: child.id,
				relationType: "parent_of",
			},
			limit: 1,
		},
		ctx,
	);
	if (existing.docs.length > 0) return;

	await collections.task_relations.create(
		{
			sourceTask: parent.id,
			targetTask: child.id,
			relationType: "parent_of",
			dedupeKey: `${parent.id}:parent_of:${child.id}`,
			createdBy: `seed:${PARENT_SEED_ID}`,
			metadata: {
				seed: PARENT_SEED_ID,
			},
		},
		ctx,
	);
}

export default seed({
	id: PARENT_SEED_ID,
	description:
		"Demo Autopilot parent issue relations for nested Issues list testing",
	category: "dev",
	dependsOn: ["autopilotDemoCoverageData"],
	async run({ collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });
		const relationPairs = [
			["Design issue creation actions", "Create prompt-driven issue action"],
			[
				"Design issue creation actions",
				"Create manual Linear-like issue action",
			],
			[
				"Replace raw sort selector with view options sorting",
				"Fix default sort for system fields",
			],
			[
				"Audit Knowledge outline nested folders",
				"Wait for custom markdown field primitive",
			],
		] as const;

		log("Creating Autopilot parent issue relations...");
		for (const [parentTitle, childTitle] of relationPairs) {
			const parent = await findIssue(collections, parentTitle, ctx);
			const child = await findIssue(collections, childTitle, ctx);
			if (!parent || !child) {
				log(
					`Skipping missing relation fixture: ${parentTitle} -> ${childTitle}`,
				);
				continue;
			}
			await ensureParentRelation(collections, parent, child, ctx);
		}
		log("Autopilot parent issue relations created");
	},
});
