/**
 * Internal admin builder for admin collections.
 *
 * This file creates a minimal QuestpieBuilder for admin collections
 * without starterModule to avoid type explosion.
 */

import { defaultFields, QuestpieBuilder } from "questpie";

/**
 * Internal questpie builder for admin collections.
 * Use this to define admin collections with the field builder pattern.
 */
export const adminBuilder =
  QuestpieBuilder.empty("admin:builder").fields(defaultFields);
