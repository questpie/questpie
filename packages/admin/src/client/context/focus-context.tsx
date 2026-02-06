/**
 * Focus Context
 *
 * State machine for managing field focus across the form editor.
 * Supports focusing regular fields and nested block fields.
 * Used for preview click-to-focus functionality.
 */

"use client";

import * as React from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Focus state types:
 * - idle: nothing focused
 * - field: regular field focused (e.g., "title", "slug")
 * - block: block field focused, optionally with specific field within block
 * - relation: relation field focused (opens ResourceSheet for editing)
 */
export type FocusState =
  | { type: "idle" }
  | { type: "field"; fieldPath: string }
  | { type: "block"; blockId: string; fieldPath?: string }
  | { type: "relation"; fieldPath: string; targetCollection?: string };

export type FocusContextValue = {
  /** Current focus state */
  state: FocusState;
  /** Focus a regular field by path */
  focusField: (fieldPath: string) => void;
  /** Focus a block, optionally a specific field within it */
  focusBlock: (blockId: string, fieldPath?: string) => void;
  /** Focus a relation field (opens ResourceSheet) */
  focusRelation: (fieldPath: string, targetCollection?: string) => void;
  /** Clear focus */
  clearFocus: () => void;
  /** Check if a field is focused */
  isFieldFocused: (fieldPath: string) => boolean;
  /** Check if a block is focused */
  isBlockFocused: (blockId: string) => boolean;
};

// ============================================================================
// Context
// ============================================================================

const FocusContext = React.createContext<FocusContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export type FocusProviderProps = {
  children: React.ReactNode;
  /** Callback when focus changes - useful for scrolling to field */
  onFocusChange?: (state: FocusState) => void;
};

export function FocusProvider({ children, onFocusChange }: FocusProviderProps) {
  const [state, setState] = React.useState<FocusState>({ type: "idle" });

  // Use functional setState for stable callbacks (React best practice)
  const focusField = React.useCallback(
    (fieldPath: string) => {
      const newState: FocusState = { type: "field", fieldPath };
      setState(newState);
      onFocusChange?.(newState);
    },
    [onFocusChange],
  );

  const focusBlock = React.useCallback(
    (blockId: string, fieldPath?: string) => {
      const newState: FocusState = { type: "block", blockId, fieldPath };
      setState(newState);
      onFocusChange?.(newState);
    },
    [onFocusChange],
  );

  const focusRelation = React.useCallback(
    (fieldPath: string, targetCollection?: string) => {
      const newState: FocusState = {
        type: "relation",
        fieldPath,
        targetCollection,
      };
      setState(newState);
      onFocusChange?.(newState);
    },
    [onFocusChange],
  );

  const clearFocus = React.useCallback(() => {
    const newState: FocusState = { type: "idle" };
    setState(newState);
    onFocusChange?.(newState);
  }, [onFocusChange]);

  // Derive focused field/block from state for direct comparison
  const focusedFieldPath = state.type === "field" ? state.fieldPath : undefined;
  const focusedBlockId = state.type === "block" ? state.blockId : undefined;

  const value = React.useMemo(
    (): FocusContextValue => ({
      state,
      focusField,
      focusBlock,
      focusRelation,
      clearFocus,
      // Simple equality checks - no callback overhead
      isFieldFocused: (path: string) => focusedFieldPath === path,
      isBlockFocused: (id: string) => focusedBlockId === id,
    }),
    [
      state,
      focusField,
      focusBlock,
      focusRelation,
      clearFocus,
      focusedFieldPath,
      focusedBlockId,
    ],
  );

  return (
    <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Use the focus context
 */
export function useFocus(): FocusContextValue {
  const context = React.useContext(FocusContext);
  if (!context) {
    throw new Error("useFocus must be used within a FocusProvider");
  }
  return context;
}

/**
 * Use focus context if available (doesn't throw)
 */
export function useFocusOptional(): FocusContextValue | null {
  return React.useContext(FocusContext);
}

/**
 * Hook for checking if a specific field is focused
 */
export function useIsFieldFocused(fieldPath: string): boolean {
  const context = React.useContext(FocusContext);
  if (!context) return false;
  return context.isFieldFocused(fieldPath);
}

/**
 * Hook for checking if a specific block is focused
 */
export function useIsBlockFocused(blockId: string): boolean {
  const context = React.useContext(FocusContext);
  if (!context) return false;
  return context.isBlockFocused(blockId);
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse a preview field path into focus state with optional context hints
 * Examples:
 * - "title" → { type: "field", fieldPath: "title" }
 * - "content._values.abc123.title" → { type: "block", blockId: "abc123", fieldPath: "title" }
 * - "author" + { fieldType: "relation" } → { type: "relation", fieldPath: "author" }
 * - "title" + { blockId: "abc123" } → { type: "block", blockId: "abc123", fieldPath: "title" }
 */
export function parsePreviewFieldPath(
  path: string,
  context?: {
    blockId?: string;
    fieldType?: "regular" | "block" | "relation";
    targetCollection?: string;
  },
): FocusState {
  // Relation field from context
  if (context?.fieldType === "relation") {
    return {
      type: "relation",
      fieldPath: path,
      targetCollection: context.targetCollection,
    };
  }

  // Check if it's a block field path (content._values.{id}.{field})
  const blockMatch = path.match(/^content\._values\.([^.]+)(?:\.(.+))?$/);
  if (blockMatch) {
    const [, blockId, fieldPath] = blockMatch;
    return { type: "block", blockId, fieldPath };
  }

  // Legacy block path format (content.blocks.{id}.{field})
  const legacyBlockMatch = path.match(/^content\.blocks\.([^.]+)(?:\.(.+))?$/);
  if (legacyBlockMatch) {
    const [, blockId, fieldPath] = legacyBlockMatch;
    return { type: "block", blockId, fieldPath };
  }

  // Block field from context hint
  if (context?.blockId) {
    // Extract relative field path if present
    const relativeField = extractRelativeField(path, context.blockId);
    return {
      type: "block",
      blockId: context.blockId,
      fieldPath: relativeField,
    };
  }

  // Regular field
  return { type: "field", fieldPath: path };
}

/**
 * Extract relative field path from a full path given a block ID
 * Examples:
 * - extractRelativeField("content._values.abc123.title", "abc123") → "title"
 * - extractRelativeField("title", "abc123") → "title"
 */
function extractRelativeField(path: string, blockId: string): string {
  const prefix = `content._values.${blockId}.`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }
  return path;
}

/**
 * Scroll a field into view and focus it.
 * Finds the field wrapper by data-field-path within the preview form scope.
 */
export function scrollFieldIntoView(fieldPath: string): void {
  // First try to find within the preview form scope (to avoid matching fields in other forms)
  const formScope = document.querySelector<HTMLElement>(
    "[data-preview-form-scope]",
  );
  const searchRoot = formScope ?? document;

  const wrapper = searchRoot.querySelector<HTMLElement>(
    `[data-field-path="${fieldPath}"]`,
  );
  if (!wrapper) return;

  // Find first focusable element inside the wrapper
  const focusable = wrapper.querySelector<HTMLElement>(
    'input:not([type="hidden"]), textarea, button, select, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
  );

  const target = focusable ?? wrapper;
  target.scrollIntoView({ behavior: "smooth", block: "center" });

  if (focusable) {
    // Use requestAnimationFrame to focus after scroll starts
    requestAnimationFrame(() => {
      // Pull focus from iframe back to parent window
      window.focus();
      focusable.focus();
    });
  }
}
