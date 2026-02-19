/**
 * Versioning Utilities
 *
 * Functions for creating and managing version records.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type {
	CollectionBuilderState,
	CollectionOptions,
} from "#questpie/server/collection/builder/types.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";

/**
 * Options for creating a version record
 */
export interface CreateVersionOptions {
	/** Transaction or database client */
	tx: any;
	/** The row data to version */
	row: Record<string, any>;
	/** Operation type */
	operation: "create" | "update" | "delete";
	/** Versions table */
	versionsTable: PgTable;
	/** I18n versions table (optional) */
	i18nVersionsTable: PgTable | null;
	/** I18n table (optional) */
	i18nTable: PgTable | null;
	/** Collection options (for maxVersions config) */
	options: CollectionOptions;
	/** CRUD context */
	context: CRUDContext;
	/** Workflow target stage for this version snapshot */
	workflowStage?: string;
	/** Previous stage before transition (if applicable) */
	workflowFromStage?: string;
}

/**
 * Create a new version record for the row
 *
 * Handles:
 * - Incrementing version number
 * - Inserting version record
 * - Copying i18n data to i18n versions table
 * - Cleaning up old versions if maxVersions is set
 *
 * @param options - Version creation options
 */
export async function createVersionRecord(
	options: CreateVersionOptions,
): Promise<void> {
	const {
		tx,
		row,
		operation,
		versionsTable,
		i18nVersionsTable,
		i18nTable,
		options: collectionOptions,
		context,
		workflowStage,
		workflowFromStage,
	} = options;

	// Get max version number
	const maxVersionQuery = await tx
		.select({
			max: sql<number>`MAX(${(versionsTable as any).versionNumber})`,
		})
		.from(versionsTable)
		.where(eq((versionsTable as any).id, row.id));

	const currentVersion = maxVersionQuery[0]?.max || 0;
	const newVersion = Number(currentVersion) + 1;

	// Insert new version
	const versionValues: Record<string, unknown> = {
		...row,
		versionNumber: newVersion,
		versionOperation: operation,
		versionUserId: context.session?.user?.id
			? String(context.session.user.id)
			: null,
		versionCreatedAt: new Date(),
	};

	if ((versionsTable as any).versionStage) {
		versionValues.versionStage = workflowStage ?? null;
	}

	if ((versionsTable as any).versionFromStage) {
		versionValues.versionFromStage = workflowFromStage ?? null;
	}

	await tx.insert(versionsTable).values(versionValues);

	// Copy i18n data to versions table
	if (i18nVersionsTable && i18nTable) {
		const i18nRows = await tx
			.select()
			.from(i18nTable)
			.where(eq((i18nTable as any).parentId, row.id));

		if (i18nRows.length > 0) {
			const insertRows = i18nRows.map((i18nRow: any) => {
				const { id: _id, parentId: _parentId, ...rest } = i18nRow;
				return {
					parentId: row.id,
					versionNumber: newVersion,
					...rest,
				};
			});

			await tx.insert(i18nVersionsTable).values(insertRows);
		}
	}

	// Cleanup old versions if maxVersions is set
	const versioningConfig = collectionOptions.versioning;
	if (typeof versioningConfig === "object" && versioningConfig.maxVersions) {
		await cleanupOldVersions(
			tx,
			row.id,
			versioningConfig.maxVersions,
			versionsTable,
			i18nVersionsTable,
		);
	}
}

/**
 * Cleanup old versions that exceed maxVersions limit
 */
async function cleanupOldVersions(
	tx: any,
	recordId: string,
	maxVersions: number,
	versionsTable: PgTable,
	i18nVersionsTable: PgTable | null,
): Promise<void> {
	// Find versions to delete (all versions older than top N)
	const versionsToDelete = await tx
		.select({ versionNumber: (versionsTable as any).versionNumber })
		.from(versionsTable)
		.where(eq((versionsTable as any).id, recordId))
		.orderBy(sql`${(versionsTable as any).versionNumber} DESC`)
		.offset(maxVersions);

	if (versionsToDelete.length > 0) {
		const versionNumbers = versionsToDelete.map((v: any) => v.versionNumber);

		// Delete old versions
		await tx
			.delete(versionsTable)
			.where(
				and(
					eq((versionsTable as any).id, recordId),
					inArray((versionsTable as any).versionNumber, versionNumbers),
				),
			);

		// Delete corresponding i18n versions
		if (i18nVersionsTable) {
			await tx
				.delete(i18nVersionsTable)
				.where(
					and(
						eq((i18nVersionsTable as any).parentId, recordId),
						inArray((i18nVersionsTable as any).versionNumber, versionNumbers),
					),
				);
		}
	}
}
