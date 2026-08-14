import { readFileSync } from "node:fs";

export type Issue = {
	id: string;
	title: string;
	blockedBy: string[];
	agentReady: boolean;
	authority: string[];
	artifacts: string[];
	fixture: string;
	redTest: string;
	hostile: string[];
	nonGoals: string[];
	budgets: string[];
	performance: { owner: string; evidence: string[] };
	verify: string[];
};

export type Queue = {
	release: string;
	parent: number;
	authorityHeads: Record<string, string>;
	issues: Issue[];
};

const REQUIRED_HEADS = [
	"foundation",
	"P1",
	"P2",
	"P3",
	"P4",
	"P5",
	"P6",
	"postP6",
	"P17",
	"P18",
	"P19",
	"P20",
	"P21",
	"P22",
	"P14",
	"P15",
];

export function validate(queue: Queue): void {
	if (queue.release !== "4.0.0-beta.1" || queue.parent !== 261)
		throw new Error("release or parent mismatch");
	for (const key of REQUIRED_HEADS)
		if (!/^[0-9a-f]{40}$/.test(queue.authorityHeads[key] ?? ""))
			throw new Error(`missing exact authority head ${key}`);
	if (queue.issues.length !== 12)
		throw new Error("expected twelve beta tracers");
	const ids = queue.issues.map(({ id }) => id);
	if (new Set(ids).size !== ids.length) throw new Error("duplicate issue id");
	for (const [index, issue] of queue.issues.entries()) {
		if (issue.id !== `BETA-${String(index + 1).padStart(2, "0")}`)
			throw new Error(`non-canonical issue order ${issue.id}`);
		for (const field of [
			"authority",
			"artifacts",
			"hostile",
			"nonGoals",
			"budgets",
			"verify",
		] as const)
			if (issue[field].length === 0)
				throw new Error(`${issue.id} has empty ${field}`);
		if (!issue.title.startsWith(issue.id) || !issue.fixture || !issue.redTest)
			throw new Error(`${issue.id} has incomplete issue contract`);
		for (const dependency of issue.blockedBy) {
			if (!ids.includes(dependency) || ids.indexOf(dependency) >= index)
				throw new Error(`${issue.id} has invalid dependency ${dependency}`);
		}
		if (issue.agentReady !== (issue.blockedBy.length === 0))
			throw new Error(`${issue.id} readiness does not match blockers`);
		if (!issue.verify.includes("git diff --check"))
			throw new Error(`${issue.id} lacks diff hygiene`);
		if (!issue.verify.some((command) => command.includes("quality:full")))
			throw new Error(`${issue.id} lacks full verification`);
		if (!issue.budgets.some((budget) => /budget|baseline|<=/.test(budget)))
			throw new Error(`${issue.id} lacks owned performance budget`);
		if (
			issue.performance.owner !== issue.id ||
			issue.performance.evidence.length === 0 ||
			!issue.performance.evidence.every((item) =>
				/manifest|measurement|baseline|budget|report/.test(item),
			)
		)
			throw new Error(`${issue.id} lacks slice-owned performance evidence`);
		if (
			["BETA-04", "BETA-06", "BETA-07", "BETA-08"].includes(issue.id) &&
			!issue.verify.some((command) => command.includes("bench:micro"))
		)
			throw new Error(`${issue.id} lacks its hot-path microbenchmark command`);
		for (const authority of issue.authority)
			if (!/^(ADR-\d{4}|P14 conformance map)$/.test(authority))
				throw new Error(`${issue.id} has invalid authority ${authority}`);
	}
	const ownedScope = queue.issues
		.map(({ artifacts, fixture, redTest }) =>
			[artifacts.join(" "), fixture, redTest].join(" "),
		)
		.join(" ");
	for (const forbidden of [
		"Action authoring",
		"raw Route implementation",
		"credential Auth implementation",
		"generic Job client",
		"Workflow implementation",
		"Channel implementation",
		"File byte API",
		"Search implementation",
		"OpenAPI projection",
		"MCP projection",
		"skill bundle",
		"Redis implementation",
		"Pusher implementation",
		"split Runtime roles implementation",
		"remote Studio implementation",
		"non-B-tree public Index",
		"RLS implementation",
	])
		if (ownedScope.includes(forbidden))
			throw new Error(`forbidden beta-owned scope: ${forbidden}`);
	const encoded = JSON.stringify(queue);
	for (const required of [
		"Company/Space/Channel/Membership/Message",
		"Institution/Record/ResearchPermit/Embargo/Provenance",
		"B-tree Indexes",
		"no RLS claim",
		"ten-instance load scenario",
		"optional-infrastructure absence report",
		"#questpie/package",
	])
		if (!encoded.includes(required))
			throw new Error(`missing coverage: ${required}`);
}

export function loadQueue(): Queue {
	return JSON.parse(
		readFileSync(new URL("./QUEUE.json", import.meta.url), "utf8"),
	) as Queue;
}

if (import.meta.main) {
	const queue = loadQueue();
	validate(queue);
	console.log(
		`P16 implementation queue: ${queue.issues.length} dependency-ordered tracers; ${queue.issues.filter(({ agentReady }) => agentReady).length} agent-ready`,
	);
}
