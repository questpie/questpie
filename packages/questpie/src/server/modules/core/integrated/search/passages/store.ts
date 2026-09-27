import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { buildWhereClause } from "#questpie/server/collection/crud/query-builders/where-builder.js";
import { getColumn } from "#questpie/server/collection/crud/shared/index.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import { passageSource } from "./authority.js";
import {
	searchDocuments as documents,
	searchPassages as passages,
} from "./schema.js";
import type {
	PassageProfile,
	PassageSource,
	ReplaceSearchDocument,
} from "./types.js";

const hash = (value: unknown) =>
	createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function validatePassageVector(
	vector: number[],
	profile: PassageProfile,
) {
	if (
		vector.length !== profile.dimensions ||
		vector.some((n) => !Number.isFinite(n)) ||
		!vector.some((n) => n !== 0)
	)
		throw new Error("Invalid passage vector");
}

/** Internal indexing API; public discovery/read uses PassageSearch with a live caller context. */
export class PassageWriter {
	constructor(
		private app: Questpie<any>,
		private sources: PassageSource[],
		private profile: PassageProfile,
	) {}

	private source(name: string) {
		const source = this.sources.find((s) => s.collection === name);
		if (!source) throw new Error("Unregistered passage source");
		const resolved = passageSource(this.app, source);
		const table = resolved.collection.table;
		const deletedAt = resolved.collection.state.options?.softDelete
			? getColumn(table, "deletedAt")
			: undefined;
		const eligibility = and(
			deletedAt ? isNull(deletedAt) : undefined,
			buildWhereClause(source.where ?? {}, {
				table,
				state: resolved.collection.state,
				app: this.app,
				db: this.app.db,
				failClosedAccess: true,
				i18nCurrentTable: null,
				i18nFallbackTable: null,
			}),
		);
		return { ...resolved, eligibility };
	}

	async sourceToken(
		collection: string,
		recordId: string,
	): Promise<string | null> {
		const source = this.source(collection);
		const rows = await this.app.db
			.select({ token: source.token })
			.from(source.collection.table)
			.where(
				and(
					eq(getColumn(source.collection.table, "id")!, recordId),
					source.eligibility,
				),
			)
			.limit(1);
		return rows[0]?.token ?? null;
	}

	async isCurrent(
		collection: string,
		recordId: string,
		sourceToken: string,
	): Promise<boolean> {
		this.source(collection);
		const rows = await this.app.db
			.select({ id: documents.id })
			.from(documents)
			.where(
				and(
					eq(documents.collection, collection),
					eq(documents.recordId, recordId),
					eq(documents.sourceToken, sourceToken),
					eq(documents.profile, this.profile.id),
					eq(documents.representation, "live"),
					sql`(${documents.retryAt} IS NULL OR ${documents.retryAt} > now())`,
				),
			)
			.limit(1);
		return rows.length > 0;
	}

	/** Bounded reconciliation uses live source truth, including changes whose dispatch was lost. */
	async pending(
		collection: string,
		partition: string,
		where: Record<string, unknown>,
		limit = 20,
	): Promise<string[]> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 100)
			throw new Error("Invalid reconciliation limit");
		const source = this.source(collection);
		const table = source.collection.table;
		const id = getColumn(table, "id")!;
		const condition = buildWhereClause(where, {
			table,
			state: source.collection.state,
			app: this.app,
			db: this.app.db,
			failClosedAccess: true,
			i18nCurrentTable: null,
			i18nFallbackTable: null,
		});
		const rows = await this.app.db
			.select({ id })
			.from(table)
			.where(
				and(
					source.eligibility,
					condition,
					sql`NOT EXISTS (
			SELECT 1 FROM ${documents} WHERE ${documents.collection} = ${collection} AND ${documents.recordId} = ${id}
			AND ${documents.partition} = ${partition} AND ${documents.profile} = ${this.profile.id}
			AND ${documents.representation} = 'live' AND ${documents.sourceToken} = ${source.token}
			AND (${documents.retryAt} IS NULL OR ${documents.retryAt} > now())
		)`,
				),
			)
			.orderBy(id)
			.limit(limit);
		return rows.map((row) => String(row.id));
	}

	async replace(
		input: ReplaceSearchDocument,
	): Promise<"replaced" | "unchanged" | "stale"> {
		if (
			!input.partition ||
			input.partition.length > 256 ||
			!input.representation ||
			input.representation.length > 128 ||
			input.title.length > 2000 ||
			input.blocks.length > 2048 ||
			JSON.stringify(input).length > 12_000_000
		)
			throw new Error("Search document exceeds bounds");
		for (const block of input.blocks) {
			if (
				!block.text ||
				block.text.length > 16000 ||
				JSON.stringify(block.locator).length > 2000
			)
				throw new Error("Invalid passage block");
			if (block.embedding) validatePassageVector(block.embedding, this.profile);
		}
		const source = this.source(input.collection);
		const id = hash([
			input.collection,
			input.recordId,
			input.representation,
			this.profile.id,
		]);
		const manifestHash = hash(input);
		return this.app.db.transaction(async (db) => {
			// Lock the source first; replacement and a concurrent edit share the same fence.
			const current = await db
				.select({ token: source.token })
				.from(source.collection.table)
				.where(
					and(
						eq(getColumn(source.collection.table, "id")!, input.recordId),
						source.eligibility,
					),
				)
				.for("update")
				.limit(1);
			if (current[0]?.token !== input.expectedSourceToken) return "stale";
			const previous = await db
				.select()
				.from(documents)
				.where(eq(documents.id, id))
				.limit(1);
			if (previous[0]?.manifestHash === manifestHash) return "unchanged";
			const values = {
				id,
				collection: input.collection,
				recordId: input.recordId,
				partition: input.partition,
				representation: input.representation,
				profile: this.profile.id,
				sourceToken: input.expectedSourceToken,
				manifestHash,
				title: input.title,
				metadata: input.metadata,
				retryAt: input.retryAt ?? null,
				updatedAt: new Date(),
			};
			await db
				.insert(documents)
				.values(values)
				.onConflictDoUpdate({ target: documents.id, set: values });
			await db.delete(passages).where(eq(passages.documentId, id));
			for (let start = 0; start < input.blocks.length; start += 64) {
				await db.insert(passages).values(
					input.blocks.slice(start, start + 64).map((block, offset) => ({
						id: hash([id, manifestHash, start + offset]),
						documentId: id,
						ordinal: start + offset,
						field: block.field,
						text: block.text,
						locator: block.locator,
						embedding: block.embedding ?? null,
					})),
				);
			}
			return "replaced";
		});
	}

	async remove(collection: string, recordId: string) {
		this.source(collection);
		await this.app.db
			.delete(documents)
			.where(
				and(
					eq(documents.collection, collection),
					eq(documents.recordId, recordId),
				),
			);
	}
}
