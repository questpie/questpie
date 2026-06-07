/**
 * Memory injection at run start — the workflow-facing entry point.
 *
 * The SIBLING of `buildSkillsSystemPrompt` (`lib/skill-discovery.ts`):
 * `chat-query` + `task-pipeline` call this to PREPEND the recalled-memory DATA block
 * to a run's instructions. It wires the pure recall core (`lib/memory-recall.ts`) to
 * the real I/O: the framework semantic search (`app.search`, backed by the pgvector
 * adapter) for cosine candidates, and the `agent_memory` collection for the
 * authoritative rows + the access bump.
 *
 * RESILIENCE: recall is a best-effort enrichment, NOT a gate on the run. If semantic
 * search is unavailable (no pgvector adapter / no embedding provider configured), or
 * any step throws, we log and return the base instructions UNCHANGED — a run must
 * never fail because memory recall did. The block is also a no-op when nothing is
 * recalled (same as skills).
 */

import {
	bumpMemoryAccess,
	type FetchMemoryRowsFn,
	type MemoryAccessCollections,
	type MemoryRow,
	recallMemories,
	type RecallScope,
	renderMemoryBlock,
	type SemanticSearchFn,
} from "./memory-recall";

/**
 * A logger shape (the workflow `log`); only `warn`/`info` are used. The `meta` arg
 * is typed `Record<string, unknown>` to be assignable FROM the workflow's
 * `WorkflowLogger` (whose handlers take `Record<string, unknown> | undefined`).
 */
interface InjectionLogger {
	warn?: (message: string, meta?: Record<string, unknown>) => void;
	info?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * The minimal `app.search` surface recall needs: a semantic `search` over a single
 * collection returning the hits + their relevance score. Structurally satisfied by
 * the real `SearchService` (`app.search`).
 */
export interface MemorySearchService {
	search(args: {
		query: string;
		mode: "semantic";
		collections: string[];
		limit: number;
		highlights?: boolean;
	}): Promise<{
		results: Array<{ recordId: string; score: number }>;
	}>;
}

/**
 * The `agent_memory` collection surface injection needs: `find` (fetch the
 * authoritative rows for the semantic candidates) + the access-bump methods.
 */
export interface MemoryInjectionCollections extends MemoryAccessCollections {
	agent_memory: MemoryAccessCollections["agent_memory"] & {
		find(args: {
			where: Record<string, unknown>;
			limit?: number;
		}): Promise<{ docs: Array<Record<string, unknown>> }>;
	};
}

/** The `ctx` subset memory injection reads (search + the agent_memory collection). */
export interface MemoryInjectionContext extends RecallScope {
	/**
	 * `unknown` to match the codegen `WorkflowContext.search`; the real `app.search`
	 * structurally satisfies {@link MemorySearchService} and is narrowed before use.
	 */
	search: unknown;
	collections: MemoryInjectionCollections;
}

/** The `agent_memory` collection name (the search target + row source). */
const MEMORY_COLLECTION = "agent_memory";

/** Adapt the framework semantic search into the recall core's {@link SemanticSearchFn}. */
function makeSemanticSearch(search: MemorySearchService): SemanticSearchFn {
	return async ({ query, limit }) => {
		const response = await search.search({
			query,
			mode: "semantic",
			collections: [MEMORY_COLLECTION],
			limit,
			highlights: false,
		});
		return response.results
			.filter((hit) => typeof hit.recordId === "string")
			.map((hit) => ({
				recordId: hit.recordId,
				cosine: typeof hit.score === "number" ? hit.score : 0,
			}));
	};
}

/** Coerce a raw `agent_memory` row into the {@link MemoryRow} recall consumes. */
function toMemoryRow(raw: Record<string, unknown>): MemoryRow | null {
	const id = raw.id;
	if (typeof id !== "string") return null;
	const last = raw.lastAccessedAt;
	return {
		id,
		content: typeof raw.content === "string" ? raw.content : "",
		importance: typeof raw.importance === "number" ? raw.importance : 5,
		status: typeof raw.status === "string" ? raw.status : "active",
		scopeType: typeof raw.scopeType === "string" ? raw.scopeType : "company",
		scopeRef: typeof raw.scopeRef === "string" ? raw.scopeRef : null,
		type: typeof raw.type === "string" ? raw.type : "episodic",
		lastAccessedAt:
			last instanceof Date
				? last.toISOString()
				: typeof last === "string"
					? last
					: null,
	};
}

/** Adapt `collections.agent_memory.find` into the recall core's {@link FetchMemoryRowsFn}. */
function makeFetchRows(
	collections: MemoryInjectionCollections,
): FetchMemoryRowsFn {
	return async (ids) => {
		if (ids.length === 0) return [];
		const result = await collections.agent_memory.find({
			where: { id: { in: ids } },
			limit: ids.length,
		});
		const rows: MemoryRow[] = [];
		for (const doc of result.docs) {
			const row = toMemoryRow(doc);
			if (row) rows.push(row);
		}
		return rows;
	};
}

/**
 * Build the run-start instructions: the recalled-memory block PREPENDED to the
 * caller's base instructions, bumping access on the memories actually injected.
 *
 * Returns the base instructions unchanged when search is unavailable, nothing is
 * recalled, or recall errors. `query` is the run's intent text (the prompt / task
 * instructions) — recall surfaces memories semantically relevant to THIS run.
 */
export async function injectMemoriesIntoInstructions(
	ctx: MemoryInjectionContext,
	baseInstructions: string,
	query: string,
	log?: InjectionLogger,
): Promise<string> {
	// No search backend (e.g. plain-Postgres adapter, no embedding provider) → recall
	// is simply off. Not an error; the run proceeds without learned context.
	const search = ctx.search as MemorySearchService | null | undefined;
	if (!search || typeof search.search !== "function") return baseInstructions;

	try {
		const memories = await recallMemories(
			makeSemanticSearch(search),
			makeFetchRows(ctx.collections),
			query,
			{ projectId: ctx.projectId, taskId: ctx.taskId },
		);
		const block = renderMemoryBlock(memories);
		if (!block) return baseInstructions;

		// Bump access on the injected memories (best-effort — never fail the run).
		try {
			await bumpMemoryAccess(
				ctx.collections,
				memories.map((m) => m.recordId),
			);
		} catch (error) {
			log?.warn?.("memory access bump failed", { error });
		}

		return `${block}\n\n${baseInstructions}`;
	} catch (error) {
		// Semantic search not implemented / provider error / etc. — degrade to the
		// base instructions. Memory recall is enrichment, never a run-blocker.
		log?.warn?.("memory recall failed; proceeding without learned context", {
			error,
		});
		return baseInstructions;
	}
}
