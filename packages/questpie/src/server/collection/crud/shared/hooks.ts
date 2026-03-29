/**
 * Shared Hook Utilities
 *
 * Provides hook execution and context creation utilities
 * used across CRUD operations.
 */

import type { HookContext } from "#questpie/server/collection/builder/types.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import { normalizeContext } from "./context.js";
import { onAfterCommit } from "./transaction.js";

/**
 * Execute hooks (single or array)
 *
 * @param hooks - Single hook function, array of hook functions, or undefined
 * @param ctx - Hook context to pass to each hook
 * @param options - Optional configuration
 * @param options.phase - "before" propagates errors (abort), "after" catches and logs (non-fatal)
 */
export async function executeHooks(
	hooks: any | any[] | undefined,
	ctx: HookContext<any, any, any>,
	options?: { phase?: "before" | "after" },
): Promise<void> {
	if (!hooks) return;

	const hookArray = Array.isArray(hooks) ? hooks : [hooks];
	const isAfter = options?.phase === "after";

	for (const hook of hookArray) {
		if (isAfter) {
			try {
				await hook(ctx);
			} catch (err) {
				console.error("[QUESTPIE] after* hook error:", err);
			}
		} else {
			await hook(ctx);
		}
	}
}

/**
 * Parameters for creating a hook context
 */
export interface CreateHookContextParams {
	/** Data being operated on */
	data: any;
	/** Original data (for update operations) */
	original?: any;
	/** Operation type */
	operation: "create" | "update" | "delete" | "read";
	/** CRUD context */
	context: CRUDContext;
	/** Database instance */
	db: any;
	/** app instance */
	app?: Questpie<any>;
	/** Bulk metadata (for batch operations) */
	bulk?: {
		isBatch: true;
		recordIds: (string | number)[];
		records: any[];
		count: number;
	};
}

/**
 * Create hook context with full app access
 *
 * @param params - Parameters for creating the hook context
 * @returns HookContext object
 */
export function createHookContext(
	params: CreateHookContextParams,
): HookContext<any, any, any> {
	const normalized = normalizeContext(params.context);
	const services = extractAppServices(params.app, {
		db: params.db,
		session: normalized.session,
	});

	const ctx: HookContext<any, any, any> = {
		...services,
		data: params.data,
		original: params.original,
		locale: normalized.locale,
		accessMode: normalized.accessMode,
		operation: params.operation,
		onAfterCommit,
	} as HookContext<any, any, any>;

	// Attach bulk metadata if present
	if (params.bulk) {
		ctx.isBatch = params.bulk.isBatch;
		ctx.recordIds = params.bulk.recordIds;
		ctx.records = params.bulk.records;
		ctx.count = params.bulk.count;
	}

	return ctx;
}
