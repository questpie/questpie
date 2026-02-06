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
} as const;

export type ToolbarButtonProps = {
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
  const tooltipText = React.useMemo(() => {
    if (!title && !shortcut) return undefined;
    if (shortcut) return `${title || ""} (${shortcut})`.trim();
    return title;
  }, [title, shortcut]);

  const iconSuffix = active ? "-fill" : "";
  const buttonSize = iconName ? "icon-xs" : "xs";

  return (
    <Button
      type="button"
      variant="ghost"
      size={buttonSize}
      data-active={active}
      title={tooltipText}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-transparent",
        "data-[active=true]:text-foreground data-[active=true]:bg-transparent",
        "aria-expanded:bg-transparent",
        className,
      )}
      {...rest}
    >
      {iconName ? (
        <Icon icon={`${iconName}${iconSuffix}`} width={16} height={16} />
      ) : (
        children
      )}
    </Button>
  );
}

/**
 * Toolbar button group with divider
 */
export function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

export type RichTextToolbarProps = {
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

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 p-1.5">
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
          <select
            className="h-6 rounded-sm border border-input/80 bg-input/20 px-2 text-xs"
            value={headingValue}
            onChange={(event) => onHeadingChange(event.target.value)}
            disabled={!isEditable}
          >
            <option value="paragraph">Paragraph</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
            <option value="4">Heading 4</option>
            <option value="5">Heading 5</option>
            <option value="6">Heading 6</option>
          </select>
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
        {features.strike && (
          <ToolbarButton
            icon={EDITOR_ICONS.strikethrough}
            active={editor.isActive("strike")}
            disabled={!isEditable}
            title={t("editor.strikethrough")}
            onClick={() => editor.chain().focus().toggleStrike().run()}
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
        {features.codeBlock && (
          <ToolbarButton
            icon={EDITOR_ICONS.codeBlock}
            active={editor.isActive("codeBlock")}
            disabled={!isEditable}
            title={t("editor.codeBlock")}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
        )}
      </ToolbarGroup>

      {/* Lists & Blocks */}
      <ToolbarGroup>
        {features.bulletList && (
          <ToolbarButton
            icon={EDITOR_ICONS.bulletList}
            active={editor.isActive("bulletList")}
            disabled={!isEditable}
            title={t("editor.unorderedList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
        )}
        {features.orderedList && (
          <ToolbarButton
            icon={EDITOR_ICONS.orderedList}
            active={editor.isActive("orderedList")}
            disabled={!isEditable}
            title={t("editor.orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
        )}
        {features.blockquote && (
          <ToolbarButton
            icon={EDITOR_ICONS.blockquote}
            active={editor.isActive("blockquote")}
            disabled={!isEditable}
            title={t("editor.quote")}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          />
        )}
        {features.horizontalRule && (
          <ToolbarButton
            icon={EDITOR_ICONS.horizontalRule}
            disabled={!isEditable}
            title={t("editor.horizontalRule")}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          />
        )}
      </ToolbarGroup>

      {/* Text Alignment */}
      {features.align && (
        <ToolbarGroup>
          <ToolbarButton
            icon={EDITOR_ICONS.alignLeft}
            active={editor.isActive({ textAlign: "left" })}
            disabled={!isEditable}
            title={t("editor.alignLeft")}
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          />
          <ToolbarButton
            icon={EDITOR_ICONS.alignCenter}
            active={editor.isActive({ textAlign: "center" })}
            disabled={!isEditable}
            title={t("editor.alignCenter")}
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          />
          <ToolbarButton
            icon={EDITOR_ICONS.alignRight}
            active={editor.isActive({ textAlign: "right" })}
            disabled={!isEditable}
            title={t("editor.alignRight")}
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
          />
          <ToolbarButton
            icon={EDITOR_ICONS.alignJustify}
            active={editor.isActive({ textAlign: "justify" })}
            disabled={!isEditable}
            title={t("editor.alignJustify")}
            onClick={() => editor.chain().focus().setTextAlign("justify").run()}
          />
        </ToolbarGroup>
      )}

      {/* Media & Links */}
      <ToolbarGroup>
        {features.link && (
          <ToolbarButton
            icon={EDITOR_ICONS.link}
            active={editor.isActive("link")}
            disabled={!isEditable}
            title={t("editor.link")}
            shortcut="⌘K"
            onClick={onLinkClick}
          />
        )}
        {features.image && (
          <ToolbarButton
            icon={EDITOR_ICONS.image}
            disabled={!isEditable}
            title={t("editor.image")}
            onClick={onImageClick}
          />
        )}
        {features.table &&
          (features.tableControls ? (
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
          ) : (
            <ToolbarButton
              icon={EDITOR_ICONS.table}
              active={inTable}
              disabled={!isEditable}
              title={t("editor.table")}
              onClick={onTableClick}
            />
          ))}
      </ToolbarGroup>
    </div>
  );
}
