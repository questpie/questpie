import { sql } from "drizzle-orm";
import {
	customType,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const vector = customType<{ data: number[]; driverData: string }>({
	dataType: () => "vector",
	toDriver: (value) => JSON.stringify(value),
	fromDriver: (value) => JSON.parse(value),
});

export const searchDocuments = pgTable(
	"questpie_search_documents",
	{
		id: text("id").primaryKey(),
		collection: text("collection_name").notNull(),
		recordId: text("record_id").notNull(),
		partition: text("partition_key").notNull(),
		representation: text("representation").notNull(),
		profile: text("profile").notNull(),
		sourceToken: text("source_token").notNull(),
		manifestHash: text("manifest_hash").notNull(),
		title: text("title").notNull(),
		metadata: jsonb("metadata").$type<Record<string, string>>().notNull(),
		retryAt: timestamp("retry_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique("uq_search_document").on(
			t.collection,
			t.recordId,
			t.representation,
			t.profile,
		),
		index("idx_search_document_partition").on(
			t.partition,
			t.profile,
			t.collection,
		),
	],
);

export const searchPassages = pgTable(
	"questpie_search_passages",
	{
		id: text("id").primaryKey(),
		documentId: text("document_id")
			.notNull()
			.references(() => searchDocuments.id, { onDelete: "cascade" }),
		ordinal: integer("ordinal").notNull(),
		field: text("field").$type<"title" | "content">().notNull(),
		text: text("text").notNull(),
		locator: jsonb("locator")
			.$type<Record<string, string | number>>()
			.notNull(),
		embedding: vector("embedding"),
		fts: tsvector("fts")
			.generatedAlwaysAs(sql`to_tsvector('simple', text)`)
			.notNull(),
	},
	(t) => [
		unique("uq_search_passage_ordinal").on(t.documentId, t.ordinal),
		index("idx_search_passage_fts").using("gin", t.fts),
	],
);
