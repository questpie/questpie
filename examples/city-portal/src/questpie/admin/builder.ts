/**
 * City Portal Admin Builder
 *
 * Centralized admin builder with type-safe access to backend app collections.
 */

import { adminModule, qa } from "@questpie/admin/client";
import type { App } from "@/questpie/server/app";

export const builder = qa<App>().use(adminModule);
