/**
 * Register — Module Augmentation for Auto-Typed App Context
 *
 * Register your CMS app to get automatic typing on `ctx.app` in hooks.
 *
 * @example
 * ```ts
 * // questpie.gen.ts
 * declare module "questpie" {
 *   interface Register {
 *     app: typeof import("./cms").baseCms.$inferCms;
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * // cms.ts - Structure to avoid circular dependencies
 *
 * // 1. Base CMS without blocks (used for Register)
 * export const baseCms = qb
 *   .collections({ posts, users })
 *   .globals({ siteSettings });
 *
 * // 2. Full CMS with blocks (used at runtime)
 * export const cms = baseCms.blocks(blocks).build({ ... });
 * ```
 *
 * For scoped typing in modules, use `getApp<T>()`:
 *
 * @example
 * ```ts
 * import type { AppCMS } from "./cms";
 * import { getApp } from "questpie";
 *
 * const app = getApp<AppCMS>(ctx.app);
 * ```
 */

import type { Questpie } from "./cms.js";
import type { QuestpieConfig } from "./types.js";

// ============================================================================
// Register Interface
// ============================================================================

/**
 * Module augmentation target.
 * Register your app type for automatic typing on `ctx.app`.
 *
 * @example
 * ```ts
 * declare module "questpie" {
 *   interface Register {
 *     app: typeof import("./cms").baseCms.$inferCms;
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by users
export interface Register {}

// ============================================================================
// App Type Helpers
// ============================================================================

/**
 * Base CMS app type (untyped fallback).
 */
export type AnyApp = Questpie<QuestpieConfig>;

/**
 * The registered CMS app type.
 *
 * - If `Register.app` exists → use it
 * - Otherwise → fallback to `AnyApp`
 */
export type RegisteredApp = Register extends { app: infer A } ? A : AnyApp;
