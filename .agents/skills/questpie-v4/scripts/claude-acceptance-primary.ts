import { findAcceptancePacketSecret } from "./acceptance-packet-secrets";
import {
	runBoundedReviewProcess,
	type BoundedReviewProcessResult,
} from "./bounded-review-process";

/**
 * A recorded primary diagnostic is provenance, not reviewer output. Bounding it
 * keeps `NO_RESULT` auditable without turning the record into a transcript.
 */
export const PRIMARY_DIAGNOSTIC_LIMIT = 200;

/**
 * A primary verdict is final. `NO_RESULT` is terminal and fails closed: this
 * protocol has exactly one reviewer and never falls back to another.
 */
export type PrimaryAcceptanceReviewV2 =
	| {
			disposition: "PASS" | "BLOCKED";
			findings: string;
	  }
	| {
			disposition: "NO_RESULT";
			category: "timeout" | "transport" | "empty" | "invalid";
			diagnostic?: string;
	  };

export const ACCEPTANCE_PRIMARY_PROFILE_V2 = Object.freeze({
	protocolVersion: 2 as const,
	transport: "claude-cli" as const,
	executable: "claude" as const,
	model: "opus" as const,
	effort: "medium" as const,
	options: Object.freeze([
		"--print",
		"--model",
		"--effort",
		"--no-session-persistence",
		"--permission-mode",
		"--tools",
	] as const),
});

export type PrimaryReviewerProbe = (args: readonly string[]) => {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/**
 * A missing primary executable, or one that does not accept every pinned
 * option, is not a provider outage. It is an invocation that could never have
 * produced a verdict, so it must fail closed instead of activating the closed
 * contingency round.
 */
export class PrimaryReviewerUnavailable extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PrimaryReviewerUnavailable";
	}
}

export function primaryReviewerCommand(): string[] {
	return [
		ACCEPTANCE_PRIMARY_PROFILE_V2.executable,
		"--print",
		"--model",
		ACCEPTANCE_PRIMARY_PROFILE_V2.model,
		"--effort",
		ACCEPTANCE_PRIMARY_PROFILE_V2.effort,
		"--no-session-persistence",
		"--permission-mode",
		"dontAsk",
		"--tools",
		"",
	];
}

function declaresOption(help: string, option: string): boolean {
	const escaped = option.replaceAll("-", "\\-");
	return new RegExp(`^\\s+(?:-[A-Za-z], )?${escaped}(?:$|[\\s,=])`, "m").test(
		help,
	);
}

/**
 * Fail closed before the packet is ever sent. `codex-acceptance-reviewer.ts`
 * already proves its transport this way; without the same proof on the primary
 * path any argument spelling error silently degrades into contingency.
 */
export function verifyPrimaryReviewer(probe: PrimaryReviewerProbe): void {
	const version = probe(["--version"]);
	if (version.exitCode !== 0)
		throw new PrimaryReviewerUnavailable(
			"pinned primary reviewer is not installed or failed --version",
		);
	if (version.stdout.trim() === "")
		throw new PrimaryReviewerUnavailable(
			"pinned primary reviewer reported no version",
		);
	const help = probe(["--help"]);
	if (help.exitCode !== 0)
		throw new PrimaryReviewerUnavailable(
			"pinned primary reviewer did not report its accepted options",
		);
	for (const option of ACCEPTANCE_PRIMARY_PROFILE_V2.options) {
		if (!declaresOption(help.stdout, option))
			throw new PrimaryReviewerUnavailable(
				`pinned primary reviewer does not accept ${option}`,
			);
	}
}

export function spawnPrimaryReviewerProbe(
	args: readonly string[],
): ReturnType<PrimaryReviewerProbe> {
	let completed: ReturnType<typeof Bun.spawnSync>;
	try {
		completed = Bun.spawnSync(
			[ACCEPTANCE_PRIMARY_PROFILE_V2.executable, ...args],
			{ stdout: "pipe", stderr: "pipe" },
		);
	} catch {
		return { exitCode: -1, stdout: "", stderr: "" };
	}
	return {
		exitCode: completed.exitCode,
		stdout: completed.stdout?.toString() ?? "",
		stderr: completed.stderr?.toString() ?? "",
	};
}

/**
 * `NO_RESULT` provenance has to be auditable without ever carrying reviewer
 * output or credentials into the committed record.
 */
export function sanitizePrimaryDiagnostic(stderr: string): string | undefined {
	const collapsed = stderr.replaceAll(/\s+/g, " ").trim();
	if (collapsed === "") return undefined;
	if (findAcceptancePacketSecret(collapsed)) return "[redacted]";
	return collapsed.length > PRIMARY_DIAGNOSTIC_LIMIT
		? collapsed.slice(0, PRIMARY_DIAGNOSTIC_LIMIT)
		: collapsed;
}

export function classifyPrimaryReviewResult(
	completed: BoundedReviewProcessResult,
): PrimaryAcceptanceReviewV2 {
	const diagnostic = sanitizePrimaryDiagnostic(completed.stderr);
	if (completed.timedOut)
		return {
			disposition: "NO_RESULT",
			category: "timeout",
			...(diagnostic ? { diagnostic } : {}),
		};
	const raw = completed.stdout.trim();
	if (completed.exitCode !== 0)
		return {
			disposition: "NO_RESULT",
			category: "transport",
			...(diagnostic ? { diagnostic } : {}),
		};
	if (raw === "")
		return {
			disposition: "NO_RESULT",
			category: "empty",
			...(diagnostic ? { diagnostic } : {}),
		};
	const verdicts = [...raw.matchAll(/^VERDICT:\s*(PASS|BLOCKED)\s*$/gm)].map(
		(match) => match[1],
	);
	if (verdicts.length !== 1 || !raw.startsWith("VERDICT:"))
		return {
			disposition: "NO_RESULT",
			category: "invalid",
			...(diagnostic ? { diagnostic } : {}),
		};
	return { disposition: verdicts[0] as "PASS" | "BLOCKED", findings: raw };
}

export async function runPrimaryAcceptanceReview(input: {
	packet: string;
	cwd: string;
	timeoutMs: number;
}): Promise<PrimaryAcceptanceReviewV2> {
	let completed: BoundedReviewProcessResult;
	try {
		completed = await runBoundedReviewProcess({
			command: primaryReviewerCommand(),
			cwd: input.cwd,
			stdin: input.packet,
			timeoutMs: input.timeoutMs,
		});
	} catch (error) {
		const diagnostic = sanitizePrimaryDiagnostic(String(error));
		return {
			disposition: "NO_RESULT",
			category: "transport",
			...(diagnostic ? { diagnostic } : {}),
		};
	}
	return classifyPrimaryReviewResult(completed);
}
