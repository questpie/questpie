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
	/** Enable inline scalar editing in preview mode */
	editable?: "text" | "textarea";
	/** Content to render */
	children: React.ReactNode;
	/** HTML element type */
	as?: React.ElementType;
	/** Additional class names */
	className?: string;
	/** Inline styles for the rendered element */
	style?: React.CSSProperties;
	/** Click handler (uses context by default) */
	onClick?: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
	/** Inline edit commit handler (uses context/default postMessage by default) */
	onValueCommit?: (payload: PreviewFieldValueEditedPayload) => void;
};

export type PreviewFieldValueEditedPayload = {
	path: string;
	value: unknown;
	inputKind: "text" | "textarea" | "number" | "boolean";
	blockId?: string;
	fieldType?: "regular" | "block" | "relation";
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
	handleFieldValueEdited?: (payload: PreviewFieldValueEditedPayload) => void;
	focusedField: string | null;
};

const PreviewContext = React.createContext<PreviewContextValue | null>(null);

/**
 * Provider for preview mode context.
 * Use this at the root of your preview page.
 */
export function PreviewProvider({
	preview,
	isPreviewMode,
	focusedField,
	onFieldClick,
	onFieldValueEdited,
	children,
}: {
	preview?: {
		isPreviewMode: boolean;
		focusedField: string | null;
		handleFieldClick: PreviewContextValue["handleFieldClick"];
		handleFieldValueEdited?: PreviewContextValue["handleFieldValueEdited"];
	};
	isPreviewMode?: boolean;
	focusedField?: string | null;
	onFieldClick?: (
		fieldPath: string,
		context?: {
			blockId?: string;
			fieldType?: "regular" | "block" | "relation";
		},
	) => void;
	onFieldValueEdited?: (payload: PreviewFieldValueEditedPayload) => void;
	children: React.ReactNode;
}) {
	const value = React.useMemo(
		() => ({
			isPreviewMode: preview?.isPreviewMode ?? isPreviewMode ?? false,
			focusedField: preview?.focusedField ?? focusedField ?? null,
			handleFieldClick:
				preview?.handleFieldClick ?? onFieldClick ?? (() => undefined),
			handleFieldValueEdited:
				preview?.handleFieldValueEdited ?? onFieldValueEdited,
		}),
		[preview, isPreviewMode, focusedField, onFieldClick, onFieldValueEdited],
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
	editable,
	children,
	as: Component = "div",
	className,
	style,
	onClick,
	onValueCommit,
}: PreviewFieldProps) {
	const context = usePreviewContext();
	const blockScope = useBlockScope();
	const fullPath = useResolveFieldPath(field);

	// If no context or not in preview mode, just render normally
	if (!context?.isPreviewMode) {
		return (
			<Component className={className} style={style}>
				{children}
			</Component>
		);
	}

	return (
		<PreviewFieldElement
			Component={Component}
			blockId={blockScope?.blockId}
			className={className}
			editable={editable}
			fieldType={fieldType}
			fullPath={fullPath}
			isFocused={context.focusedField === fullPath}
			onClick={onClick ?? context.handleFieldClick}
			onValueCommit={onValueCommit ?? context.handleFieldValueEdited}
			style={style}
		>
			{children}
		</PreviewFieldElement>
	);
}

/**
 * Standalone PreviewField that works without context.
 * Useful when you can't use PreviewProvider.
 */
export function StandalonePreviewField({
	field,
	fieldType = "regular",
	editable,
	children,
	as: Component = "div",
	className,
	style,
	isPreviewMode,
	isFocused,
	onFieldClick,
	onValueCommit,
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
		return (
			<Component className={className} style={style}>
				{children}
			</Component>
		);
	}

	return (
		<PreviewFieldElement
			Component={Component}
			blockId={blockScope?.blockId}
			className={className}
			editable={editable}
			fieldType={fieldType}
			fullPath={fullPath}
			isFocused={!!isFocused}
			onClick={onFieldClick}
			onValueCommit={onValueCommit}
			style={style}
		>
			{children}
		</PreviewFieldElement>
	);
}

function PreviewFieldElement({
	Component,
	blockId,
	children,
	className,
	editable,
	fieldType,
	fullPath,
	isFocused,
	onClick,
	onValueCommit,
	style,
}: {
	Component: React.ElementType;
	blockId?: string;
	children: React.ReactNode;
	className?: string;
	editable?: "text" | "textarea";
	fieldType: "regular" | "block" | "relation";
	fullPath: string;
	isFocused: boolean;
	onClick: PreviewContextValue["handleFieldClick"];
	onValueCommit?: (payload: PreviewFieldValueEditedPayload) => void;
	style?: React.CSSProperties;
}) {
	const [isEditing, setIsEditing] = React.useState(false);
	const [draftValue, setDraftValue] = React.useState("");
	const isEditable = editable === "text" || editable === "textarea";
	const setEditorRef = React.useCallback(
		(node: HTMLInputElement | HTMLTextAreaElement | null) => {
			if (!node) return;
			node.focus({ preventScroll: true });
			node.select();
		},
		[],
	);

	const startEditing = React.useCallback(() => {
		if (!isEditable) {
			return;
		}

		setDraftValue(childrenToEditableValue(children));
		setIsEditing(true);
	}, [children, isEditable]);

	const routeClick = React.useCallback(() => {
		onClick(fullPath, {
			blockId,
			fieldType,
		});
	}, [blockId, fieldType, fullPath, onClick]);

	const commitEdit = React.useCallback(() => {
		if (!isEditing || !editable) {
			return;
		}

		const payload = {
			path: fullPath,
			value: draftValue,
			inputKind: editable,
			blockId,
			fieldType,
		} satisfies PreviewFieldValueEditedPayload;

		if (onValueCommit) {
			onValueCommit(payload);
		} else {
			postFieldValueEdited(payload);
		}

		setIsEditing(false);
	}, [
		blockId,
		draftValue,
		editable,
		fieldType,
		fullPath,
		isEditing,
		onValueCommit,
	]);

	const cancelEdit = React.useCallback(() => {
		setIsEditing(false);
		setDraftValue(childrenToEditableValue(children));
	}, [children]);

	const handleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (!isEditing) {
			routeClick();
		}
	};

	const handleDoubleClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		startEditing();
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		event.stopPropagation();

		if (!isEditing) {
			if (event.key === "Enter" && isEditable) {
				event.preventDefault();
				routeClick();
				startEditing();
			}
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			cancelEdit();
			return;
		}

		if (editable === "text" && event.key === "Enter") {
			event.preventDefault();
			commitEdit();
			return;
		}

		if (
			editable === "textarea" &&
			event.key === "Enter" &&
			(event.metaKey || event.ctrlKey)
		) {
			event.preventDefault();
			commitEdit();
		}
	};

	const editor =
		editable === "textarea" ? (
			<textarea
				ref={setEditorRef}
				value={draftValue}
				onChange={(event) => setDraftValue(event.target.value)}
				onBlur={commitEdit}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={handleKeyDown}
				className="min-h-[4lh] w-full resize-y bg-transparent p-0 [letter-spacing:inherit] text-inherit outline-none [font:inherit]"
			/>
		) : (
			<input
				ref={setEditorRef}
				type="text"
				value={draftValue}
				onChange={(event) => setDraftValue(event.target.value)}
				onBlur={commitEdit}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={handleKeyDown}
				className="w-full bg-transparent p-0 [letter-spacing:inherit] text-inherit outline-none [font:inherit]"
			/>
		);

	return (
		<Component
			data-preview-field={fullPath}
			data-block-id={blockId}
			data-field-type={fieldType}
			data-preview-editable={editable}
			data-preview-editing={isEditing ? "true" : undefined}
			tabIndex={0}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			onKeyDown={handleKeyDown}
			style={style}
			className={cn(
				className,
				"group/preview-field relative rounded-[2px] transition-[box-shadow,outline-color,outline-offset] duration-150",
				"cursor-pointer outline outline-2 outline-offset-2 outline-transparent",
				"hover:outline-primary/50 hover:shadow-[0_0_0_4px_hsl(var(--primary)/0.10)]",
				"focus-visible:outline-primary/70 focus-visible:shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]",
				isEditable && "cursor-text",
				isFocused &&
					"outline-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.14)]",
				isEditing &&
					"outline-primary bg-background/80 shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]",
			)}
		>
			{isEditing ? editor : children}
		</Component>
	);
}

function childrenToEditableValue(children: React.ReactNode): string {
	if (
		children === null ||
		children === undefined ||
		typeof children === "boolean"
	) {
		return "";
	}

	if (typeof children === "string" || typeof children === "number") {
		return String(children);
	}

	if (Array.isArray(children)) {
		return children.map(childrenToEditableValue).join("");
	}

	if (React.isValidElement<{ children?: React.ReactNode }>(children)) {
		return childrenToEditableValue(children.props.children);
	}

	return "";
}

function postFieldValueEdited(payload: PreviewFieldValueEditedPayload) {
	if (typeof window === "undefined" || !window.parent) {
		return;
	}

	window.parent.postMessage(
		{
			type: "FIELD_VALUE_EDITED",
			...payload,
		},
		"*",
	);
}
