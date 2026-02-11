/**
 * City Portal Admin Builder
 *
 * Centralized admin builder with type-safe access to backend CMS collections.
 */

import { adminModule, qa } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

export const builder = qa<AppCMS>().use(adminModule);
