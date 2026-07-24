import {
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import { systemTimestamp } from "#questpie/server/db/system-columns.js";

/**
 * Durable storage-delete outbox.
 *
 * The owner row and this intent are committed in the same transaction. External
 * object deletion is retried separately because no database transaction can
 * atomically commit a provider-side delete.
 */
export const questpieStorageCleanupTable = pgTable(
	"questpie_storage_cleanup",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		key: text("key").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		availableAt: timestamp("available_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		leasedUntil: timestamp("leased_until", {
			withTimezone: true,
			mode: "date",
		}),
		leaseToken: uuid("lease_token"),
		lastError: text("last_error"),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("idx_storage_cleanup_available").on(
			table.availableAt,
			table.leasedUntil,
			table.createdAt,
		),
		index("idx_storage_cleanup_key").on(table.key),
	],
);

/**
 * Cross-collection coordination rows for provider object keys.
 *
 * Writers and cleanup workers lock the same row so a delayed cleanup cannot
 * race a new or retained database reference to the key.
 */
export const questpieStorageObjectKeyTable = pgTable(
	"questpie_storage_object_key",
	{
		key: text("key").primaryKey(),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
	},
);
