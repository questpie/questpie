/**
 * Internal core builder for default collections.
 *
 * This file creates a QuestpieBuilder with default fields for use in
 * auth.ts and assets.ts without causing circular dependencies with
 * the main exports/index.ts.
 */

import { QuestpieBuilder } from "#questpie/server/config/builder.js";
import { defaultFields } from "#questpie/server/fields/builtin/defaults.js";

/**
 * Internal questpie builder with default fields for core collections.
 * Use this to define auth/assets collections with the field builder pattern.
 */
export const coreBuilder =
  QuestpieBuilder.empty("questpie-core").fields(defaultFields);
