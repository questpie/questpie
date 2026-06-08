/**
 * Memory WRITE — reflection at run end (Reflexion, §9.2).
 *
 * AFTER a run completes (async — Open Decision 7 resolved to async), a reflection
 * step reviews the run's TRAJECTORY (instructions + summary + outcome) and emits
 * 0–N candidate memories, each tagged `type`/`scope`/`importance`. Candidates are
 * GATED by importance (trivial runs write nothing) and DE-DUPLICATED by a content
 * hash (an identical lesson in the same scope is never written twice).
 *
 * This module is the PURE core of that step: the prompt builder, the response
 * parser, the importance gate, the content-hash key, and the candidate→row mapper.
 * The LLM call itself is an injected boundary ({@link ReflectFn}) — there is no
 * in-process model client on the autopilot SERVER today (agents run in workers), so
 * the live model invocation is wired separately and this logic is fully unit-tested
 * with a mock `reflect`.
 *
 * OUT OF SCOPE here (slice 2): write-side adjudication (KEEP/STALE/REPLACE against
 * nearest neighbors) + supersedes chains. This slice writes every surviving
 * candidate as a fresh `status:"active"` memory; the `supersedes`/`status`
 * machinery exists on the collection but is not driven yet.
 */

import { createHash } from "node:crypto";

/** Memories below this importance are dropped (the gate). 1-10 scale. */
export const MIN_IMPORTANCE = 4;

/** Hard cap on how many candidates a single reflection may persist. */
export const MAX_CANDIDATES_PER_RUN = 5;

/** The CoALA memory types a candidate may declare. */
export type MemoryType = "episodic" | "semantic" | "procedural";

/** The scope tiers a candidate may target. */
export type MemoryScopeType = "company" | "project" | "task";

/** The run trajectory + outcome the reflection reasons over. */
export interface ReflectionInput {
	/** The run's instructions (its intent). */
	instructions: string;
	/** The run's final summary (what the agent reported it did). */
	summary?: string | null;
	/** The terminal outcome signal — the Reflexion success/fail signal. */
	outcome: "completed" | "failed" | "cancelled";
	/** Optional error text when the run failed. */
	error?: string | null;
	/** The active scope (so candidates can be tagged project/task vs company). */
	scope: { projectId?: string | null; taskId?: string | null };
}

/**
 * A raw candidate as the model emits it (before gating/normalization). The model is
 * asked to return an array of these as JSON.
 */
export interface RawMemoryCandidate {
	type?: string;
	scopeType?: string;
	content?: string;
	importance?: number;
	confidence?: number;
}

/** A validated, gated candidate ready to persist as an `agent_memory` row. */
export interface MemoryCandidateRow {
	type: MemoryType;
	scopeType: MemoryScopeType;
	scopeRef: string | null;
	content: string;
	importance: number;
	confidence: number | null;
	contentHash: string;
	source: "reflection";
	status: "active";
}

/** The injected LLM boundary: given the trajectory, return raw candidates. */
export type ReflectFn = (input: ReflectionInput) => Promise<RawMemoryCandidate[]>;

/**
 * Build the reflection prompt (the system + user text the model reflects with).
 *
 * Kept as a pure builder so the prompt is snapshot-testable and the live wiring just
 * feeds it to whatever model client exists. The prompt instructs the model to emit a
 * JSON array of `{type, scopeType, content, importance, confidence}` and to emit an
 * EMPTY array when nothing durable was learned (the Reflexion "write nothing on a
 * trivial run" behavior is enforced by the importance gate regardless).
 */
export function buildReflectionPrompt(input: ReflectionInput): string {
	const outcomeLine =
		input.outcome === "completed"
			? "The run COMPLETED successfully."
			: input.outcome === "failed"
				? `The run FAILED${input.error ? `: ${input.error}` : "."}`
				: "The run was CANCELLED.";

	return [
		"You are a reflection step. Review the run below and extract DURABLE LESSONS",
		"worth recalling on a FUTURE similar run (Reflexion). Output ONLY a JSON array",
		'of objects: { "type": "episodic|semantic|procedural", "scopeType":',
		'"company|project|task", "content": string, "importance": 1-10, "confidence":',
		"0-1 }. Emit an EMPTY array [] when nothing durable was learned. Prefer FEWER,",
		"higher-signal lessons. A lesson must be self-contained and actionable; never",
		"include secrets or one-off ids.",
		"",
		"--- RUN ---",
		outcomeLine,
		`INSTRUCTIONS: ${input.instructions}`,
		input.summary ? `SUMMARY: ${input.summary}` : "",
		"--- END RUN ---",
	]
		.filter(Boolean)
		.join("\n");
}

/**
 * Parse the model's raw text into raw candidates. Tolerant: accepts a bare JSON
 * array or an array wrapped in prose / a ```json fence (models often wrap). Returns
 * `[]` on any parse failure (a malformed reflection writes nothing — fail-safe, the
 * run already succeeded/failed independently).
 */
export function parseReflectionResponse(text: string): RawMemoryCandidate[] {
	if (typeof text !== "string") return [];
	// Extract the first top-level `[ ... ]` so a fenced / prose-wrapped array parses.
	const start = text.indexOf("[");
	const end = text.lastIndexOf("]");
	if (start === -1 || end === -1 || end <= start) return [];
	const slice = text.slice(start, end + 1);
	try {
		const parsed = JSON.parse(slice);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(item): item is RawMemoryCandidate =>
				item != null && typeof item === "object",
		);
	} catch {
		return [];
	}
}

/** Normalize free text for hashing: trim, collapse whitespace, lowercase. */
function normalizeForHash(content: string): string {
	return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The DEDUPE key for a memory: a stable hash of the normalized content scoped to its
 * (scopeType, scopeRef). Same lesson + same scope ⇒ same hash ⇒ skipped if it
 * already exists. Scope is part of the key so the same lesson can legitimately exist
 * at company AND project scope.
 */
export function memoryContentHash(
	content: string,
	scopeType: MemoryScopeType,
	scopeRef: string | null,
): string {
	return createHash("sha256")
		.update(`${scopeType}:${scopeRef ?? ""}:${normalizeForHash(content)}`)
		.digest("hex");
}

const VALID_TYPES: ReadonlySet<string> = new Set([
	"episodic",
	"semantic",
	"procedural",
]);
const VALID_SCOPES: ReadonlySet<string> = new Set([
	"company",
	"project",
	"task",
]);

/**
 * Gate + normalize raw candidates into persistable rows.
 *
 * Drops a candidate when: content is empty; importance < {@link MIN_IMPORTANCE} (the
 * trivial-run gate); type/scopeType are invalid; OR the declared scope is project/
 * task but the run has no such id (a candidate cannot claim a scope the run is not
 * in — it is DOWN-SCOPED to the broadest scope the run actually has). De-duplicates
 * WITHIN the batch by contentHash and caps at {@link MAX_CANDIDATES_PER_RUN}. The
 * contentHash is computed here so the persistence layer can skip existing rows.
 */
export function gateCandidates(
	raw: RawMemoryCandidate[],
	input: ReflectionInput,
): MemoryCandidateRow[] {
	const out: MemoryCandidateRow[] = [];
	const seen = new Set<string>();

	for (const candidate of raw) {
		const content =
			typeof candidate.content === "string" ? candidate.content.trim() : "";
		if (content.length === 0) continue;

		const importance =
			typeof candidate.importance === "number"
				? Math.round(candidate.importance)
				: 0;
		if (importance < MIN_IMPORTANCE) continue;
		const clampedImportance = Math.max(1, Math.min(10, importance));

		const type = (
			VALID_TYPES.has(String(candidate.type)) ? candidate.type : "episodic"
		) as MemoryType;

		// Resolve the scope: honor the declared tier ONLY if the run actually has the
		// matching id; otherwise down-scope to the broadest tier the run has.
		let scopeType: MemoryScopeType = "company";
		let scopeRef: string | null = null;
		const declared = String(candidate.scopeType);
		if (VALID_SCOPES.has(declared)) {
			if (declared === "task" && input.scope.taskId) {
				scopeType = "task";
				scopeRef = input.scope.taskId;
			} else if (declared === "project" && input.scope.projectId) {
				scopeType = "project";
				scopeRef = input.scope.projectId;
			} else if (declared === "company") {
				scopeType = "company";
				scopeRef = null;
			} else if (input.scope.projectId) {
				// Declared task but no task id (or project but no project id) → fall back
				// to project if available, else company.
				scopeType = "project";
				scopeRef = input.scope.projectId;
			}
		}

		const contentHash = memoryContentHash(content, scopeType, scopeRef);
		if (seen.has(contentHash)) continue;
		seen.add(contentHash);

		const confidence =
			typeof candidate.confidence === "number"
				? Math.max(0, Math.min(1, candidate.confidence))
				: null;

		out.push({
			type,
			scopeType,
			scopeRef,
			content,
			importance: clampedImportance,
			confidence,
			contentHash,
			source: "reflection",
			status: "active",
		});

		if (out.length >= MAX_CANDIDATES_PER_RUN) break;
	}

	return out;
}

/**
 * The `agent_memory` persistence surface the reflection write needs: a dedupe lookup
 * (by scope + contentHash) + a create. Structurally satisfied by the real
 * `ctx.collections.agent_memory`.
 */
export interface MemoryWriteCollections {
	agent_memory: {
		findOne(args: {
			where: Record<string, unknown>;
		}): Promise<{ id: string } | null>;
		create(data: Record<string, unknown>): Promise<{ id: string }>;
	};
}

/** The outcome of a reflection write (for logging / activity). */
export interface ReflectionWriteResult {
	written: number;
	skippedDuplicates: number;
}

/**
 * Run the full reflection write: reflect → parse → gate → persist (skipping existing
 * contentHash rows). The model `reflect` boundary is injected so the live model
 * client wires separately and this is unit-tested with a mock. `sourceRunId` stamps
 * provenance on every written memory.
 *
 * Returns counts; never throws on a single-candidate failure path (a malformed/empty
 * reflection simply writes nothing). A `reflect` that throws propagates so the caller
 * (the workflow step) can log it — reflection is async/off-path so a failure there
 * does not affect the already-finished run.
 */
export async function reflectAndWrite(
	reflect: ReflectFn,
	collections: MemoryWriteCollections,
	input: ReflectionInput,
	sourceRunId: string,
): Promise<ReflectionWriteResult> {
	const raw = await reflect(input);
	const candidates = gateCandidates(raw, input);

	let written = 0;
	let skippedDuplicates = 0;
	for (const candidate of candidates) {
		// Dedupe across runs: skip if the same (scope, contentHash) already exists.
		const existing = await collections.agent_memory.findOne({
			where: {
				scopeType: candidate.scopeType,
				scopeRef: candidate.scopeRef ?? undefined,
				contentHash: candidate.contentHash,
			},
		});
		if (existing) {
			skippedDuplicates += 1;
			continue;
		}
		await collections.agent_memory.create({
			type: candidate.type,
			scopeType: candidate.scopeType,
			scopeRef: candidate.scopeRef ?? undefined,
			content: candidate.content,
			importance: candidate.importance,
			confidence: candidate.confidence ?? undefined,
			contentHash: candidate.contentHash,
			source: candidate.source,
			status: candidate.status,
			sourceRun: sourceRunId,
		});
		written += 1;
	}

	return { written, skippedDuplicates };
}
