/**
 * Memory reflection STEP — the workflow-facing async write helper (§9.2).
 *
 * `task-pipeline` (and `chat-query`) call {@link runReflectionStep} AFTER a run
 * reaches its terminal status. It: (1) checks the per-scope "agent may write memory"
 * toggle (`lib/memory-gate.ts`); (2) builds the trajectory; (3) reflects via the
 * injected model boundary; (4) gates + dedupes + persists candidate memories
 * (`lib/memory-reflection.ts`).
 *
 * ASYNC / OFF-PATH: this runs as its own workflow step after the run is already
 * done, so its latency/cost never blocks the run, and a failure here is logged but
 * does NOT change the run's outcome (Open Decision 7 → async).
 *
 * THE MODEL BOUNDARY ({@link ReflectFn}) IS NOT WIRED TO A LIVE MODEL YET. The
 * autopilot SERVER has no in-process LLM client (agents run in workers, the server
 * orchestrates). So the default `reflect` here returns `[]` (writes nothing) and the
 * full gate→dedupe→persist pipeline is exercised + unit-tested with a mock `reflect`.
 * Wiring a real model (a worker round-trip, or a server-side provider call once one
 * exists) is a one-function swap — pass a live `reflect` into {@link runReflectionStep}.
 */

import { agentMayWriteMemory, type GateScope } from "./memory-gate";
import {
	type MemoryWriteCollections,
	type RawMemoryCandidate,
	reflectAndWrite,
	type ReflectFn,
	type ReflectionInput,
	type ReflectionWriteResult,
} from "./memory-reflection";

/**
 * A logger shape (the workflow `log`); only `warn`/`info` are used. The `meta` arg
 * is typed `Record<string, unknown>` to be assignable FROM the workflow's
 * `WorkflowLogger` (whose handlers take `Record<string, unknown> | undefined`).
 */
interface ReflectStepLogger {
	warn?: (message: string, meta?: Record<string, unknown>) => void;
	info?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * The DEFAULT model boundary: emits NO candidates (writes nothing). Replace by
 * passing a live `reflect` to {@link runReflectionStep} once a model client is
 * available on the autopilot server. Kept as a named export so the "off" state is
 * explicit and testable.
 */
export const noopReflect: ReflectFn = async (): Promise<RawMemoryCandidate[]> => [];

/** The collections surface the reflection step needs (gate + write). */
export type ReflectStepCollections = MemoryWriteCollections & {
	memory_settings: {
		findOne(args: {
			where: Record<string, unknown>;
		}): Promise<{ agentMayWrite?: boolean | null } | null>;
	};
};

/** Options for {@link runReflectionStep}. */
export interface RunReflectionStepOptions {
	/** The run whose trajectory is reflected on (provenance + dedupe scope). */
	runId: string;
	/** The trajectory + outcome the reflection reasons over. */
	input: ReflectionInput;
	/** The active scope, for the write-permission gate. */
	scope: GateScope;
	/** The model boundary (default {@link noopReflect} — see file header). */
	reflect?: ReflectFn;
	/** Optional logger (the workflow `log`). */
	log?: ReflectStepLogger;
}

/**
 * Run the reflection write for a finished run. Returns the write result, or a
 * `skipped` marker when the scope's toggle disallows agent writes. Never throws on a
 * model/parse failure — reflection is off-path enrichment.
 */
export async function runReflectionStep(
	collections: ReflectStepCollections,
	options: RunReflectionStepOptions,
): Promise<ReflectionWriteResult & { skipped: boolean }> {
	// Governance: respect the per-scope "agent may write memory" toggle (§9.7).
	const mayWrite = await agentMayWriteMemory(collections, options.scope);
	if (!mayWrite) {
		options.log?.info?.("memory write skipped (disabled for scope)", {
			runId: options.runId,
			scope: options.scope,
		});
		return { written: 0, skippedDuplicates: 0, skipped: true };
	}

	try {
		const result = await reflectAndWrite(
			options.reflect ?? noopReflect,
			collections,
			options.input,
			options.runId,
		);
		if (result.written > 0 || result.skippedDuplicates > 0) {
			options.log?.info?.("memory reflection wrote candidates", {
				runId: options.runId,
				...result,
			});
		}
		return { ...result, skipped: false };
	} catch (error) {
		// A model/parse/persist failure must not affect the already-finished run.
		options.log?.warn?.("memory reflection failed", {
			runId: options.runId,
			error,
		});
		return { written: 0, skippedDuplicates: 0, skipped: false };
	}
}
