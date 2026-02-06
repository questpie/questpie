/**
 * Block Builder Types
 *
 * Type definitions for the block definition builder.
 */

import type * as React from "react";
import type { ComponentReference } from "#questpie/admin/server";
import type { BlockCategory, BlockRendererProps } from "../../blocks/types.js";
import type { I18nText } from "../../i18n/types.js";
import type { FieldDefinition } from "../field/field.js";

/**
 * Block builder state - accumulated during the builder chain.
 */
export type BlockBuilderState = {
  /** Block type name (e.g., "hero", "columns") */
  name: string;
  /** Display label for the block */
  label?: I18nText;
  /** Description shown in block picker */
  description?: I18nText;
  /** Icon reference (server-defined) or legacy icon name */
  icon?: ComponentReference | string;
  /** Category for grouping in block picker */
  category?: BlockCategory;
  /** Field definitions for block values */
  fields?: Record<string, FieldDefinition>;
  /** Whether this block can contain child blocks */
  allowChildren?: boolean;
  /** Maximum number of child blocks */
  maxChildren?: number;
  /** Allowed child block types (if not set, all blocks are allowed) */
  allowedChildTypes?: string[];
  /** React component for rendering the block (optional for server-only registration) */
  renderer?: React.ComponentType<BlockRendererProps<any>>;
  /**
   * Admin app reference for type-safe field registry access.
   * This is a phantom type - only exists at compile time.
   */
  "~adminApp"?: unknown;
};

/**
 * Built block definition - result of builder.build()
 */
export type BlockDefinition<
  TState extends BlockBuilderState = BlockBuilderState,
> = {
  /** Block type name */
  name: TState["name"];
  /** Display label */
  label?: I18nText;
  /** Description */
  description?: I18nText;
  /** Icon reference (server-defined) or legacy icon name */
  icon?: ComponentReference | string;
  /** Category */
  category?: BlockCategory;
  /** Field definitions */
  fields?: Record<string, FieldDefinition>;
  /** Can contain children */
  allowChildren?: boolean;
  /** Max children */
  maxChildren?: number;
  /** Allowed child types */
  allowedChildTypes?: string[];
  /** Renderer component (optional for server-only registration) */
  renderer?: React.ComponentType<BlockRendererProps<any>>;
};

/**
 * Infer values type from block fields.
 */
export type InferBlockValues<TFields extends Record<string, FieldDefinition>> =
  {
    [K in keyof TFields]: TFields[K]["~options"] extends { localized: true }
      ? string // Localized values are merged from i18n
      : unknown;
  };
