/**
 * Barbershop Admin Builder
 *
 * Centralized admin builder with type-safe access to backend app collections.
 *
 * Usage:
 * ```ts
 * import { builder } from "@/questpie/admin/builder";
 *
 * const barbers = builder.collection("barbers")
 *   .fields(({ r }) => ({
 *     name: r.text(),  // ✅ autocomplete from module fields
 *   }))
 * ```
 */

import { adminModule, qa } from "@questpie/admin/client";
import type { App } from "@/questpie/server/app";

export const admin = qa<App>().use(adminModule);
