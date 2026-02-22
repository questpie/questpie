/**
 * PreviewField Component
 *
 * Wrapper component that makes fields clickable in preview mode.
 * When clicked, signals to admin to focus that field in the form.
 */

"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { useBlockScope, useResolveFieldPath } from "./block-scope-context.js";

// ============================================================================
// Types
// ============================================================================

export type PreviewFieldProps = {
	/** Field name (for click-to-focus) - will be resolved with block scope if available */
	field: string;
	/** Field type for routing (regular, block, or relation) */
	fieldType?: "regular" | "block" | "relation";
	/** Content to render */
	children: React.ReactNode;
	/** HTML element type */
	as?: React.ElementType;
	/** Additional class names */
	className?: string;
	/** Click handler (uses context by default) */
	onClick?: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
};

// ============================================================================
// Context
// ============================================================================

type PreviewContextValue = {
	isPreviewMode: boolean;
	handleFieldClick: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
	focusedField: string | null;
};

const PreviewContext = React.createContext<PreviewContextValue | null>(null);

/**
 * Provider for preview mode context.
 * Use this at the root of your preview page.
 */
export function PreviewProvider({
	isPreviewMode,
	focusedField,
	onFieldClick,
	children,
}: {
	isPreviewMode: boolean;
	focusedField: string | null;
	onFieldClick: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
	children: React.ReactNode;
}) {
	const value = React.useMemo(
		() => ({
			isPreviewMode,
			focusedField,
			handleFieldClick: onFieldClick,
		}),
		[isPreviewMode, focusedField, onFieldClick],
	);

	return (
		<PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
	);
}

/**
 * Hook to access preview context.
 */
export function usePreviewContext(): PreviewContextValue | null {
	return React.useContext(PreviewContext);
}

// ============================================================================
// Component
// ============================================================================

/**
 * Wrapper that makes a field clickable in preview mode.
 *
 * When clicked in preview, signals to admin to focus that field in the form.
 * Automatically resolves field paths using block scope context if available.
 *
 * @example
 * ```tsx
 * // Regular field
 * <PreviewField field="title" as="h1" className="text-4xl">
 *   {data.title}
 * </PreviewField>
 *
 * // Relation field
 * <PreviewField field="author" fieldType="relation">
 *   {data.author.name}
 * </PreviewField>
 *
 * // Inside a block (auto-resolves to content._values.{blockId}.title)
 * <PreviewField field="title">
 *   {values.title}
 * </PreviewField>
 * ```
 */
export function PreviewField({
	field,
	fieldType = "regular",
	children,
	as: Component = "div",
	className,
	onClick,
}: PreviewFieldProps) {
	const context = usePreviewContext();
	const blockScope = useBlockScope();
	const fullPath = useResolveFieldPath(field);

	// If no context or not in preview mode, just render normally
	if (!context?.isPreviewMode) {
		return <Component className={className}>{children}</Component>;
	}

	const { handleFieldClick, focusedField } = context;
	const isFocused = focusedField === fullPath;

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (onClick) {
			onClick(fullPath, {
				blockId: blockScope?.blockId,
				fieldType,
			});
		} else {
			handleFieldClick(fullPath, {
				blockId: blockScope?.blockId,
				fieldType,
			});
		}
	};

	return (
		<Component
			data-preview-field={fullPath}
			data-block-id={blockScope?.blockId}
			data-field-type={fieldType}
			onClick={handleClick}
			className={cn(
				className,
				"group relative cursor-pointer transition-all duration-150",
				"hover:outline hover:outline-2 hover:outline-dashed hover:outline-primary/60 hover:outline-offset-2 hover:rounded-sm",
				isFocused &&
					"outline outline-2 outline-primary outline-offset-2 rounded-sm",
			)}
		>
			{children}
		</Component>
	);
}

/**
 * Standalone PreviewField that works without context.
 * Useful when you can't use PreviewProvider.
 */
export function StandalonePreviewField({
	field,
	fieldType = "regular",
	children,
	as: Component = "div",
	className,
	isPreviewMode,
	isFocused,
	onFieldClick,
}: PreviewFieldProps & {
	isPreviewMode: boolean;
	isFocused?: boolean;
	onFieldClick: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
}) {
	const blockScope = useBlockScope();
	const fullPath = useResolveFieldPath(field);

	if (!isPreviewMode) {
		return <Component className={className}>{children}</Component>;
	}

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onFieldClick(fullPath, {
			blockId: blockScope?.blockId,
			fieldType,
		});
	};

	return (
		<Component
			data-preview-field={fullPath}
			data-block-id={blockScope?.blockId}
			data-field-type={fieldType}
			onClick={handleClick}
			className={cn(
				className,
				"group relative cursor-pointer transition-all duration-150",
				"hover:outline hover:outline-2 hover:outline-dashed hover:outline-primary/60 hover:outline-offset-2 hover:rounded-sm",
				isFocused &&
					"outline outline-2 outline-primary outline-offset-2 rounded-sm",
			)}
		>
			{children}
		</Component>
	);
}
