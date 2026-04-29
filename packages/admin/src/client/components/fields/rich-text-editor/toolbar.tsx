/**
 * RichText Editor Toolbar Components
 *
 * Icon-based toolbar using Iconify icons (Phosphor set) for a clean, modern UI.
 */

import { Icon } from "@iconify/react";
import type { Editor } from "@tiptap/core";
import * as React from "react";

import { useTranslation } from "../../../i18n/hooks";
import { cn } from "../../../utils";
import { Button } from "../../ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
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
import { TableControls } from "./table-controls";
import type { RichTextFeatures } from "./types";

/**
 * Icon mapping for all editor actions
 */
export const EDITOR_ICONS = {
	undo: "ph:arrow-counter-clockwise",
	redo: "ph:arrow-clockwise",
	bold: "ph:text-b",
	italic: "ph:text-italic",
	underline: "ph:text-underline",
	strikethrough: "ph:text-strikethrough",
	code: "ph:code",
	heading: "ph:text-h",
	bulletList: "ph:list-bullets",
	orderedList: "ph:list-numbers",
	blockquote: "ph:quotes",
	codeBlock: "ph:code-block",
	horizontalRule: "ph:minus-circle",
	link: "ph:link",
	image: "ph:image",
	table: "ph:table",
	alignLeft: "ph:text-align-left",
	alignCenter: "ph:text-align-center",
	alignRight: "ph:text-align-right",
	alignJustify: "ph:text-align-justify",
	blocks: "ph:list-plus",
	formatting: "ph:text-aa",
	insert: "ph:plus",
	more: "ph:dots-three-vertical",
} as const;

const HEADING_OPTIONS = [
	{ value: "paragraph", group: "text" },
	{ value: "1", group: "heading" },
	{ value: "2", group: "heading" },
	{ value: "3", group: "heading" },
	{ value: "4", group: "heading" },
	{ value: "5", group: "heading" },
	{ value: "6", group: "heading" },
] as const;

type TranslationFn = (key: string, params?: Record<string, unknown>) => string;
type AlignmentValue = "left" | "center" | "right" | "justify";

const ALIGNMENT_OPTIONS: {
	value: AlignmentValue;
	icon: string;
	labelKey: string;
}[] = [
	{ value: "left", icon: EDITOR_ICONS.alignLeft, labelKey: "editor.alignLeft" },
	{
		value: "center",
		icon: EDITOR_ICONS.alignCenter,
		labelKey: "editor.alignCenter",
	},
	{
		value: "right",
		icon: EDITOR_ICONS.alignRight,
		labelKey: "editor.alignRight",
	},
	{
		value: "justify",
		icon: EDITOR_ICONS.alignJustify,
		labelKey: "editor.alignJustify",
	},
];

function getHeadingOptionLabel(
	value: (typeof HEADING_OPTIONS)[number]["value"],
	t: TranslationFn,
) {
	if (value === "paragraph") return t("editor.paragraph");
	return t("editor.heading", { level: value });
}

function getCurrentAlignment(editor: Editor): AlignmentValue {
	if (editor.isActive({ textAlign: "center" })) return "center";
	if (editor.isActive({ textAlign: "right" })) return "right";
	if (editor.isActive({ textAlign: "justify" })) return "justify";
	return "left";
}

type ToolbarButtonProps = {
	active?: boolean;
	disabled?: boolean;
	title?: string;
	onClick?: () => void;
	icon?: string;
	children?: React.ReactNode;
	shortcut?: string;
	className?: string;
} & Omit<
	React.ComponentProps<typeof Button>,
	"variant" | "size" | "type" | "children" | "onClick" | "disabled" | "title"
>;

/**
 * Icon-based toolbar button with tooltip showing keyboard shortcuts
 */
export function ToolbarButton({
	active,
	disabled,
	title,
	onClick,
	icon: iconName,
	children,
	shortcut,
	className,
	...rest
}: ToolbarButtonProps) {
	const tooltipText =
		!title && !shortcut
			? undefined
			: shortcut
				? `${title || ""} (${shortcut})`.trim()
				: title;

	const iconSuffix = active ? "-fill" : "";
	const buttonSize = iconName ? "icon-sm" : "xs";

	return (
		<Button
			type="button"
			variant="ghost"
			size={buttonSize}
			aria-label={title}
			aria-pressed={typeof active === "boolean" ? active : undefined}
			data-active={active}
			data-rich-text-toolbar-button=""
			title={tooltipText}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"item-surface text-muted-foreground hover:bg-surface-high hover:text-foreground motion-reduce:transition-none",
				"data-[active=true]:bg-surface-high data-[active=true]:text-foreground",
				"aria-expanded:bg-surface-high",
				className,
			)}
			{...rest}
		>
			{iconName ? (
				<Icon
					aria-hidden="true"
					icon={`${iconName}${iconSuffix}`}
					width={16}
					height={16}
				/>
			) : (
				children
			)}
		</Button>
	);
}

/**
 * Toolbar button group with divider
 */
function ToolbarGroup({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-1" role="group">
			{children}
		</div>
	);
}

type ToolbarMenuItemProps = {
	active?: boolean;
	disabled?: boolean;
	icon: string;
	label: string;
	onClick: () => void;
	shortcut?: string;
};

function ToolbarMenuItem({
	active,
	disabled,
	icon,
	label,
	onClick,
	shortcut,
}: ToolbarMenuItemProps) {
	return (
		<DropdownMenuItem
			aria-current={active ? "true" : undefined}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"min-w-44",
				active ? "bg-accent text-accent-foreground" : "",
			)}
		>
			<Icon aria-hidden="true" icon={icon} />
			<span>{label}</span>
			{shortcut ? (
				<DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>
			) : active ? (
				<Icon aria-hidden="true" icon="ph:check" className="ml-auto size-3.5" />
			) : null}
		</DropdownMenuItem>
	);
}

type RichTextToolbarProps = {
	editor: Editor;
	features: Required<RichTextFeatures>;
	disabled?: boolean;
	headingValue: string;
	onHeadingChange: (value: string) => void;
	onLinkClick: () => void;
	onImageClick: () => void;
	onTableClick: () => void;
	inTable: boolean;
};

/**
 * Main toolbar component with icon-based buttons
 */
export function RichTextToolbar({
	editor,
	features,
	disabled,
	headingValue,
	onHeadingChange,
	onLinkClick,
	onImageClick,
	onTableClick,
	inTable,
}: RichTextToolbarProps) {
	const { t } = useTranslation();
	const isEditable = !disabled;
	const currentAlignment = getCurrentAlignment(editor);
	const currentAlignmentOption =
		ALIGNMENT_OPTIONS.find((option) => option.value === currentAlignment) ??
		ALIGNMENT_OPTIONS[0];
	const hasMoreFormatting =
		features.underline || features.strike || features.code;
	const hasBlockMenu =
		features.bulletList ||
		features.orderedList ||
		features.blockquote ||
		features.codeBlock ||
		features.horizontalRule;
	const hasInsertMenu = features.link || features.image || features.table;

	return (
		<div
			aria-label={t("editor.richTextToolbar")}
			className="qp-rich-text-editor__toolbar border-border-subtle bg-surface-low flex flex-nowrap items-center gap-1.5 overflow-x-auto border-b p-1.5"
			role="toolbar"
		>
			{/* History Controls */}
			{features.history && (
				<ToolbarGroup>
					<ToolbarButton
						icon={EDITOR_ICONS.undo}
						disabled={!isEditable || !editor.can().undo()}
						title={t("editor.undo")}
						shortcut="⌘Z"
						onClick={() => editor.chain().focus().undo().run()}
					/>
					<ToolbarButton
						icon={EDITOR_ICONS.redo}
						disabled={!isEditable || !editor.can().redo()}
						title={t("editor.redo")}
						shortcut="⌘⇧Z"
						onClick={() => editor.chain().focus().redo().run()}
					/>
				</ToolbarGroup>
			)}

			{/* Heading Dropdown */}
			{features.heading && (
				<ToolbarGroup>
					<Select
						value={headingValue}
						disabled={!isEditable}
						onValueChange={(value) => {
							if (typeof value === "string") {
								onHeadingChange(value);
							}
						}}
					>
						<SelectTrigger
							aria-label={t("editor.blockType")}
							className="h-8 min-w-[136px] px-2.5 text-sm"
							size="sm"
						>
							<SelectValue>
								{HEADING_OPTIONS.find((option) => option.value === headingValue)
									?.value
									? getHeadingOptionLabel(
											HEADING_OPTIONS.find(
												(option) => option.value === headingValue,
											)?.value ?? "paragraph",
											t,
										)
									: t("editor.paragraph")}
							</SelectValue>
						</SelectTrigger>
						<SelectContent align="start" className="min-w-[136px]">
							<SelectGroup>
								<SelectLabel>{t("editor.textBlocks")}</SelectLabel>
								<SelectItem value="paragraph">
									{t("editor.paragraph")}
								</SelectItem>
							</SelectGroup>
							<SelectSeparator />
							<SelectGroup>
								<SelectLabel>{t("editor.headings")}</SelectLabel>
								{HEADING_OPTIONS.filter(
									(option) => option.group === "heading",
								).map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{getHeadingOptionLabel(option.value, t)}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</ToolbarGroup>
			)}

			{/* Text Formatting */}
			<ToolbarGroup>
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
				{hasMoreFormatting && (
					<DropdownMenu>
						<DropdownMenuTrigger
							nativeButton={false}
							render={
								<ToolbarButton
									icon={EDITOR_ICONS.formatting}
									active={
										editor.isActive("underline") ||
										editor.isActive("strike") ||
										editor.isActive("code")
									}
									disabled={!isEditable}
									title={t("editor.moreFormatting")}
								/>
							}
						/>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuLabel>{t("editor.formatting")}</DropdownMenuLabel>
							{features.underline && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.underline}
									active={editor.isActive("underline")}
									disabled={!isEditable}
									label={t("editor.underline")}
									shortcut="⌘U"
									onClick={() => editor.chain().focus().toggleUnderline().run()}
								/>
							)}
							{features.strike && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.strikethrough}
									active={editor.isActive("strike")}
									disabled={!isEditable}
									label={t("editor.strikethrough")}
									onClick={() => editor.chain().focus().toggleStrike().run()}
								/>
							)}
							{features.code && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.code}
									active={editor.isActive("code")}
									disabled={!isEditable}
									label={t("editor.code")}
									shortcut="⌘E"
									onClick={() => editor.chain().focus().toggleCode().run()}
								/>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</ToolbarGroup>

			{/* Lists & Blocks */}
			{hasBlockMenu && (
				<ToolbarGroup>
					<DropdownMenu>
						<DropdownMenuTrigger
							nativeButton={false}
							render={
								<ToolbarButton
									icon={EDITOR_ICONS.blocks}
									active={
										editor.isActive("bulletList") ||
										editor.isActive("orderedList") ||
										editor.isActive("blockquote") ||
										editor.isActive("codeBlock")
									}
									disabled={!isEditable}
									title={t("editor.blocks")}
								/>
							}
						/>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuLabel>{t("editor.list")}</DropdownMenuLabel>
							{features.bulletList && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.bulletList}
									active={editor.isActive("bulletList")}
									disabled={!isEditable}
									label={t("editor.unorderedList")}
									onClick={() =>
										editor.chain().focus().toggleBulletList().run()
									}
								/>
							)}
							{features.orderedList && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.orderedList}
									active={editor.isActive("orderedList")}
									disabled={!isEditable}
									label={t("editor.orderedList")}
									onClick={() =>
										editor.chain().focus().toggleOrderedList().run()
									}
								/>
							)}
							{(features.blockquote ||
								features.codeBlock ||
								features.horizontalRule) && <DropdownMenuSeparator />}
							{features.blockquote && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.blockquote}
									active={editor.isActive("blockquote")}
									disabled={!isEditable}
									label={t("editor.quote")}
									onClick={() =>
										editor.chain().focus().toggleBlockquote().run()
									}
								/>
							)}
							{features.codeBlock && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.codeBlock}
									active={editor.isActive("codeBlock")}
									disabled={!isEditable}
									label={t("editor.codeBlock")}
									onClick={() => editor.chain().focus().toggleCodeBlock().run()}
								/>
							)}
							{features.horizontalRule && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.horizontalRule}
									disabled={!isEditable}
									label={t("editor.horizontalRule")}
									onClick={() =>
										editor.chain().focus().setHorizontalRule().run()
									}
								/>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</ToolbarGroup>
			)}

			{/* Text Alignment */}
			{features.align && (
				<ToolbarGroup>
					<DropdownMenu>
						<DropdownMenuTrigger
							nativeButton={false}
							render={
								<ToolbarButton
									icon={currentAlignmentOption.icon}
									active={currentAlignment !== "left"}
									disabled={!isEditable}
									title={t("editor.alignment")}
								/>
							}
						/>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuLabel>{t("editor.alignment")}</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={currentAlignment}
								onValueChange={(value) => {
									editor
										.chain()
										.focus()
										.setTextAlign(value as AlignmentValue)
										.run();
								}}
							>
								{ALIGNMENT_OPTIONS.map((option) => (
									<DropdownMenuRadioItem
										key={option.value}
										value={option.value}
										disabled={!isEditable}
									>
										<Icon aria-hidden="true" icon={option.icon} />
										<span>{t(option.labelKey)}</span>
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</ToolbarGroup>
			)}

			{/* Media & Links */}
			{hasInsertMenu && (
				<ToolbarGroup>
					<DropdownMenu>
						<DropdownMenuTrigger
							nativeButton={false}
							render={
								<ToolbarButton
									icon={EDITOR_ICONS.insert}
									active={editor.isActive("link")}
									disabled={!isEditable}
									title={t("editor.insert")}
								/>
							}
						/>
						<DropdownMenuContent align="start" className="w-56">
							<DropdownMenuLabel>{t("editor.insert")}</DropdownMenuLabel>
							{features.link && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.link}
									active={editor.isActive("link")}
									disabled={!isEditable}
									label={t("editor.link")}
									shortcut="⌘K"
									onClick={onLinkClick}
								/>
							)}
							{features.image && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.image}
									disabled={!isEditable}
									label={t("editor.image")}
									onClick={onImageClick}
								/>
							)}
							{features.table && (
								<ToolbarMenuItem
									icon={EDITOR_ICONS.table}
									active={inTable}
									disabled={!isEditable}
									label={t("editor.table")}
									onClick={onTableClick}
								/>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
					{features.table && features.tableControls && inTable && (
						<TableControls
							editor={editor}
							disabled={!isEditable}
							inTable={inTable}
							triggerButton={
								<ToolbarButton
									icon={EDITOR_ICONS.table}
									active={inTable}
									disabled={!isEditable}
									title={t("editor.table")}
								/>
							}
						/>
					)}
				</ToolbarGroup>
			)}
		</div>
	);
}
