import { loadQueue } from "./check";

export function renderIssue(
	id: string,
	numbers: Record<string, number> = {},
): string {
	const queue = loadQueue();
	const issue = queue.issues.find((candidate) => candidate.id === id);
	if (!issue) throw new Error(`unknown queue issue ${id}`);
	const bullets = (values: string[]) =>
		values.map((value) => `- ${value}`).join("\n");
	const commands = issue.verify.map((command) => `\`${command}\``).join("\n");
	const blockers =
		issue.blockedBy.length === 0
			? "None — can start immediately."
			: issue.blockedBy
					.map((blocker) =>
						numbers[blocker] ? `- #${numbers[blocker]}` : `- ${blocker}`,
					)
					.join("\n");
	return `## Parent\n\n#${queue.parent}\n\n## Exact authority\n\n${bullets(issue.authority)}\n\nFixed proof heads are recorded in \`docs/v4/prototypes/implementation-collapse-p16/QUEUE.json\`.\n\n## What to build\n\n${issue.fixture}\n\nStart with this red test: ${issue.redTest}\n\n## Required artifacts\n\n${bullets(issue.artifacts)}\n\n## Acceptance criteria\n\n${issue.artifacts.map((artifact) => `- [ ] ${artifact} exists and matches the accepted contract.`).join("\n")}\n- [ ] The named hostile cases pass without weakening nondisclosure, authority, transaction, retry, cancellation, or durable ownership.\n- [ ] The slice remains independently demoable through its stated fixture.\n\n## Hostile cases\n\n${bullets(issue.hostile)}\n\n## Budgets\n\n${bullets(issue.budgets)}\n\n## Non-goals\n\n${bullets(issue.nonGoals)}\n\n## Blocked by\n\n${blockers}\n\n## Verification\n\n${commands}\n`;
}

if (import.meta.main) {
	const id = Bun.argv[2];
	if (!id) throw new Error("usage: render-issue.ts BETA-01 [numbers.json]");
	const numbers = Bun.argv[3]
		? (JSON.parse(await Bun.file(Bun.argv[3]).text()) as Record<string, number>)
		: {};
	process.stdout.write(renderIssue(id, numbers));
}
