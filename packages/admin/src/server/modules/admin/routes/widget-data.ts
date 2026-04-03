/**
 * Widget Data Functions
 *
 * Provides server-side data fetching for widgets that declare a loader.
 * Called by the client when a widget has `hasLoader: true`.
 */

import { ApiError, route, tryGetContext } from "questpie";
import { z } from "zod";

import type { ServerDashboardItem } from "../../../augmentation.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a widget by ID in the dashboard tree (searches raw server config
 * which still has loader attached).
 */
function findWidgetById(items: ServerDashboardItem[], id: string): Record<string, any> | null {
	for (const item of items) {
		const rec = item as unknown as Record<string, any>;
		if (item.type === "section") {
			const found = findWidgetById((rec.items as ServerDashboardItem[]) || [], id);
			if (found) return found;
		} else if (item.type === "tabs") {
			for (const tab of (rec.tabs as Array<{ items: ServerDashboardItem[] }>) || []) {
				const found = findWidgetById(tab.items || [], id);
				if (found) return found;
			}
		} else if (rec.id === id) {
			return rec;
		}
	}
	return null;
}

// ============================================================================
// Schema
// ============================================================================

const fetchWidgetDataSchema = z.object({
	widgetId: z.string(),
});

// ============================================================================
// Function
// ============================================================================

/**
 * Fetch data for a server-side widget by its ID.
 *
 * Looks up the widget in the dashboard config, evaluates its access rule,
 * and executes its loader with server context.
 *
 * @example
 * ```ts
 * // Client usage (via useServerWidgetData hook)
 * const data = await client.routes.fetchWidgetData({ widgetId: "my-widget" });
 * ```
 */
export const fetchWidgetData = route()
	.post()
	.schema(fetchWidgetDataSchema)
	.outputSchema(z.unknown())
	.handler(async (ctx) => {
		// Access dashboard config from the app's internal state
		const stored = tryGetContext();
		const appState = ((stored?.app as Record<string, any>)?.state || {}) as Record<string, any>;
		const dashboard = appState.config?.admin?.dashboard ?? appState.dashboard;

		if (!dashboard?.items) {
			throw ApiError.internal("No dashboard configured");
		}

		const widget = findWidgetById(dashboard.items, ctx.input.widgetId);
		if (!widget) {
			throw ApiError.notFound("Widget", ctx.input.widgetId);
		}
		if (!widget.loader) {
			throw ApiError.badRequest(`Widget "${ctx.input.widgetId}" has no loader`);
		}

		// ctx (FunctionHandlerArgs) extends AppContext which is the same
		// base that WidgetFetchContext extends — pass it directly.
		const widgetCtx =
			ctx as unknown as import("../../../augmentation.js").WidgetFetchContext;

		// Evaluate per-widget access (if defined)
		if (widget.access !== undefined) {
			const accessResult =
				typeof widget.access === "function"
					? await widget.access(widgetCtx)
					: widget.access;
			if (accessResult === false) {
				throw ApiError.forbidden({
					operation: "read",
					resource: "widget",
					reason: "Access denied",
				});
			}
		}

		// Execute loader with server context
		return widget.loader(widgetCtx);
	});

// ============================================================================
// Export Bundle
// ============================================================================

export const widgetDataFunctions = {
	fetchWidgetData,
} as const;
