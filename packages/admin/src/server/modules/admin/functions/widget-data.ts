/**
 * Widget Data Functions
 *
 * Provides server-side data fetching for widgets that declare a fetchFn.
 * Called by the client when a widget has `hasFetchFn: true`.
 */

import { fn, type Questpie } from "questpie";
import { z } from "zod";
import type { ServerDashboardItem } from "../../../augmentation.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find a widget by ID in the dashboard tree (searches raw server config
 * which still has fetchFn attached).
 */
function findWidgetById(items: ServerDashboardItem[], id: string): any | null {
  for (const item of items) {
    if (item.type === "section") {
      const found = findWidgetById((item as any).items || [], id);
      if (found) return found;
    } else if (item.type === "tabs") {
      for (const tab of (item as any).tabs || []) {
        const found = findWidgetById(tab.items || [], id);
        if (found) return found;
      }
    } else if ((item as any).id === id) {
      return item;
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
 * and executes its fetchFn with server context.
 *
 * @example
 * ```ts
 * // Client usage (via useServerWidgetData hook)
 * const data = await client.rpc.fetchWidgetData({ widgetId: "my-widget" });
 * ```
 */
export const fetchWidgetData = fn({
  type: "query",
  schema: fetchWidgetDataSchema,
  outputSchema: z.unknown(),
  handler: async (ctx) => {
    const cms = ctx.app as Questpie<any>;
    const state = (cms as any).state || {};
    const dashboard = state.dashboard;

    if (!dashboard?.items) {
      throw new Error("No dashboard configured");
    }

    const widget = findWidgetById(dashboard.items, ctx.input.widgetId);
    if (!widget) {
      throw new Error(`Widget "${ctx.input.widgetId}" not found`);
    }
    if (!widget.fetchFn) {
      throw new Error(`Widget "${ctx.input.widgetId}" has no fetchFn`);
    }

    // Evaluate per-widget access (if defined)
    if (widget.access !== undefined) {
      const accessResult =
        typeof widget.access === "function"
          ? await widget.access({
              app: cms,
              db: (ctx as any).db,
              session: (ctx as any).session,
              locale: (ctx as any).locale,
            })
          : widget.access;
      if (accessResult === false) {
        throw new Error("Access denied");
      }
    }

    // Execute fetchFn with server context
    return widget.fetchFn({
      app: cms,
      db: (ctx as any).db,
      session: (ctx as any).session,
      locale: (ctx as any).locale,
    });
  },
});

// ============================================================================
// Export Bundle
// ============================================================================

export const widgetDataFunctions = {
  fetchWidgetData,
} as const;
