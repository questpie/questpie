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

import type { AnyExtension, Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import * as React from "react";
import { toast } from "sonner";

import { useResolveText, useTranslation } from "../../../i18n/hooks";
import { cn } from "../../../utils";
import { isModifierShortcut } from "../../../utils/keyboard-shortcuts";
import { Label } from "../../ui/label";
import { Skeleton } from "../../ui/skeleton";
import { LocaleBadge } from "../locale-badge";
import { RichTextBubbleMenu } from "./bubble-menu";
import { buildExtensions } from "./extensions";
import { ImagePopover } from "./image-popover";
import {
	getImageAltFromFile,
	getImageFilesFromDataTransfer,
	useRichTextImageUpload,
} from "./image-upload";
import { createLinkAttributes, isLikelyLinkHref } from "./link-utils";
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

function RichTextToolbarSkeleton() {
	return (
		<div
			className="qp-rich-text-editor__toolbar border-border-subtle bg-surface-low flex flex-nowrap items-center gap-1.5 overflow-hidden border-b p-1.5"
			aria-hidden="true"
		>
			<div className="flex items-center gap-1" role="presentation">
				<Skeleton className="size-8" />
				<Skeleton className="size-8" />
			</div>
			<Skeleton className="h-8 min-w-[136px]" />
			<div className="flex items-center gap-1" role="presentation">
				<Skeleton className="size-8" />
				<Skeleton className="size-8" />
				<Skeleton className="size-8" />
			</div>
			<Skeleton className="size-8" />
			<Skeleton className="size-8" />
		</div>
	);
}

function RichTextEditorContentSkeleton() {
	return (
		<div className="qp-rich-text-editor__content space-y-3" aria-hidden="true">
			<Skeleton variant="text" className="h-4 w-full max-w-[92%]" />
			<Skeleton variant="text" className="h-4 w-full max-w-[78%]" />
			<Skeleton variant="text" className="h-4 w-full max-w-[86%]" />
			<div className="pt-3">
				<Skeleton variant="text" className="h-4 w-full max-w-[58%]" />
			</div>
		</div>
	);
}

function RichTextEditorLoadingSkeleton({
	disabled,
	readOnly,
	error,
	showToolbar,
}: {
	disabled?: boolean;
	readOnly?: boolean;
	error?: string;
	showToolbar?: boolean;
}) {
	return (
		<div
			className={cn(
				"qp-rich-text-editor control-surface h-auto min-h-[160px] overflow-hidden",
				disabled || readOnly ? "opacity-60" : "",
				error ? "border-destructive" : "border-border",
			)}
			data-admin-rich-text-editor="root"
			aria-busy="true"
		>
			<span className="sr-only">Loading editor</span>
			{showToolbar && <RichTextToolbarSkeleton />}
			<RichTextEditorContentSkeleton />
		</div>
	);
}

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
	const descriptionId = resolvedDescription ? `${name}-description` : undefined;
	const errorId = error ? `${name}-error` : undefined;
	const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");

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
	const extensionLabels = React.useMemo(
		() => ({
			bulletList: t("editor.unorderedList"),
			bulletListDescription: t("editor.bulletListDescription"),
			codeBlock: t("editor.codeBlock"),
			codeBlockDescription: t("editor.codeBlockDescription"),
			divider: t("editor.horizontalRule"),
			dividerDescription: t("editor.dividerDescription"),
			heading: (level: number) => t("editor.heading", { level }),
			heading1Description: t("editor.heading1Description"),
			heading2Description: t("editor.heading2Description"),
			heading3Description: t("editor.heading3Description"),
			orderedList: t("editor.orderedList"),
			orderedListDescription: t("editor.orderedListDescription"),
			paragraph: t("editor.paragraph"),
			paragraphDescription: t("editor.paragraphDescription"),
			quote: t("editor.quote"),
			quoteDescription: t("editor.quoteDescription"),
			table: t("editor.table"),
			tableDescription: t("editor.tableDescription"),
		}),
		[t],
	);

	// Build Tiptap extensions.
	// `buildExtensions` returns sync when codeBlock is disabled (most editors)
	// or when lowlight is already cached. The useState initializer captures the
	// sync result so the editor renders on the very first frame — no loading.
	const [resolvedExtensions, setResolvedExtensions] = React.useState<
		AnyExtension[] | undefined
	>(() => {
		const result = buildExtensions({
			features: resolvedFeatures,
			labels: extensionLabels,
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
			labels: extensionLabels,
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
	}, [
		resolvedFeatures,
		extensionLabels,
		placeholder,
		maxCharacters,
		extensions,
		t,
	]);

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
					ariaLabel={resolvedLabel ?? name}
					ariaDescribedBy={describedBy || undefined}
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
				<RichTextEditorLoadingSkeleton
					disabled={disabled}
					readOnly={readOnly}
					error={error}
					showToolbar={resolvedFeatures.toolbar}
				/>
			)}

			{/* Description & Error */}
			{resolvedDescription && (
				<p id={descriptionId} className="text-muted-foreground text-xs">
					{resolvedDescription}
				</p>
			)}
			{error && (
				<p id={errorId} className="text-destructive text-xs">
					{error}
				</p>
			)}
		</div>
	);
}

// ============================================================================
// Inner component — editor instance + all interactive state
// ============================================================================

type RichTextEditorCoreProps = {
	name: string;
	ariaLabel?: string;
	ariaDescribedBy?: string;
	value: any;
	onChange?: (value: any) => void;
	disabled?: boolean;
	readOnly?: boolean;
	error?: string;
	locale?: string;
	features: Required<RichTextEditorProps["features"]> & Record<string, boolean>;
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
	ariaLabel,
	ariaDescribedBy,
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
	const { t } = useTranslation();
	// Popover states
	const [linkOpen, setLinkOpen] = React.useState(false);
	const [imageOpen, setImageOpen] = React.useState(false);
	const [uploadingInlineImage, setUploadingInlineImage] = React.useState(false);
	const lastEmittedValueRef = React.useRef<OutputValue | undefined>(undefined);
	const editorRef = React.useRef<Editor | null>(null);

	const allowImages = features.image && (enableImages ?? true);
	const allowLinks = features.link;
	const allowBubbleMenu = features.bubbleMenu;
	const allowToolbar = features.toolbar;
	const allowCharacterCount =
		features.characterCount && (showCharacterCount || maxCharacters);

	const isEditable = !disabled && !readOnly;
	const editorStateRef = React.useRef({
		allowImages,
		allowLinks,
		isEditable,
	});
	editorStateRef.current = {
		allowImages,
		allowLinks,
		isEditable,
	};

	const { uploadImageFile } = useRichTextImageUpload({
		imageCollection,
		onImageUpload,
	});

	const insertUploadedImages = React.useCallback(
		async (files: File[], options?: { position?: number }) => {
			const currentEditor = editorRef.current;
			if (!currentEditor || files.length === 0) return;

			try {
				setUploadingInlineImage(true);
				const imageNodes = [];
				for (const file of files) {
					const url = await uploadImageFile(file);
					imageNodes.push({
						type: "image",
						attrs: {
							src: url,
							alt: getImageAltFromFile(file),
						},
					});
				}

				if (imageNodes.length === 0) return;

				const chain = currentEditor.chain().focus();
				if (typeof options?.position === "number") {
					chain.insertContentAt(options.position, imageNodes).run();
				} else {
					chain.insertContent(imageNodes).run();
				}
			} catch (err) {
				const error = err instanceof Error ? err : new Error(t("upload.error"));
				toast.error(error.message);
			} finally {
				setUploadingInlineImage(false);
			}
		},
		[t, uploadImageFile],
	);

	const handleEditorPaste = React.useCallback(
		(event: ClipboardEvent) => {
			const currentEditor = editorRef.current;
			const state = editorStateRef.current;
			if (!currentEditor || !state.isEditable) return false;

			const imageFiles = getImageFilesFromDataTransfer(event.clipboardData);
			if (state.allowImages && imageFiles.length > 0) {
				event.preventDefault();
				void insertUploadedImages(imageFiles);
				return true;
			}

			const pastedText = event.clipboardData?.getData("text/plain") ?? "";
			if (
				state.allowLinks &&
				isLikelyLinkHref(pastedText) &&
				!currentEditor.state.selection.empty
			) {
				event.preventDefault();
				currentEditor
					.chain()
					.focus()
					.extendMarkRange("link")
					.setLink(createLinkAttributes(pastedText))
					.run();
				return true;
			}

			return false;
		},
		[insertUploadedImages],
	);

	const handleEditorDrop = React.useCallback(
		(
			view: {
				posAtCoords: (coords: {
					left: number;
					top: number;
				}) => { pos: number } | null;
			},
			event: DragEvent,
			moved: boolean,
		) => {
			const state = editorStateRef.current;
			if (moved || !state.isEditable || !state.allowImages) return false;

			const imageFiles = getImageFilesFromDataTransfer(event.dataTransfer);
			if (imageFiles.length === 0) return false;

			event.preventDefault();
			const position = view.posAtCoords({
				left: event.clientX,
				top: event.clientY,
			})?.pos;
			void insertUploadedImages(imageFiles, { position });
			return true;
		},
		[insertUploadedImages],
	);

	const handleEditorKeyDown = React.useCallback(
		(event: KeyboardEvent) => {
			if (!isModifierShortcut(event)) return false;

			const key = event.key.toLowerCase();
			if (key === "k" && allowLinks && isEditable) {
				event.preventDefault();
				event.stopPropagation();
				setLinkOpen(true);
				return true;
			}

			if (["b", "e", "i", "u", "y", "z"].includes(key)) {
				event.stopPropagation();
			}

			return false;
		},
		[allowLinks, isEditable],
	);

	// Initialize editor — extensions are guaranteed to be loaded at this point.
	const editor = useEditor({
		extensions: resolvedExtensions,
		content: value ?? "",
		editorProps: {
			attributes: {
				class: "qp-rich-text-editor__content",
				"aria-label": ariaLabel ?? name,
				"aria-multiline": "true",
				"data-admin-rich-text-editor": "content",
				role: "textbox",
				...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
				...(error ? { "aria-invalid": "true" } : {}),
			},
			handleKeyDown: (_view, event) => handleEditorKeyDown(event),
			handlePaste: (_view, event) => handleEditorPaste(event),
			handleDrop: (view, event, _slice, moved) =>
				handleEditorDrop(view, event, moved),
		},
		editable: isEditable,
		onUpdate: ({ editor: currentEditor }) => {
			if (disabled || readOnly) return;
			const nextValue = getOutput(currentEditor);
			lastEmittedValueRef.current = nextValue as OutputValue;
			onChange?.(nextValue);
		},
	});

	React.useEffect(() => {
		editorRef.current = editor;
		return () => {
			if (editorRef.current === editor) {
				editorRef.current = null;
			}
		};
	}, [editor]);

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
					"qp-rich-text-editor control-surface h-auto min-h-[160px] overflow-hidden",
					disabled || readOnly ? "opacity-60" : "",
					error ? "border-destructive" : "border-border",
				)}
				data-admin-rich-text-editor="root"
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
				{editor && (allowBubbleMenu || linkOpen) && (
					<RichTextBubbleMenu
						editor={editor}
						features={features}
						disabled={!isEditable}
						linkOpen={linkOpen}
						onImageClick={allowImages ? () => setImageOpen(true) : undefined}
						onLinkOpenChange={setLinkOpen}
						showFormatting={allowBubbleMenu}
					/>
				)}

				{/* Editor Content */}
				{editor ? (
					<EditorContent editor={editor} id={name} />
				) : (
					<RichTextEditorContentSkeleton />
				)}

				{uploadingInlineImage && (
					<div
						className="qp-rich-text-editor__upload-status"
						role="status"
						aria-live="polite"
					>
						{t("editor.uploading")}
					</div>
				)}

				{/* Character Count */}
				{allowCharacterCount && showCharacterCount && (
					<div className="bg-surface-low text-muted-foreground border-border-subtle flex items-center justify-between border-t px-2 py-1 text-xs">
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
