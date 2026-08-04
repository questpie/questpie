import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createRedactor } from "./redact.js";
import { positive } from "./validate.js";

/**
 * Shared by every harness in this package. A run that prints forever must cost
 * a fixed amount of memory, so the ring is bounded twice: by how many lines it
 * keeps and by how long any one of them may be.
 */
export const DEFAULT_MAX_EVIDENCE_LINES = 500;
export const DEFAULT_MAX_EVIDENCE_LINE_CHARS = 4_096;
const DEFAULT_TAIL_LINES = 20;

export type EvidenceStream = "stdout" | "stderr";
export type EvidenceOutcome = "pass" | "fail";

export interface EvidenceOptions {
	/** Exact values replaced in every line and in anything written to disk. */
	secrets?: readonly string[];
	maxLines?: number;
	maxLineChars?: number;
	/** Written on failure, removed on success. Omit to keep everything in memory. */
	artifactDir?: string;
	/** Recorded in the manifest so a preserved run says what produced it. */
	command?: readonly string[];
}

export interface Evidence {
	push(stream: EvidenceStream, line: string): void;
	/** The trailing lines, already bounded and redacted. */
	tail(count?: number): readonly string[];
	addSecret(value: string): void;
	redact(value: string): string;
	/**
	 * Applies the artifact policy. Returns the directory it kept, or `undefined`
	 * when the run passed or no directory was configured.
	 */
	persist(outcome: EvidenceOutcome): Promise<string | undefined>;
}

export function createEvidence(options: EvidenceOptions): Evidence {
	const maxLines = positive(
		options.maxLines ?? DEFAULT_MAX_EVIDENCE_LINES,
		"maxLines",
	);
	const maxLineChars = positive(
		options.maxLineChars ?? DEFAULT_MAX_EVIDENCE_LINE_CHARS,
		"maxLineChars",
	);
	const secrets = new Set((options.secrets ?? []).filter(Boolean));
	const ring: string[] = [];

	const redact = (value: string): string => createRedactor(secrets)(value);

	return {
		push(stream, line) {
			// Redact first, then truncate. The other order lets a secret that
			// straddles the cut keep its first half, and that half matches no
			// registered value, so nothing would ever replace it.
			ring.push(`[${stream}] ${redact(line).slice(0, maxLineChars)}`);
			if (ring.length > maxLines) ring.splice(0, ring.length - maxLines);
		},
		tail(count = DEFAULT_TAIL_LINES) {
			return ring.slice(-Math.max(0, count));
		},
		addSecret(value) {
			if (value) secrets.add(value);
		},
		redact,
		async persist(outcome) {
			const dir = options.artifactDir;
			if (!dir) return undefined;
			if (outcome === "pass") {
				// A green suite leaves nothing behind. Anything kept here would be
				// read later as the record of a failure that never happened.
				await rm(dir, { recursive: true, force: true });
				return undefined;
			}

			await mkdir(dir, { recursive: true });
			await writeFile(
				join(dir, "manifest.json"),
				`${JSON.stringify(
					{
						outcome,
						command: options.command ?? null,
						runtime: `bun ${Bun.version}`,
						finishedAt: new Date().toISOString(),
						lines: ring.length,
					},
					null,
					2,
				)}\n`,
			);
			await writeFile(join(dir, "output.log"), `${ring.join("\n")}\n`);
			return dir;
		},
	};
}
