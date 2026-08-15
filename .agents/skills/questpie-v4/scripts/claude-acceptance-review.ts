import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

import {
	findAcceptanceGitDiffSecret,
	findAcceptancePacketSecret,
} from "./acceptance-packet-secrets";

type Manifest = {
	ticket: string;
	reviewedHead?: string;
	proof: string;
	authorityHeads: Record<string, string>;
	verification: Array<{ command: string; result: "PASS" }>;
	acceptanceCriteria: string[];
};

type Options = {
	manifest?: string;
	authority: string[];
	diffBase?: string;
	output?: string;
	timeoutMs: number;
	dryRun: boolean;
};

function fail(message: string): never {
	console.error(`acceptance review: ${message}`);
	process.exit(1);
}

function parseArgs(argv: string[]): Options {
	const options: Options = { authority: [], timeoutMs: 300_000, dryRun: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const value = argv[index + 1];
		if (arg === "--authority" && value) {
			options.authority.push(value);
			index += 1;
		} else if (arg === "--manifest" && value) {
			options.manifest = value;
			index += 1;
		} else if (arg === "--diff-base" && value) {
			options.diffBase = value;
			index += 1;
		} else if (arg === "--output" && value) {
			options.output = value;
			index += 1;
		} else if (arg === "--timeout-ms" && value) {
			options.timeoutMs = Number.parseInt(value, 10);
			index += 1;
		} else if (arg === "--dry-run") {
			options.dryRun = true;
		} else {
			fail(`unknown or incomplete argument: ${arg}`);
		}
	}
	if (
		!options.manifest ||
		!options.diffBase ||
		!options.output ||
		options.authority.length === 0
	) {
		fail(
			"require --manifest, one or more --authority, --diff-base, and --output",
		);
	}
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000) {
		fail("--timeout-ms must be an integer of at least 1000");
	}
	return options;
}

function checkedFile(path: string, label: string): string {
	const absolute = resolve(path);
	if (!existsSync(absolute) || !lstatSync(absolute).isFile())
		fail(`${label} is not a file: ${path}`);
	return absolute;
}

function shell(args: string[]): string {
	const process = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
	if (process.exitCode !== 0) {
		fail(`${args.join(" ")} failed: ${process.stderr.toString().trim()}`);
	}
	return process.stdout.toString().trim();
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function rejectSecrets(packet: string): void {
	const secret = findAcceptancePacketSecret(packet);
	if (secret) fail(`packet contains a prohibited ${secret.name}`);
}

function rejectDiffSecrets(diff: string): void {
	const secret = findAcceptanceGitDiffSecret(diff);
	if (secret) fail(`packet diff contains a prohibited ${secret.name}`);
}

const options = parseArgs(Bun.argv.slice(2));
const manifestPath = checkedFile(options.manifest!, "manifest");
const authorityPaths = options.authority.map((path) =>
	checkedFile(path, "authority"),
);
const outputPath = resolve(options.output!);

let manifest: Manifest;
try {
	manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
} catch (error) {
	fail(`invalid manifest JSON: ${String(error)}`);
}

if (!manifest.ticket || !manifest.proof) fail("manifest lacks ticket or proof");
if (!Array.isArray(manifest.verification) || manifest.verification.length === 0)
	fail("manifest has no verification results");
if (
	manifest.verification.some(
		(entry) => !entry.command || entry.result !== "PASS",
	)
)
	fail("every verification entry must be PASS");
if (
	!Array.isArray(manifest.acceptanceCriteria) ||
	manifest.acceptanceCriteria.length === 0
)
	fail("manifest has no acceptance criteria");

const head = shell(["git", "rev-parse", "HEAD"]);
const status = shell([
	"git",
	"status",
	"--porcelain=v1",
	"--untracked-files=all",
]);
if (status !== "") fail("review worktree is not clean");
if (manifest.reviewedHead && head !== manifest.reviewedHead)
	fail(
		`manifest reviewedHead ${manifest.reviewedHead} does not equal HEAD ${head}`,
	);
shell(["git", "merge-base", "--is-ancestor", options.diffBase!, head]);
for (const [name, authorityHead] of Object.entries(manifest.authorityHeads)) {
	if (!/^[0-9a-f]{40}$/.test(authorityHead))
		fail(`authority head ${name} is not a full commit ID`);
	shell(["git", "cat-file", "-e", `${authorityHead}^{commit}`]);
}

const documents = authorityPaths
	.map((path, index) => {
		const source = relative(process.cwd(), path) || path;
		const content = readFileSync(path, "utf8");
		rejectSecrets(content);
		return `<document index="${index + 1}"><source>${xml(source)}</source><document_content>${xml(content)}</document_content></document>`;
	})
	.join("\n");
const manifestSource = relative(process.cwd(), manifestPath) || manifestPath;
rejectSecrets(JSON.stringify(manifest));
const diff = shell([
	"git",
	"diff",
	"--binary",
	"--no-ext-diff",
	`${options.diffBase}..${head}`,
	"--",
	".",
]);
if (diff === "") fail("review diff is empty");
rejectDiffSecrets(diff);

const packet = `<documents>\n${documents}\n<document index="${authorityPaths.length + 1}"><source>${xml(manifestSource)}</source><document_content>${xml(JSON.stringify(manifest, null, 2))}</document_content></document>\n<document index="${authorityPaths.length + 2}"><source>exact git diff ${xml(options.diffBase!)}..${xml(head)}</source><document_content>${xml(diff)}</document_content></document>\n</documents>\n<review_metadata><reviewed_head>${xml(head)}</reviewed_head><diff_base>${xml(options.diffBase!)}</diff_base><model>opus</model><effort>medium</effort></review_metadata>\n<review_task>\nYou are the independent acceptance reviewer for QUESTPIE v4 atlas ticket ${xml(manifest.ticket)}. Review only the exact clean head and diff supplied above against the fixed authority, proof manifest, verification results, and acceptance criteria. Look for contradictions, missing evidence, invalid ownership, non-portable agent dependencies, unsafe review behavior, false quality or performance gates, and scope creep into production Runtime implementation.\n\nReturn exactly one verdict line first: VERDICT: PASS or VERDICT: BLOCKED. A PASS means no blocking finding remains. For BLOCKED, list each concrete blocker with the affected file and required evidence or repair. Then list non-blocking observations. Keep findings grounded in the supplied packet.\n</review_task>\n`;
if (options.dryRun) {
	console.log(
		JSON.stringify({
			ticket: manifest.ticket,
			head,
			documents: authorityPaths.length + 2,
			packetBytes: Buffer.byteLength(packet),
			diffBytes: Buffer.byteLength(diff),
		}),
	);
	process.exit(0);
}

const child = Bun.spawn(
	[
		"claude",
		"--print",
		"--model",
		"opus",
		"--effort",
		"medium",
		"--no-session-persistence",
		"--permission-mode",
		"dontAsk",
		"--tools",
		"",
	],
	{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
);
child.stdin.write(packet);
child.stdin.end();

const timed = await Promise.race([
	child.exited.then((exitCode) => ({ exitCode, timeout: false })),
	Bun.sleep(options.timeoutMs).then(() => ({ exitCode: -1, timeout: true })),
]);
if (timed.timeout) {
	child.kill();
	fail(
		`Claude timed out after ${options.timeoutMs}ms; no review result recorded`,
	);
}
const raw = (await new Response(child.stdout).text()).trim();
const stderr = (await new Response(child.stderr).text()).trim();
if (timed.exitCode !== 0)
	fail(`Claude transport failed with exit ${timed.exitCode}: ${stderr}`);
if (raw === "") fail("Claude returned an empty response");
const verdicts = [...raw.matchAll(/^VERDICT:\s*(PASS|BLOCKED)\s*$/gm)].map(
	(match) => match[1],
);
if (verdicts.length !== 1 || !raw.startsWith("VERDICT:"))
	fail(
		"Claude response must start with exactly one explicit PASS/BLOCKED verdict line",
	);

const record = {
	protocolVersion: 1,
	ticket: manifest.ticket,
	model: "opus",
	effort: "medium",
	reviewedHead: head,
	diffBase: options.diffBase,
	verdict: verdicts[0],
	findings: raw,
	recordedAt: new Date().toISOString(),
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(
	`acceptance review ${record.verdict}: ${relative(process.cwd(), outputPath) || outputPath}`,
);
if (record.verdict === "BLOCKED") process.exit(2);
