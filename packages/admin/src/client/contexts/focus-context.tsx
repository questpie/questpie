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
 * - block-insert: insert a block at a position using the existing block editor
 * - relation: relation field focused (opens ResourceSheet for editing)
 */
export type BlockInsertPosition = {
	parentId: string | null;
	index: number;
};

export type FocusState =
	| { type: "idle" }
	| { type: "field"; fieldPath: string }
	| { type: "block"; blockId: string; fieldPath?: string }
	| {
			type: "block-insert";
			position: BlockInsertPosition;
			referenceBlockId?: string;
	  }
	| { type: "relation"; fieldPath: string; targetCollection?: string };

export type FocusContextValue = {
	/** Current focus state */
	state: FocusState;
	/** Focus a regular field by path */
	focusField: (fieldPath: string) => void;
	/** Focus a block, optionally a specific field within it */
	focusBlock: (blockId: string, fieldPath?: string) => void;
	/** Open block insertion at a specific position */
	requestBlockInsert: (
		position: BlockInsertPosition,
		referenceBlockId?: string,
	) => void;
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

function areBlockInsertPositionsEqual(
	left: BlockInsertPosition,
	right: BlockInsertPosition,
): boolean {
	return left.parentId === right.parentId && left.index === right.index;
}

function areFocusStatesEqual(left: FocusState, right: FocusState): boolean {
	if (left.type !== right.type) return false;

	switch (left.type) {
		case "idle":
			return true;
		case "field":
			return right.type === "field" && left.fieldPath === right.fieldPath;
		case "block":
			return (
				right.type === "block" &&
				left.blockId === right.blockId &&
				left.fieldPath === right.fieldPath
			);
		case "block-insert":
			return (
				right.type === "block-insert" &&
				areBlockInsertPositionsEqual(left.position, right.position) &&
				left.referenceBlockId === right.referenceBlockId
			);
		case "relation":
			return (
				right.type === "relation" &&
				left.fieldPath === right.fieldPath &&
				left.targetCollection === right.targetCollection
			);
	}
}

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
	const stateRef = React.useRef<FocusState>(state);

	const setFocusState = React.useCallback(
		(nextState: FocusState) => {
			if (areFocusStatesEqual(stateRef.current, nextState)) {
				return;
			}

			stateRef.current = nextState;
			setState(nextState);
			onFocusChange?.(nextState);
		},
		[onFocusChange],
	);

	const focusField = React.useCallback(
		(fieldPath: string) => {
			setFocusState({ type: "field", fieldPath });
		},
		[setFocusState],
	);

	const focusBlock = React.useCallback(
		(blockId: string, fieldPath?: string) => {
			setFocusState({ type: "block", blockId, fieldPath });
		},
		[setFocusState],
	);

	const focusRelation = React.useCallback(
		(fieldPath: string, targetCollection?: string) => {
			setFocusState({
				type: "relation",
				fieldPath,
				targetCollection,
			});
		},
		[setFocusState],
	);

	const requestBlockInsert = React.useCallback(
		(position: BlockInsertPosition, referenceBlockId?: string) => {
			setFocusState({
				type: "block-insert",
				position,
				referenceBlockId,
			});
		},
		[setFocusState],
	);

	const clearFocus = React.useCallback(() => {
		setFocusState({ type: "idle" });
	}, [setFocusState]);

	// Derive focused field/block from state for direct comparison
	const focusedFieldPath = state.type === "field" ? state.fieldPath : undefined;
	const focusedBlockId = state.type === "block" ? state.blockId : undefined;

	const value = React.useMemo(
		(): FocusContextValue => ({
			state,
			focusField,
			focusBlock,
			requestBlockInsert,
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
			requestBlockInsert,
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

export type ScrollFieldIntoViewOptions = {
	/** Scroll the owning block card if a nested block field is not rendered yet. */
	fallbackToBlock?: boolean;
	/** Move DOM focus to the target form control. */
	focus?: boolean;
	behavior?: ScrollBehavior;
	block?: ScrollLogicalPosition;
};

export type ScheduleScrollFieldIntoViewOptions = ScrollFieldIntoViewOptions & {
	/** Number of times to retry while the form expands/renders focused blocks. */
	attempts?: number;
	delayMs?: number;
};

function getPreviewFormSearchRoot(): ParentNode {
	const formScope = document.querySelector<HTMLElement>(
		"[data-preview-form-scope]",
	);
	return formScope ?? document;
}

function findExactFieldWrapper(
	searchRoot: ParentNode,
	fieldPath: string,
): HTMLElement | null {
	for (const element of searchRoot.querySelectorAll<HTMLElement>(
		"[data-field-path]",
	)) {
		if (element.getAttribute("data-field-path") === fieldPath) {
			return element;
		}
	}

	return null;
}

function getOwningBlockFieldPath(fieldPath: string): string | null {
	const blockMatch = fieldPath.match(/^content\._values\.([^.]+)/);
	if (!blockMatch) {
		return null;
	}

	return `content._values.${blockMatch[1]}`;
}

function findFieldWrapper(
	fieldPath: string,
	options: ScrollFieldIntoViewOptions,
): HTMLElement | null {
	const searchRoot = getPreviewFormSearchRoot();
	const exactWrapper = findExactFieldWrapper(searchRoot, fieldPath);
	if (exactWrapper) {
		return exactWrapper;
	}

	if (!options.fallbackToBlock) {
		return null;
	}

	const owningBlockPath = getOwningBlockFieldPath(fieldPath);
	if (!owningBlockPath) {
		return null;
	}

	return findExactFieldWrapper(searchRoot, owningBlockPath);
}

/**
 * Scroll a field into view and focus it.
 * Finds the field wrapper by data-field-path within the preview form scope.
 */
export function scrollFieldIntoView(
	fieldPath: string,
	options: ScrollFieldIntoViewOptions = {},
): boolean {
	if (typeof document === "undefined") {
		return false;
	}

	const wrapper = findFieldWrapper(fieldPath, options);
	if (!wrapper) return false;

	// Find first focusable element inside the wrapper
	const focusable = wrapper.querySelector<HTMLElement>(
		'input:not([type="hidden"]), textarea, button, select, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
	);

	const { behavior = "auto", block = "nearest", focus = true } = options;
	const target = focusable ?? wrapper;
	target.scrollIntoView({ behavior, block });

	// Add pulse animation to highlight the field
	wrapper.classList.add("field-focus-pulse");
	wrapper.addEventListener(
		"animationend",
		() => wrapper.classList.remove("field-focus-pulse"),
		{ once: true },
	);

	if (focus && focusable) {
		// Use requestAnimationFrame to focus after scroll starts
		requestAnimationFrame(() => {
			// Pull focus from iframe back to parent window
			window.focus();
			focusable.focus({ preventScroll: true });
		});
	}

	return true;
}

export function scheduleScrollFieldIntoView(
	fieldPath: string,
	options: ScheduleScrollFieldIntoViewOptions = {},
): void {
	if (typeof window === "undefined") {
		return;
	}

	const {
		attempts = 12,
		delayMs = 80,
		fallbackToBlock = false,
		...scrollOptions
	} = options;

	let attempt = 0;
	const tryScroll = () => {
		attempt += 1;
		const isLastAttempt = attempt >= attempts;
		const didScroll = scrollFieldIntoView(fieldPath, {
			...scrollOptions,
			fallbackToBlock: fallbackToBlock && isLastAttempt,
		});

		if (didScroll || isLastAttempt) {
			return;
		}

		window.setTimeout(tryScroll, delayMs);
	};

	tryScroll();
}
