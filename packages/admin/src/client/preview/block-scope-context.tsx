/**
 * Block Scope Context
 *
 * Provides block context for field path resolution in preview mode.
 * Allows PreviewField components to auto-resolve full scoped paths
 * like "content._values.{blockId}.title" from simple field names.
 */

"use client";

import * as React from "react";

// ============================================================================
// Types
// ============================================================================

export type BlockScopeContextValue = {
  /** Current block ID */
  blockId: string;
  /** Field path prefix (e.g., "content._values.abc123") */
  fieldPrefix: string;
};

// ============================================================================
// Context
// ============================================================================

const BlockScopeContext = React.createContext<BlockScopeContextValue | null>(
  null,
);

// ============================================================================
// Provider
// ============================================================================

export type BlockScopeProviderProps = {
  /** Block ID for this scope */
  blockId: string;
  /** Base path for blocks field (e.g., "content._values") */
  basePath?: string;
  children: React.ReactNode;
};

/**
 * Provides block scope context for field path resolution.
 *
 * Automatically wraps each block in BlockRenderer to enable
 * PreviewField components to resolve full scoped paths.
 *
 * @example
 * ```tsx
 * <BlockScopeProvider blockId="abc123" basePath="content._values">
 *   <PreviewField field="title">
 *     {/* Auto-resolves to: content._values.abc123.title *\/}
 *   </PreviewField>
 * </BlockScopeProvider>
 * ```
 */
export function BlockScopeProvider({
  blockId,
  basePath = "content._values",
  children,
}: BlockScopeProviderProps) {
  const parentScope = React.useContext(BlockScopeContext);

  // Build field prefix based on parent scope
  const fieldPrefix = React.useMemo(() => {
    if (parentScope) {
      // Nested block: append to parent prefix
      return `${parentScope.fieldPrefix}.${blockId}`;
    }
    // Top-level block: use basePath
    return `${basePath}.${blockId}`;
  }, [parentScope, basePath, blockId]);

  const value = React.useMemo<BlockScopeContextValue>(
    () => ({
      blockId,
      fieldPrefix,
    }),
    [blockId, fieldPrefix],
  );

  return (
    <BlockScopeContext.Provider value={value}>
      {children}
    </BlockScopeContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get current block scope context.
 *
 * Returns null if not inside a BlockScopeProvider.
 *
 * @example
 * ```tsx
 * const scope = useBlockScope();
 * if (scope) {
 *   console.log(scope.blockId); // "abc123"
 *   console.log(scope.fieldPrefix); // "content._values.abc123"
 * }
 * ```
 */
export function useBlockScope(): BlockScopeContextValue | null {
  return React.useContext(BlockScopeContext);
}

/**
 * Resolve a field name to its full scoped path.
 *
 * If inside a BlockScopeProvider, prepends the field prefix.
 * Otherwise, returns the field name as-is.
 *
 * @example
 * ```tsx
 * // Inside BlockScopeProvider with blockId="abc123"
 * const fullPath = useResolveFieldPath("title");
 * // Returns: "content._values.abc123.title"
 *
 * // Outside BlockScopeProvider
 * const fullPath = useResolveFieldPath("title");
 * // Returns: "title"
 * ```
 */
export function useResolveFieldPath(fieldName: string): string {
  const scope = useBlockScope();

  return React.useMemo(() => {
    if (!scope) {
      return fieldName;
    }
    return `${scope.fieldPrefix}.${fieldName}`;
  }, [scope, fieldName]);
}
