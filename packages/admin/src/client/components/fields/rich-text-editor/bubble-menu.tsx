/**
 * Bubble Menu Component
 *
 * Floating toolbar that appears on text selection.
 */

import type { Editor } from "@tiptap/core";
import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react";
import * as React from "react";

import { useTranslation } from "../../../i18n/hooks";
import { EDITOR_ICONS, ToolbarButton } from "./toolbar";
import type { RichTextFeatures } from "./types";

export type RichTextBubbleMenuProps = {
  editor: Editor;
  features: Required<RichTextFeatures>;
  disabled?: boolean;
  onLinkClick: () => void;
};

/**
 * Bubble menu that appears on text selection
 */
export function RichTextBubbleMenu({
  editor,
  features,
  disabled,
  onLinkClick,
}: RichTextBubbleMenuProps) {
  const { t } = useTranslation();
  const isEditable = !disabled;

  return (
    <TiptapBubbleMenu
      editor={editor}
      className="flex items-center gap-1 rounded-md border bg-background p-1 shadow-lg"
    >
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
    </TiptapBubbleMenu>
  );
}
