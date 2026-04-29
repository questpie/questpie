/**
 * Bubble Menu Component
 *
 * Floating toolbar that appears on text selection.
 */

import { Icon } from "@iconify/react";
import type { Editor } from "@tiptap/core";
import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react";
import * as React from "react";

import { useTranslation } from "../../../i18n/hooks";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "../../ui/select";
import { createLinkAttributes } from "./link-utils";
import { EDITOR_ICONS, ToolbarButton } from "./toolbar";
import type { RichTextFeatures } from "./types";

const BLOCK_OPTIONS = [
	{ value: "paragraph", group: "text" },
	{ value: "h1", group: "heading" },
	{ value: "h2", group: "heading" },
	{ value: "h3", group: "heading" },
	{ value: "bulletList", group: "list" },
	{ value: "orderedList", group: "list" },
	{ value: "blockquote", group: "block" },
] as const;

type TranslationFn = (key: string, params?: Record<string, unknown>) => string;
type BlockOptionValue = (typeof BLOCK_OPTIONS)[number]["value"];

type RichTextBubbleMenuProps = {
	editor: Editor;
	features: Required<RichTextFeatures>;
	disabled?: boolean;
	linkOpen: boolean;
	onImageClick?: () => void;
	onLinkOpenChange: (open: boolean) => void;
	showFormatting?: boolean;
};

function getCurrentBlockValue(editor: Editor): string {
	if (editor.isActive("heading", { level: 1 })) return "h1";
	if (editor.isActive("heading", { level: 2 })) return "h2";
	if (editor.isActive("heading", { level: 3 })) return "h3";
	if (editor.isActive("bulletList")) return "bulletList";
	if (editor.isActive("orderedList")) return "orderedList";
	if (editor.isActive("blockquote")) return "blockquote";
	return "paragraph";
}

function getBlockOptionLabel(
	value: BlockOptionValue,
	t: TranslationFn,
): string {
	if (value === "paragraph") return t("editor.paragraph");
	if (value === "h1") return t("editor.heading", { level: 1 });
	if (value === "h2") return t("editor.heading", { level: 2 });
	if (value === "h3") return t("editor.heading", { level: 3 });
	if (value === "bulletList") return t("editor.unorderedList");
	if (value === "orderedList") return t("editor.orderedList");
	return t("editor.quote");
}

function setCurrentBlockValue(editor: Editor, value: string) {
	const chain = editor.chain().focus();

	if (value === "paragraph") {
		chain.setParagraph().run();
		return;
	}

	if (value === "h1" || value === "h2" || value === "h3") {
		chain
			.toggleHeading({
				level: Number(value.replace("h", "")) as 1 | 2 | 3,
			})
			.run();
		return;
	}

	if (value === "bulletList") {
		chain.toggleBulletList().run();
		return;
	}

	if (value === "orderedList") {
		chain.toggleOrderedList().run();
		return;
	}

	if (value === "blockquote") {
		chain.toggleBlockquote().run();
	}
}

/**
 * Bubble menu that appears on text selection
 */
export function RichTextBubbleMenu({
	editor,
	features,
	disabled,
	linkOpen,
	onImageClick,
	onLinkOpenChange,
	showFormatting = true,
}: RichTextBubbleMenuProps) {
	const { t } = useTranslation();
	const [linkUrl, setLinkUrl] = React.useState("");
	const linkInputRef = React.useRef<HTMLInputElement | null>(null);
	const isEditable = !disabled;
	const currentBlockValue = getCurrentBlockValue(editor);
	const currentBlockLabel = BLOCK_OPTIONS.find(
		(option) => option.value === currentBlockValue,
	)?.value
		? getBlockOptionLabel(currentBlockValue as BlockOptionValue, t)
		: t("editor.paragraph");

	const shouldShow = React.useCallback(
		({
			editor: currentEditor,
			from,
			to,
		}: {
			editor: Editor;
			from: number;
			to: number;
		}) => {
			if (!isEditable) return false;
			if (linkOpen) return true;
			if (!showFormatting) return false;
			if (from === to) return false;

			return !currentEditor.isActive("image");
		},
		[isEditable, linkOpen, showFormatting],
	);

	const openLinkMode = React.useCallback(() => {
		const currentLink = editor.getAttributes("link").href as string | undefined;
		setLinkUrl(currentLink || "");
		onLinkOpenChange(true);
	}, [editor, onLinkOpenChange]);

	const closeLinkMode = React.useCallback(() => {
		onLinkOpenChange(false);
		setLinkUrl("");
		editor.chain().focus().run();
	}, [editor, onLinkOpenChange]);

	const applyLink = React.useCallback(() => {
		const trimmedUrl = linkUrl.trim();
		if (!trimmedUrl) {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			closeLinkMode();
			return;
		}

		const attrs = createLinkAttributes(trimmedUrl);
		if (editor.state.selection.empty && !editor.isActive("link")) {
			editor
				.chain()
				.focus()
				.insertContent({
					type: "text",
					text: attrs.href,
					marks: [{ type: "link", attrs }],
				})
				.run();
		} else {
			editor.chain().focus().extendMarkRange("link").setLink(attrs).run();
		}
		closeLinkMode();
	}, [closeLinkMode, editor, linkUrl]);

	const removeLink = React.useCallback(() => {
		editor.chain().focus().extendMarkRange("link").unsetLink().run();
		closeLinkMode();
	}, [closeLinkMode, editor]);

	React.useEffect(() => {
		if (!linkOpen) return;

		const currentLink = editor.getAttributes("link").href as string | undefined;
		setLinkUrl(currentLink || "");
		window.requestAnimationFrame(() => {
			linkInputRef.current?.focus();
			linkInputRef.current?.select();
		});
	}, [editor, linkOpen]);

	return (
		<TiptapBubbleMenu
			editor={editor}
			shouldShow={shouldShow}
			tippyOptions={{
				duration: [120, 90],
				interactive: true,
				maxWidth: "none",
				offset: [0, 8],
				placement: "top",
			}}
			className="qp-rich-text-editor__bubble floating-surface text-popover-foreground"
		>
			{linkOpen ? (
				<form
					className="qp-rich-text-editor__link-form"
					onSubmit={(event) => {
						event.preventDefault();
						applyLink();
					}}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === "Escape") {
							event.preventDefault();
							closeLinkMode();
						}
					}}
				>
					<Icon
						aria-hidden="true"
						className="text-muted-foreground shrink-0"
						icon="ph:link"
						width={16}
						height={16}
					/>
					<Input
						ref={linkInputRef}
						aria-label={t("editor.link")}
						autoComplete="off"
						className="qp-rich-text-editor__link-input"
						inputMode="url"
						name="rich-text-inline-link-url"
						placeholder={t("editor.pasteOrTypeLink")}
						type="text"
						value={linkUrl}
						onChange={(event) => setLinkUrl(event.target.value)}
						disabled={!isEditable}
					/>
					<Button
						type="submit"
						size="icon-xs"
						aria-label={t("common.apply")}
						disabled={!isEditable || !linkUrl.trim()}
					>
						<Icon aria-hidden="true" icon="ph:check" />
					</Button>
					<Button
						type="button"
						size="icon-xs"
						variant="ghost"
						aria-label={t("common.remove")}
						onClick={removeLink}
						disabled={!isEditable || !editor.isActive("link")}
					>
						<Icon aria-hidden="true" icon="ph:link-break" />
					</Button>
				</form>
			) : (
				<>
					{features.heading && (
						<Select
							value={currentBlockValue}
							disabled={!isEditable}
							onValueChange={(value) => {
								if (typeof value === "string") {
									setCurrentBlockValue(editor, value);
								}
							}}
						>
							<SelectTrigger
								aria-label={t("editor.selectionBlockType")}
								className="qp-rich-text-editor__bubble-block h-8 min-w-[116px] px-2.5 text-xs"
								size="sm"
							>
								<SelectValue>{currentBlockLabel}</SelectValue>
							</SelectTrigger>
							<SelectContent align="start" className="min-w-[148px]">
								<SelectGroup>
									<SelectLabel>{t("editor.textBlocks")}</SelectLabel>
									<SelectItem value="paragraph">
										{t("editor.paragraph")}
									</SelectItem>
								</SelectGroup>
								<SelectSeparator />
								<SelectGroup>
									<SelectLabel>{t("editor.headings")}</SelectLabel>
									{BLOCK_OPTIONS.filter(
										(option) => option.group === "heading",
									).map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{getBlockOptionLabel(option.value, t)}
										</SelectItem>
									))}
								</SelectGroup>
								<SelectSeparator />
								<SelectGroup>
									<SelectLabel>{t("editor.list")}</SelectLabel>
									{BLOCK_OPTIONS.filter(
										(option) => option.group === "list",
									).map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{getBlockOptionLabel(option.value, t)}
										</SelectItem>
									))}
								</SelectGroup>
								<SelectSeparator />
								<SelectGroup>
									<SelectLabel>{t("editor.blocks")}</SelectLabel>
									<SelectItem value="blockquote">
										{t("editor.quote")}
									</SelectItem>
								</SelectGroup>
							</SelectContent>
						</Select>
					)}
					<span
						className="qp-rich-text-editor__bubble-separator"
						aria-hidden="true"
					/>
					{features.bold && (
						<ToolbarButton
							icon={EDITOR_ICONS.bold}
							active={editor.isActive("bold")}
							disabled={!isEditable}
							title={t("editor.bold")}
							shortcut="⌘B"
							onClick={() => editor.chain().focus().toggleBold().run()}
						/>
					)}
					{features.italic && (
						<ToolbarButton
							icon={EDITOR_ICONS.italic}
							active={editor.isActive("italic")}
							disabled={!isEditable}
							title={t("editor.italic")}
							shortcut="⌘I"
							onClick={() => editor.chain().focus().toggleItalic().run()}
						/>
					)}
					{features.underline && (
						<ToolbarButton
							icon={EDITOR_ICONS.underline}
							active={editor.isActive("underline")}
							disabled={!isEditable}
							title={t("editor.underline")}
							shortcut="⌘U"
							onClick={() => editor.chain().focus().toggleUnderline().run()}
						/>
					)}
					{features.code && (
						<ToolbarButton
							icon={EDITOR_ICONS.code}
							active={editor.isActive("code")}
							disabled={!isEditable}
							title={t("editor.code")}
							shortcut="⌘E"
							onClick={() => editor.chain().focus().toggleCode().run()}
						/>
					)}
					{features.link && (
						<ToolbarButton
							icon={EDITOR_ICONS.link}
							active={editor.isActive("link")}
							disabled={!isEditable}
							title={t("editor.link")}
							shortcut="⌘K"
							onClick={openLinkMode}
						/>
					)}
					{features.image && onImageClick && (
						<ToolbarButton
							icon={EDITOR_ICONS.image}
							disabled={!isEditable}
							title={t("editor.image")}
							onClick={onImageClick}
						/>
					)}
				</>
			)}
		</TiptapBubbleMenu>
	);
}
