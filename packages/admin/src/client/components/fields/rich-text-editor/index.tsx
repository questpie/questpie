/**
 * RichTextEditor Component
 *
 * Tiptap-based rich text editor with modern icon-based toolbar.
 *
 * Uses composition to avoid a race condition: the outer component loads
 * extensions asynchronously and renders a skeleton; the inner component
 * mounts only once extensions are ready, so `useEditor` always receives
 * real extensions — never an empty array.
 */

import type { AnyExtension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import * as React from "react";

import { useResolveText, useTranslation } from "../../../i18n/hooks";
import { cn } from "../../../utils";
import { Label } from "../../ui/label";
import { LocaleBadge } from "../locale-badge";
import { RichTextBubbleMenu } from "./bubble-menu";
import { buildExtensions } from "./extensions";
import { ImagePopover } from "./image-popover";
import { LinkPopover } from "./link-popover";
import { mergePresetFeatures } from "./presets";
import { RichTextToolbar } from "./toolbar";
import {
	defaultFeatures,
	type OutputValue,
	type RichTextEditorProps,
} from "./types";
import {
	getCharacterCount,
	getHeadingLevel,
	getOutput,
	isSameValue,
} from "./utils";

// Re-export types
export type { RichTextEditorProps } from "./types";

// ============================================================================
// Outer component — async extension loading + shell
// ============================================================================

/**
 * Main RichText Editor Component.
 *
 * Loads Tiptap extensions asynchronously (lowlight etc.) and delegates to
 * `RichTextEditorCore` once they are ready. This avoids initializing
 * `useEditor` with an empty extension list which causes the ProseMirror
 * "Schema is missing its top node type" error.
 */
export function RichTextEditor({
	name,
	value,
	onChange,
	disabled,
	readOnly,
	label,
	description,
	placeholder,
	required,
	error,
	localized,
	locale,
	extensions,
	preset,
	features,
	showCharacterCount,
	maxCharacters,
	enableImages,
	onImageUpload,
	imageCollection,
	enableMediaLibrary,
}: RichTextEditorProps) {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const resolvedLabel = label ? resolveText(label) : undefined;
	const resolvedDescription = description
		? resolveText(description)
		: undefined;

	// Resolved feature flags with preset support
	const resolvedFeatures = React.useMemo(() => {
		if (preset) {
			return mergePresetFeatures(preset, features);
		}
		return {
			...defaultFeatures,
			...features,
		};
	}, [preset, features]);

	// Build Tiptap extensions.
	// `buildExtensions` returns sync when codeBlock is disabled (most editors)
	// or when lowlight is already cached. The useState initializer captures the
	// sync result so the editor renders on the very first frame — no loading.
	const [resolvedExtensions, setResolvedExtensions] = React.useState<
		AnyExtension[] | undefined
	>(() => {
		const result = buildExtensions({
			features: resolvedFeatures,
			placeholder: placeholder || t("editor.startWriting"),
			maxCharacters,
			customExtensions: extensions,
		});
		return result instanceof Promise ? undefined : result;
	});

	React.useEffect(() => {
		let mounted = true;
		const result = buildExtensions({
			features: resolvedFeatures,
			placeholder: placeholder || t("editor.startWriting"),
			maxCharacters,
			customExtensions: extensions,
		});
		if (result instanceof Promise) {
			result.then((exts) => {
				if (mounted) setResolvedExtensions(exts);
			});
		} else {
			setResolvedExtensions(result);
		}
		return () => {
			mounted = false;
		};
	}, [resolvedFeatures, placeholder, maxCharacters, extensions, t]);

	return (
		<div className="space-y-2" data-disabled={disabled || readOnly}>
			{resolvedLabel && (
				<div className="flex items-center gap-2">
					<Label htmlFor={name}>
						{resolvedLabel}
						{required && <span className="text-destructive ml-1">*</span>}
					</Label>
					{localized && <LocaleBadge locale={locale || "i18n"} />}
				</div>
			)}

			{resolvedExtensions ? (
				<RichTextEditorCore
					name={name}
					value={value}
					onChange={onChange}
					disabled={disabled}
					readOnly={readOnly}
					error={error}
					locale={locale}
					features={resolvedFeatures}
					resolvedExtensions={resolvedExtensions}
					showCharacterCount={showCharacterCount}
					maxCharacters={maxCharacters}
					enableImages={enableImages}
					onImageUpload={onImageUpload}
					imageCollection={imageCollection}
					enableMediaLibrary={enableMediaLibrary}
				/>
			) : (
				<div
					className={cn(
						"qp-rich-text-editor bg-input rounded-md border",
						disabled || readOnly ? "opacity-60" : "",
						error ? "border-destructive" : "border-border",
					)}
				>
					<div className="text-muted-foreground flex min-h-[120px] items-center justify-center text-sm">
						Loading editor...
					</div>
				</div>
			)}

			{/* Description & Error */}
			{resolvedDescription && (
				<p className="text-muted-foreground text-xs">{resolvedDescription}</p>
			)}
			{error && <p className="text-destructive text-xs">{error}</p>}
		</div>
	);
}

// ============================================================================
// Inner component — editor instance + all interactive state
// ============================================================================

type RichTextEditorCoreProps = {
	name: string;
	value: any;
	onChange?: (value: any) => void;
	disabled?: boolean;
	readOnly?: boolean;
	error?: string;
	locale?: string;
	features: Required<RichTextEditorProps["features"]> &
		Record<string, boolean>;
	resolvedExtensions: AnyExtension[];
	showCharacterCount?: boolean;
	maxCharacters?: number;
	enableImages?: boolean;
	onImageUpload?: (file: File) => Promise<string>;
	imageCollection?: string;
	enableMediaLibrary?: boolean;
};

/**
 * Core editor — only mounts when extensions are ready.
 * `useEditor` always receives a complete extension list, so the ProseMirror
 * schema always has its `doc` node.
 */
function RichTextEditorCore({
	name,
	value,
	onChange,
	disabled,
	readOnly,
	error,
	locale,
	features,
	resolvedExtensions,
	showCharacterCount,
	maxCharacters,
	enableImages,
	onImageUpload,
	imageCollection,
	enableMediaLibrary,
}: RichTextEditorCoreProps) {
	// Popover states
	const [linkOpen, setLinkOpen] = React.useState(false);
	const [imageOpen, setImageOpen] = React.useState(false);
	const lastEmittedValueRef = React.useRef<OutputValue | undefined>(undefined);

	const allowImages = features.image && (enableImages ?? true);
	const allowLinks = features.link;
	const allowBubbleMenu = features.bubbleMenu;
	const allowToolbar = features.toolbar;
	const allowCharacterCount =
		features.characterCount && (showCharacterCount || maxCharacters);

	const isEditable = !disabled && !readOnly;

	// Initialize editor — extensions are guaranteed to be loaded at this point.
	const editor = useEditor({
		extensions: resolvedExtensions,
		content: value ?? "",
		editorProps: {
			attributes: {
				class: "qp-rich-text-editor__content",
			},
		},
		editable: isEditable,
		onUpdate: ({ editor: currentEditor }) => {
			if (disabled || readOnly) return;
			const nextValue = getOutput(currentEditor);
			lastEmittedValueRef.current = nextValue as OutputValue;
			onChange?.(nextValue);
		},
	});

	const headingValue = getHeadingLevel(editor);
	const inTable = editor?.isActive("table") ?? false;

	// Update editor editable state
	React.useEffect(() => {
		if (!editor) return;
		editor.setEditable(isEditable);
	}, [editor, isEditable]);

	// Sync external value changes (including locale switches) to editor.
	// When locale changes, react-hook-form resets the field value which triggers
	// this effect. We force-apply the new value by clearing lastEmittedValueRef
	// when locale changes so the isSameValue guard doesn't block the update.
	const prevLocaleRef = React.useRef(locale);
	React.useEffect(() => {
		if (prevLocaleRef.current !== locale) {
			prevLocaleRef.current = locale;
			lastEmittedValueRef.current = undefined;
		}
	}, [locale]);

	React.useEffect(() => {
		if (!editor) return;
		if (value === undefined) return;
		if (isSameValue(value, lastEmittedValueRef.current)) return;

		lastEmittedValueRef.current = value as OutputValue;
		editor.commands.setContent(value ?? "", false);
	}, [editor, value]);

	// Character count
	const characterCount = getCharacterCount(editor);

	return (
		<>
			<div
				className={cn(
					"qp-rich-text-editor bg-input rounded-md border",
					disabled || readOnly ? "opacity-60" : "",
					error ? "border-destructive" : "border-border",
				)}
			>
				{/* Toolbar */}
				{editor && allowToolbar && (
					<RichTextToolbar
						editor={editor}
						features={features}
						disabled={!isEditable}
						headingValue={headingValue}
						onHeadingChange={(value) => {
							if (!editor) return;
							if (value === "paragraph") {
								editor.chain().focus().setParagraph().run();
								return;
							}
							editor
								.chain()
								.focus()
								.toggleHeading({
									level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6,
								})
								.run();
						}}
						onLinkClick={() => setLinkOpen(true)}
						onImageClick={() => setImageOpen(true)}
						onTableClick={() => {
							// Insert table directly when clicking toolbar button
							if (!inTable) {
								editor
									.chain()
									.focus()
									.insertTable({
										rows: 3,
										cols: 3,
										withHeaderRow: true,
									})
									.run();
							}
						}}
						inTable={inTable}
					/>
				)}

				{/* Bubble Menu */}
				{editor && allowBubbleMenu && (
					<RichTextBubbleMenu
						editor={editor}
						features={features}
						disabled={!isEditable}
						onLinkClick={() => setLinkOpen(true)}
					/>
				)}

				{/* Editor Content */}
				{editor ? (
					<EditorContent editor={editor} id={name} />
				) : (
					<div className="text-muted-foreground flex min-h-[120px] items-center justify-center text-sm">
						Loading editor...
					</div>
				)}

				{/* Character Count */}
				{allowCharacterCount && showCharacterCount && (
					<div className="bg-muted text-muted-foreground flex items-center justify-between border-t px-2 py-1 text-xs">
						<span>
							{characterCount.words} word{characterCount.words === 1 ? "" : "s"}
						</span>
						<span>
							{characterCount.characters}
							{typeof maxCharacters === "number"
								? ` / ${maxCharacters}`
								: ""}{" "}
							characters
						</span>
					</div>
				)}
			</div>

			{/* Link Popover */}
			{allowLinks && (
				<LinkPopover
					editor={editor}
					open={linkOpen}
					onOpenChange={setLinkOpen}
					disabled={!isEditable}
				/>
			)}

			{/* Image Popover */}
			{allowImages && (
				<ImagePopover
					editor={editor}
					open={imageOpen}
					onOpenChange={setImageOpen}
					disabled={!isEditable}
					onImageUpload={onImageUpload}
					imageCollection={imageCollection}
					enableMediaLibrary={enableMediaLibrary}
				/>
			)}
		</>
	);
}
