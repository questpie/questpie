/**
 * Block Builder
 *
 * Fluent API for defining block types for the visual page builder.
 * Blocks are UI-only - server stores them as JSONB with $i18n markers.
 *
 * @example
 * ```ts
 * const heroBlock = qa<AppCMS>()
 *   .use(adminModule)
 *   .block("hero")
 *   .label({ en: "Hero Section", sk: "Hero sekcia" })
 *   .icon("Image")
 *   .category("sections")
 *   .fields(({ r }) => ({
 *     title: r.text({ label: "Title", localized: true, required: true }),
 *     subtitle: r.textarea({ label: "Subtitle", localized: true }),
 *     alignment: r.select({
 *       label: "Alignment",
 *       options: [
 *         { value: "left", label: "Left" },
 *         { value: "center", label: "Center" },
 *         { value: "right", label: "Right" },
 *       ],
 *       defaultValue: "center"
 *     }),
 *   }))
 *   .renderer(HeroRenderer)
 *   .build();
 * ```
 */

import type { SetProperty } from "questpie/shared";
import type * as React from "react";
import type { ComponentReference } from "#questpie/admin/server";
import type { BlockCategory, BlockRendererProps } from "../../blocks/types.js";
import type { I18nText } from "../../i18n/types.js";
import type { AdminBuilder } from "../admin-builder.js";
import type { ExtractBlocks, ExtractFields } from "../admin-types.js";
import type { FieldDefinition } from "../field/field.js";
import {
  createFieldRegistryProxy,
  type FieldRegistryProxy,
} from "../proxies.js";
import type { BlockBuilderState, BlockDefinition } from "./types.js";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Helper to get fields from AdminApp - simplifies conditional type chains
 */
type AdminAppFields<TAdminApp> =
  ExtractFields<TAdminApp> extends Record<string, any>
    ? ExtractFields<TAdminApp>
    : {};

/**
 * Helper to get blocks from AdminApp
 */
type AdminAppBlocks<TAdminApp> =
  ExtractBlocks<TAdminApp> extends Record<string, any>
    ? ExtractBlocks<TAdminApp>
    : {};

/**
 * Legacy type alias for backwards compatibility.
 * @deprecated Use FieldRegistryProxy from "../proxies.js" instead
 */
export type LegacyFieldRegistryProxy = ReturnType<
  typeof createFieldRegistryProxy
>;

/**
 * Block builder class with fluent API.
 */
export class BlockBuilder<TState extends BlockBuilderState> {
  constructor(public readonly state: TState) {}

  /**
   * Connect to admin app for type-safe field registry access.
   * This enables autocomplete for custom fields defined in the admin app.
   *
   * @example
   * ```ts
   * const heroBlock = block("hero")
   *   .use(admin)  // Connect to admin for field registry
   *   .fields(({ r }) => ({
   *     // Now r has access to admin's custom fields!
   *     content: r.richText({ label: "Content" }),
   *   }))
   * ```
   */
  use<TAdminApp extends AdminBuilder<any>>(
    adminApp: TAdminApp,
  ): BlockBuilder<SetProperty<TState, "~adminApp", TAdminApp>> {
    return new BlockBuilder({
      ...this.state,
      "~adminApp": adminApp,
    } as any);
  }

  /**
   * Set the display label for the block.
   * Shown in the block picker and block tree.
   */
  label(label: I18nText): BlockBuilder<TState & { label: I18nText }> {
    return new BlockBuilder({ ...this.state, label });
  }

  /**
   * Set the description for the block.
   * Shown in the block picker to help users understand the block's purpose.
   */
  description(
    description: I18nText,
  ): BlockBuilder<TState & { description: I18nText }> {
    return new BlockBuilder({ ...this.state, description });
  }

  /**
   * Set the icon for the block.
   * Prefer ComponentReference from server config; string icons are legacy.
   */
  icon(
    icon: ComponentReference | string,
  ): BlockBuilder<TState & { icon: ComponentReference | string }> {
    return new BlockBuilder({ ...this.state, icon });
  }

  /**
   * Set the category for grouping in the block picker.
   */
  category(
    category: BlockCategory,
  ): BlockBuilder<TState & { category: BlockCategory }> {
    return new BlockBuilder({ ...this.state, category });
  }

  /**
   * Define fields for this block.
   * Fields marked with `localized: true` will be stored with $i18n markers.
   *
   * Requires an admin builder registry via `.use(admin)` or `builder.block()`.
   * The field registry is inferred from the admin builder chain.
   *
   * @example
   * ```ts
   * .fields(({ r }) => ({
   *   title: r.text({ label: "Title", localized: true }),
   *   columns: r.select({ label: "Columns", options: [...] }),
   * }))
   * ```
   */
  fields<TFields extends Record<string, FieldDefinition>>(
    callback: (ctx: {
      r: FieldRegistryProxy<
        AdminAppFields<TState["~adminApp"]>,
        AdminAppBlocks<TState["~adminApp"]>
      >;
    }) => TFields,
  ): BlockBuilder<TState & { fields: TFields }> {
    // Extract field registry from admin app if available
    const adminApp = this.state["~adminApp"] as AdminBuilder<any> | undefined;
    if (!adminApp) {
      throw new Error(
        "BlockBuilder.fields requires an admin builder registry. Use qa<AppCMS>().use(adminModule).block(...), or qa.block(...).use(builder).",
      );
    }
    const adminFields =
      adminApp && typeof adminApp === "object" && "state" in adminApp
        ? (adminApp as any).state?.fields || {}
        : {};

    const r = createFieldRegistryProxy(adminFields);
    const fields = callback({ r } as any);
    return new BlockBuilder({ ...this.state, fields });
  }

  /**
   * Allow this block to contain child blocks.
   * Used for layout blocks like columns, grids, containers.
   *
   * @param allow - Whether children are allowed
   * @param options - Optional constraints
   * @param options.max - Maximum number of children
   * @param options.allowedTypes - Allowed child block types (if not set, all are allowed)
   *
   * @example
   * ```ts
   * // Allow up to 4 children of any type
   * .allowChildren(true, { max: 4 })
   *
   * // Allow only specific child types
   * .allowChildren(true, { allowedTypes: ["text", "image"] })
   * ```
   */
  allowChildren(
    allow: boolean,
    options?: { max?: number; allowedTypes?: string[] },
  ): BlockBuilder<
    TState & {
      allowChildren: boolean;
      maxChildren?: number;
      allowedChildTypes?: string[];
    }
  > {
    return new BlockBuilder({
      ...this.state,
      allowChildren: allow,
      maxChildren: options?.max,
      allowedChildTypes: options?.allowedTypes,
    });
  }

  /**
   * Set the renderer component for this block.
   * The renderer receives BlockRendererProps with values and optional children.
   *
   * @example
   * ```ts
   * function HeroRenderer({ id, values, isSelected }: BlockRendererProps) {
   *   return (
   *     <section data-block-id={id}>
   *       <h1>{values.title}</h1>
   *       <p>{values.subtitle}</p>
   *     </section>
   *   );
   * }
   *
   * .renderer(HeroRenderer)
   * ```
   */
  renderer<TValues = Record<string, unknown>>(
    component: React.ComponentType<BlockRendererProps<TValues>>,
  ): BlockBuilder<
    TState & { renderer: React.ComponentType<BlockRendererProps<TValues>> }
  > {
    return new BlockBuilder({
      ...this.state,
      renderer: component as React.ComponentType<BlockRendererProps<any>>,
    });
  }

  /**
   * Build the block definition.
   * Validates that required properties are set.
   *
   * @throws Error if name is not set
   */
  build(): BlockDefinition<TState> {
    if (!this.state.name) {
      throw new Error("Block name is required");
    }
    return this.state as unknown as BlockDefinition<TState>;
  }
}

/**
 * Create a new block builder.
 *
 * @param name - Unique block type name (e.g., "hero", "columns", "text")
 *
 * @example
 * ```ts
 * const textBlock = block("text")
 *   .use(admin)
 *   .label({ en: "Text" })
 *   .category("content")
 *   .fields(({ r }) => ({
 *     content: r.richText({ label: "Content", localized: true }),
 *   }))
 *   .renderer(TextRenderer)
 *   .build();
 * ```
 */
export function block<TName extends string>(
  name: TName,
): BlockBuilder<{ name: TName }> {
  return new BlockBuilder({ name });
}
