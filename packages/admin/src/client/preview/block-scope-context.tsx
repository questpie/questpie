/**
 * Block Scope Context
 *
 * Provides block context for field path resolution in preview mode.
 * Allows PreviewField components to auto-resolve full scoped paths
 * like "content._values.{blockId}.title" from simple field names.
 */

"use client";

import * as React from "react";

import {
	BLOCKS_VALUES_SEGMENT,
	blockValuePath,
	defaultBlocksPath,
} from "./block-paths.js";

// ============================================================================
// Types
// ============================================================================

export type BlockScopeContextValue = {
	/** Current block ID */
	blockId: string;
	/** Form path of the surrounding blocks field (e.g., "content"). */
	blocksPath: string;
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
	/**
	 * Form path of the surrounding blocks field, e.g. `"content"` or `"page.body"`.
	 * Preferred over `basePath`. When omitted, the closest parent provider's
	 * `blocksPath` is used; otherwise it falls back to `"content"`.
	 */
	blocksPath?: string;
	/**
	 * @deprecated Use `blocksPath` instead. The historical `basePath` form
	 * (e.g. `"content._values"`) is still accepted for backwards compatibility:
	 * a trailing `._values` segment is stripped to recover the blocks-field path.
	 */
	basePath?: string;
	children: React.ReactNode;
};

/**
 * Provides block scope context for field path resolution.
 *
 * Block content stores values flat by block id, so nested blocks must NOT
 * concatenate their parent's id into the value path. This provider always
 * resolves to `${blocksPath}._values.${blockId}.${fieldName}` regardless of
 * the surrounding block hierarchy — only the blocks-field path is inherited
 * from a parent scope.
 *
 * @example
 * ```tsx
 * <BlockScopeProvider blockId="abc123" blocksPath="content">
 *   <PreviewField field="title">
 *     {/* Auto-resolves to: content._values.abc123.title *\/}
 *   </PreviewField>
 * </BlockScopeProvider>
 * ```
 */
export function BlockScopeProvider({
	blockId,
	blocksPath: blocksPathProp,
	basePath,
	children,
}: BlockScopeProviderProps) {
	const parentScope = React.useContext(BlockScopeContext);

	const resolvedBlocksPath = React.useMemo(() => {
		if (blocksPathProp) return blocksPathProp;
		// Legacy `basePath` ended in "._values"; strip it to recover the field path.
		if (basePath) {
			const suffix = `.${BLOCKS_VALUES_SEGMENT}`;
			return basePath.endsWith(suffix)
				? basePath.slice(0, -suffix.length)
				: basePath;
		}
		if (parentScope) return parentScope.blocksPath;
		return defaultBlocksPath();
	}, [blocksPathProp, basePath, parentScope]);

	const fieldPrefix = React.useMemo(
		() => blockValuePath(resolvedBlocksPath, blockId),
		[resolvedBlocksPath, blockId],
	);

	const value = React.useMemo<BlockScopeContextValue>(
		() => ({
			blockId,
			blocksPath: resolvedBlocksPath,
			fieldPrefix,
		}),
		[blockId, resolvedBlocksPath, fieldPrefix],
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
