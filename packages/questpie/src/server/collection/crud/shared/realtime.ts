/**
 * Shared Realtime Utilities
 *
 * Provides realtime change notification utilities for CRUD operations.
 */

import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { normalizeContext } from "./context.js";

/**
 * Parameters for appending a realtime change
 */
export interface AppendRealtimeChangeParams {
	/** Operation type */
	operation: "create" | "update" | "delete" | "bulk_update" | "bulk_delete";
	/** Record ID (null for bulk operations) */
	recordId?: string | null;
	/** Additional payload data */
	payload?: Record<string, unknown>;
}

/**
 * Append a change event to the realtime log
 *
 * @param params - Change parameters
 * @param context - CRUD context
 * @param db - Database instance
 * @param app - app instance
 * @param resourceName - Name of the resource (collection or global)
 * @param resourceType - Type of resource ("collection" or "global")
 * @returns The created change record, or null if realtime is not enabled
 */
export async function appendRealtimeChange(
	params: AppendRealtimeChangeParams,
	context: CRUDContext,
	db: any,
	app: Questpie<any> | undefined,
	resourceName: string,
	resourceType: "collection" | "global" = "collection",
): Promise<unknown | null> {
	if (!app?.realtime) return null;

	const normalized = normalizeContext(context);

	return app.realtime.appendChange(
		{
			resourceType,
			resource: resourceName,
			operation: params.operation,
			recordId: params.recordId ?? null,
			locale: normalized.locale ?? null,
			payload: params.payload ?? {},
		},
		{ db },
	);
}

/**
 * Notify realtime subscribers of a change
 *
 * @param change - Change record returned from appendRealtimeChange
 * @param app - app instance
 */
export async function notifyRealtimeChange(
	change: unknown,
	app: Questpie<any> | undefined,
): Promise<void> {
	if (!change || !app?.realtime) return;
	await app.realtime.notify(change as any);
}
