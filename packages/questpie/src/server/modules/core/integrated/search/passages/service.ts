import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import type { Questpie } from "#questpie/server/config/questpie.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

import { passageAuthority, passageSource } from "./authority.js";
import { searchDocuments as d, searchPassages as p } from "./schema.js";
import { PassageWriter, validatePassageVector } from "./store.js";
import type {
	PassageContext,
	PassageHit,
	PassageProfile,
	PassageQuery,
	PassageSource,
} from "./types.js";

const projection = {
	id: p.id,
	documentId: p.documentId,
	collection: d.collection,
	recordId: d.recordId,
	representation: d.representation,
	sourceToken: d.sourceToken,
	manifestHash: d.manifestHash,
	title: d.title,
	field: p.field,
	text: p.text,
	locator: p.locator,
	ordinal: p.ordinal,
};

/** One canonical authorized passage projection for search and exact reads. */
export class PassageSearch<TConfig extends QuestpieConfig = QuestpieConfig> {
	readonly writer: PassageWriter;
	private readonly app: Questpie<any>;
	constructor(
		app: Omit<Questpie<TConfig>, "collections" | "globals">,
		private sources: PassageSource[],
		readonly profile: PassageProfile,
	) {
		// Generated app facades expose all public members but intentionally omit private implementation state.
		this.app = app as unknown as Questpie<any>;
		if (
			!profile.id ||
			!Number.isInteger(profile.dimensions) ||
			profile.dimensions < 1 ||
			profile.dimensions > 4096
		)
			throw new Error("Invalid passage profile");
		if (new Set(sources.map((s) => s.collection)).size !== sources.length)
			throw new Error("Duplicate passage source");
		for (const source of sources) passageSource(this.app, source);
		this.writer = new PassageWriter(this.app, sources, profile);
	}

	async search(
		input: PassageQuery,
		context: PassageContext,
	): Promise<PassageHit[]> {
		if (!input.query.trim() || input.query.length > 500 || !input.partition)
			throw new Error("Invalid passage query");
		const limit = input.limit ?? 40;
		if (!Number.isInteger(limit) || limit < 1 || limit > 80)
			throw new Error("Invalid passage limit");
		const perDocument = input.maxPassagesPerDocument ?? limit;
		if (
			!Number.isInteger(perDocument) ||
			perDocument < 1 ||
			perDocument > limit
		)
			throw new Error("Invalid document passage limit");
		const sources = this.sources.filter(
			(s) => !input.collections || input.collections.includes(s.collection),
		);
		const authority = await passageAuthority(
			this.app,
			sources,
			context,
			input.where,
		);
		const conditions = [
			eq(d.partition, input.partition),
			eq(d.profile, this.profile.id),
			eq(d.representation, "live"),
			authority,
		];
		if (input.fields && input.fields !== "both")
			conditions.push(eq(p.field, input.fields));
		for (const [key, value] of Object.entries(input.metadata ?? {}))
			conditions.push(sql`${d.metadata}->>${key} = ${value}`);
		const db = context.db ?? this.app.db;
		const ranked = async (condition: SQL, score: SQL) => {
			const candidates = db
				.select({
					...projection,
					sortScore: score.as("sort_score"),
					passageRank:
						sql<number>`row_number() over (partition by ${d.id} order by ${score} desc, ${p.id})`.as(
							"passage_rank",
						),
				})
				.from(p)
				.innerJoin(d, eq(p.documentId, d.id))
				.where(and(...conditions, condition))
				.as("authorized_passages");
			return db
				.select()
				.from(candidates)
				.where(sql`${candidates.passageRank} <= ${perDocument}`)
				.orderBy(desc(candidates.sortScore), asc(candidates.id))
				.limit(limit);
		};
		const mode = input.mode ?? "lexical";
		const lexical = async () => {
			const terms = input.query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 32) ?? [];
			if (!terms.length) return [];
			const query = sql`to_tsquery('simple', ${terms.map((s) => `${s}:*`).join(" & ")})`;
			return ranked(
				sql`${p.fts} @@ ${query}`,
				sql`ts_rank_cd(${p.fts}, ${query})`,
			);
		};
		const semantic = async () => {
			if (!input.vector) throw new Error("Semantic search requires a vector");
			validatePassageVector(input.vector, this.profile);
			// Exact distance over the authorized partition. No shared ANN post-filter underfill.
			return ranked(
				sql`${p.embedding} IS NOT NULL`,
				sql`-(${p.embedding} <=> ${JSON.stringify(input.vector)}::vector)`,
			);
		};
		const arms = await Promise.all([
			mode !== "semantic" ? lexical() : [],
			mode !== "lexical" ? semantic() : [],
		]);
		const hits = new Map<string, PassageHit>();
		for (const arm of arms)
			for (const [rank, row] of arm.entries()) {
				const old = hits.get(row.id);
				hits.set(row.id, {
					...row,
					score: (old?.score ?? 0) + 1 / (60 + rank + 1),
				});
			}
		return [...hits.values()]
			.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
			.slice(0, limit);
	}

	async read(
		input: {
			partition: string;
			documentId: string;
			sourceToken: string;
			manifestHash: string;
			collection?: string;
			recordId?: string;
			after?: number;
			limit?: number;
		},
		context: PassageContext,
	) {
		const limit = input.limit ?? 8;
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 20 ||
			(input.after !== undefined &&
				(!Number.isInteger(input.after) || input.after < -1))
		)
			throw new Error("Invalid passage page");
		const authority = await passageAuthority(this.app, this.sources, context);
		const db = context.db ?? this.app.db;
		const where = and(
			eq(d.id, input.documentId),
			eq(d.partition, input.partition),
			eq(d.profile, this.profile.id),
			eq(d.representation, "live"),
			eq(d.sourceToken, input.sourceToken),
			eq(d.manifestHash, input.manifestHash),
			input.collection ? eq(d.collection, input.collection) : undefined,
			input.recordId ? eq(d.recordId, input.recordId) : undefined,
			authority,
		);
		const doc = await db
			.select({ id: d.id, metadata: d.metadata })
			.from(d)
			.where(where)
			.limit(1);
		if (!doc.length)
			return { status: "unavailable" as const, blocks: [], nextAfter: null };
		const rows = await db
			.select(projection)
			.from(p)
			.innerJoin(d, eq(p.documentId, d.id))
			.where(and(where, sql`${p.ordinal} > ${input.after ?? -1}`))
			.orderBy(asc(p.ordinal))
			.limit(limit + 1);
		return {
			status: "ready" as const,
			metadata: doc[0]!.metadata,
			blocks: rows.slice(0, limit),
			nextAfter: rows.length > limit ? rows[limit - 1]!.ordinal : null,
		};
	}
}
