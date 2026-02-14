/**
 * Block System Types
 *
 * Core types for the visual page building system.
 * Server stores blocks as JSONB with $i18n markers - these types
 * define the client-side structure and rendering.
 */

import type * as React from "react";

/**
 * Block node in the tree structure.
 * Represents a single block instance with its position and children.
 */
export type BlockNode = {
  /** Unique block instance ID (UUID) */
  id: string;
  /** Block type name (e.g., "hero", "columns", "text") */
  type: string;
  /** Child blocks (for layout blocks that accept children) */
  children: BlockNode[];
};

/**
 * Block content structure stored in JSONB.
 * This is the shape of data stored in the database and passed to BlockRenderer.
 *
 * After server-side prefetch (afterRead hook), `_data` is populated with:
 * - Auto-expanded relation/upload fields
 * - Manual prefetch data from `.blocks()` registration
 */
export type BlockContent = {
  /** Block tree with hierarchy and order */
  _tree: BlockNode[];
  /** Block values indexed by block ID */
  _values: Record<string, Record<string, unknown>>;
  /** Prefetched data from server (populated by afterRead hook) */
  _data?: Record<string, Record<string, unknown>>;
};

/**
 * Block category for organization in the block picker.
 * Categories help users find blocks quickly when adding new content.
 */
export type BlockCategory =
  | "layout" // Columns, Grid, Container, Section
  | "content" // Text, Heading, List, Quote
  | "media" // Image, Video, Gallery, Audio
  | "sections" // Hero, Features, Testimonials, CTA
  | "interactive" // Form, Accordion, Tabs, Carousel
  | (string & {}); // Custom categories

/**
 * Props passed to block renderer components.
 * Each block receives these props when being rendered.
 *
 * @template TValues - Block field values type (inferred from `.fields()`)
 * @template TData - Prefetch data type (inferred from `.prefetch()`)
 */
export type BlockRendererProps<
  TValues = Record<string, unknown>,
  TData = Record<string, unknown>,
> = {
  /** Block instance ID */
  id: string;
  /** Block field values (merged with i18n for current locale) */
  values: TValues;
  /** Data from server prefetch (populated via afterRead hook into _data[blockId]) */
  data?: TData;
  /** Rendered child blocks (for layout blocks) */
  children?: React.ReactNode;
  /** Whether this block is currently selected in the editor */
  isSelected?: boolean;
  /** Whether rendering in preview mode */
  isPreview?: boolean;
};

/**
 * Empty block content for initialization.
 */
export const EMPTY_BLOCK_CONTENT: BlockContent = {
  _tree: [],
  _values: {},
};

/**
 * Check if a value is a valid BlockContent structure.
 */
export function isBlockContent(value: unknown): value is BlockContent {
  if (value == null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj._tree) &&
    typeof obj._values === "object" &&
    obj._values !== null
  );
}

