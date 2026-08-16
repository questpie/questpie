import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
	type Queue,
	validate as validateQueue,
} from "../implementation-collapse-p16/check";
import { renderIssue } from "../implementation-collapse-p16/render-issue";

type Revision = {
	format: string;
	version: number;
	identity: string;
	projectionBase: string;
	authorityHeads: Record<string, string>;
	sourceIssue: Record<string, string | number>;
	ownership: Record<string, string>;
	issueProjection: string;
	projectionPaths: string[];
	nonGoals: string[];
};

const root = resolve(import.meta.dir, "../../../..");
const exact = {
	projectionBase: "6006800b694bd2751e4f431b4be727245f5398c1",
	projectionHead: "a49eb3c6914f35fa1d7e3757909e6a2b330a7cec",
	authorityHeads: {
		P3: "a09bf55f0e22f65e059cda9f3eda914520dd4f9d",
		P4: "05fc96f3d07c70beaf7f654d79d6cfb46f427f92",
		P5: "3f8618613bde1bdd7e13863970eb1c140e201c6f",
		P16: "1d9303a58c9557aac3da648895c817fa039478ba",
		BETA05Merge: "740f2e0049a64f5a541f33ab8da44cf8e114041b",
	},
	projectionPaths: [
		"docs/v4/prototypes/implementation-collapse-p16/ACCEPTANCE.json",
		"docs/v4/prototypes/implementation-collapse-p16/QUEUE.json",
		"docs/v4/prototypes/implementation-collapse-p16/README.md",
		"docs/v4/prototypes/implementation-collapse-p16/check.ts",
		"docs/v4/prototypes/implementation-collapse-p16/negative-control.ts",
	],
} as const;

function equal(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function validateRevision(revision: Revision): void {
	if (
		revision.format !== "questpie.beta06-authority-reconciliation" ||
		revision.version !== 1 ||
		revision.identity !== "P16R1/BETA06LedgerBoundary"
	)
		throw new Error("invalid reconciliation identity");
	if (revision.projectionBase !== exact.projectionBase)
		throw new Error("projection base changed");
	if (!equal(revision.authorityHeads, exact.authorityHeads))
		throw new Error("authority heads changed");
	if (
		revision.sourceIssue.number !== 293 ||
		revision.sourceIssue.stateObserved !== "OPEN" ||
		revision.sourceIssue.blockedByIssue !== 292 ||
		revision.sourceIssue.blockedByStateObserved !== "CLOSED" ||
		revision.sourceIssue.bodySha256Observed !==
			"37cc4d2b033b1d67e4f1f4341376501669491c4ac7866b5698fc2e8b9dd3eeda"
	)
		throw new Error("source issue observation changed");
	if (
		revision.ownership.beta06Required !== "pending Reaction intent" ||
		revision.ownership.beta06Forbidden !== "committed change fact" ||
		revision.ownership.beta07Required !== "Change Ledger DDL/triggers" ||
		revision.ownership.captureOwner !== "compiler-owned PostgreSQL triggers"
	)
		throw new Error("ledger ownership changed");
	if (
		revision.issueProjection !== "ISSUE-293.expected.md" ||
		!equal(revision.projectionPaths, exact.projectionPaths)
	)
		throw new Error("projection scope changed");
	for (const nonGoal of [
		"production Runtime implementation",
		"Change Ledger schema or trigger design",
		"Reaction execution",
		"BETA-07 readiness",
		"closing issue #293",
	])
		if (!revision.nonGoals.includes(nonGoal))
			throw new Error(`missing non-goal ${nonGoal}`);
}

function command(args: string[]): string {
	const result = Bun.spawnSync(args, {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(
			`${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
		);
	return result.stdout.toString().trim();
}

function validateBoundary(queue: Queue): void {
	validateQueue(queue);
	if (queue.acceptedIssues["BETA-05"] !== exact.authorityHeads.BETA05Merge)
		throw new Error("BETA-05 accepted merge changed");
	const ready = queue.issues.filter(({ agentReady }) => agentReady);
	if (ready.length !== 1 || ready[0]?.id !== "BETA-06")
		throw new Error("BETA-06 is not the sole ready issue");
	const rendered = renderIssue("BETA-06", { "BETA-05": 292 });
	const expected = readFileSync(
		resolve(import.meta.dir, "ISSUE-293.expected.md"),
		"utf8",
	);
	if (rendered !== expected) throw new Error("issue #293 projection drifted");
}

export function loadRevision(): Revision {
	return JSON.parse(
		readFileSync(resolve(import.meta.dir, "REVISION.json"), "utf8"),
	) as Revision;
}

if (import.meta.main) {
	const revision = loadRevision();
	validateRevision(revision);
	for (const head of [
		...Object.values(exact.authorityHeads),
		exact.projectionHead,
	])
		command(["git", "cat-file", "-e", `${head}^{commit}`]);
	for (const head of [
		exact.authorityHeads.P16,
		exact.authorityHeads.BETA05Merge,
		exact.projectionHead,
	])
		command(["git", "merge-base", "--is-ancestor", head, "HEAD"]);
	command(["git", "merge-base", "--is-ancestor", exact.projectionBase, "HEAD"]);
	validateBoundary(
		JSON.parse(
			command([
				"git",
				"show",
				`${exact.projectionHead}:docs/v4/prototypes/implementation-collapse-p16/QUEUE.json`,
			]),
		) as Queue,
	);
	console.log(
		"BETA-06 authority reconciliation: ledger boundary and readiness PASS",
	);
}
