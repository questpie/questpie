/**
 * RichText Editor Presets
 *
 * Pre-configured feature sets for common use cases.
 */

import type { RichTextFeatures } from "./types";

/**
 * Preset type
 */
export type RichTextPreset = "minimal" | "simple" | "standard" | "advanced";

/**
 * MINIMAL - Only bubble menu with basic formatting
 *
 * Use case: Inline editing, comments, simple text fields
 * Features: Bold, Italic, Underline, Link
 * UI: No toolbar, only bubble menu on selection
 */
export const PRESET_MINIMAL: Required<RichTextFeatures> = {
  toolbar: false,
  bubbleMenu: true,
  slashCommands: false,
  history: true,
  heading: false,
  bold: true,
  italic: true,
  underline: true,
  strike: false,
  code: false,
  codeBlock: false,
  blockquote: false,
  bulletList: false,
  orderedList: false,
  horizontalRule: false,
  align: false,
  link: true,
  image: false,
  table: false,
  tableControls: false,
  characterCount: false,
};

/**
 * SIMPLE - Basic rich text without media
 *
 * Use case: Blog posts, articles, descriptions
 * Features: Headings, formatting, lists, quotes, links
 * UI: Compact toolbar with essential controls
 */
export const PRESET_SIMPLE: Required<RichTextFeatures> = {
  toolbar: true,
  bubbleMenu: true,
  slashCommands: true,
  history: true,
  heading: true,
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  code: true,
  codeBlock: false,
  blockquote: true,
  bulletList: true,
  orderedList: true,
  horizontalRule: true,
  align: false,
  link: true,
  image: false,
  table: false,
  tableControls: false,
  characterCount: true,
};

/**
 * STANDARD - Full-featured editor (default)
 *
 * Use case: General-purpose content editing
 * Features: All formatting, alignment, images, basic tables
 * UI: Full toolbar with all standard controls
 */
export const PRESET_STANDARD: Required<RichTextFeatures> = {
  toolbar: true,
  bubbleMenu: true,
  slashCommands: true,
  history: true,
  heading: true,
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  code: true,
  codeBlock: true,
  blockquote: true,
  bulletList: true,
  orderedList: true,
  horizontalRule: true,
  align: true,
  link: true,
  image: true,
  table: true,
  tableControls: true,
  characterCount: true,
};

/**
 * ADVANCED - Everything including advanced features
 *
 * Use case: Documentation, technical writing, complex layouts
 * Features: Everything in standard + advanced table controls
 * UI: Full toolbar with all advanced controls
 */
export const PRESET_ADVANCED: Required<RichTextFeatures> = {
  ...PRESET_STANDARD,
  // Advanced preset currently same as standard
  // Reserved for future advanced features like:
  // - Custom blocks
  // - Collaboration
  // - Advanced table features
  // - Math equations
  // - Diagrams
};

/**
 * Get preset configuration by name
 */
export function getPreset(preset: RichTextPreset): Required<RichTextFeatures> {
  switch (preset) {
    case "minimal":
      return PRESET_MINIMAL;
    case "simple":
      return PRESET_SIMPLE;
    case "standard":
      return PRESET_STANDARD;
    case "advanced":
      return PRESET_ADVANCED;
    default:
      return PRESET_STANDARD;
  }
}

/**
 * Merge preset with custom feature overrides
 */
export function mergePresetFeatures(
  preset: RichTextPreset,
  overrides?: Partial<RichTextFeatures>,
): Required<RichTextFeatures> {
  const basePreset = getPreset(preset);
  return {
    ...basePreset,
    ...overrides,
  };
}
