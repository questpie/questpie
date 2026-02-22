/**
 * Shared Hook Utilities
 *
 * Provides hook execution and context creation utilities
 * used across CRUD operations.
 */

import type { HookContext } from "#questpie/server/collection/builder/types.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { normalizeContext } from "./context.js";

/**
 * Execute hooks (single or array)
 *
 * @param hooks - Single hook function, array of hook functions, or undefined
 * @param ctx - Hook context to pass to each hook
 */
export async function executeHooks(
	hooks: any | any[] | undefined,
	ctx: HookContext<any, any, any>,
): Promise<void> {
	if (!hooks) return;

	const hookArray = Array.isArray(hooks) ? hooks : [hooks];
	for (const hook of hookArray) {
		await hook(ctx);
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

	return {
		data: params.data,
		original: params.original,
		app: params.app as any, // app instance
		session: normalized.session,
		locale: normalized.locale,
		accessMode: normalized.accessMode,
		operation: params.operation,
		db: params.db,
	};
}
