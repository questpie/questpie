/**
 * App Type Helpers
 *
 * For typed access to app instance in hooks, actions, and prefetch functions,
 * use `typedApp<App>(ctx.app)`:
 *
 * @example
 * ```ts
 * import type { App } from "./questpie/server/app";
 * import { typedApp } from "questpie";
 *
 * const app = typedApp<App>(ctx.app);
 * ```
 */

import type { Questpie } from "./questpie.js";
import type { QuestpieConfig } from "./types.js";

// ============================================================================
// App Type Helpers
// ============================================================================

/**
 * Base app type (untyped fallback).
 */
export type AnyApp = Questpie<QuestpieConfig>;
