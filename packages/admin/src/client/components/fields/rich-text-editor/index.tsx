/**
 * RichTextEditor Component
 *
 * Tiptap-based rich text editor with modern icon-based toolbar.
 */

import { EditorContent, useEditor } from "@tiptap/react";
import * as React from "react";

import { useResolveText } from "../../../i18n/hooks";
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

export type { RichTextPreset } from "./presets";
// Re-export types
export type { RichTextEditorProps, RichTextFeatures } from "./types";

// Re-export variant components
export {
  RichTextAdvanced,
  RichTextMinimal,
  RichTextSimple,
  RichTextStandard,
} from "./variants";

/**
 * Main RichText Editor Component
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
  const resolveText = useResolveText();
  const resolvedLabel = label ? resolveText(label) : undefined;
  const resolvedDescription = description
    ? resolveText(description)
    : undefined;

  // Popover states
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [imageOpen, setImageOpen] = React.useState(false);
  const lastEmittedValueRef = React.useRef<OutputValue | undefined>(undefined);

  // Resolved feature flags with preset support
  const resolvedFeatures = React.useMemo(() => {
    // If preset is specified, merge with features
    if (preset) {
      return mergePresetFeatures(preset, features);
    }
    // Otherwise use default features + overrides
    return {
      ...defaultFeatures,
      ...features,
    };
  }, [preset, features]);

  const allowImages = resolvedFeatures.image && (enableImages ?? true);
  const allowLinks = resolvedFeatures.link;
  const allowTables = resolvedFeatures.table;
  const allowBubbleMenu = resolvedFeatures.bubbleMenu;
  const allowToolbar = resolvedFeatures.toolbar;
  const allowCharacterCount =
    resolvedFeatures.characterCount && (showCharacterCount || maxCharacters);

  // Build Tiptap extensions
  const resolvedExtensions = React.useMemo(
    () =>
      buildExtensions({
        features: resolvedFeatures,
        placeholder,
        maxCharacters,
        customExtensions: extensions,
      }),
    [resolvedFeatures, placeholder, maxCharacters, extensions],
  );

  // Initialize editor
  const editor = useEditor({
    extensions: resolvedExtensions,
    content: value ?? "",
    editorProps: {
      attributes: {
        class: "qp-rich-text-editor__content",
      },
    },
    editable: !disabled && !readOnly,
    onUpdate: ({ editor: currentEditor }) => {
      if (disabled || readOnly) return;
      const nextValue = getOutput(currentEditor);
      lastEmittedValueRef.current = nextValue as OutputValue;
      onChange?.(nextValue);
    },
  });

  const isEditable = !disabled && !readOnly;
  const headingValue = getHeadingLevel(editor);
  const inTable = editor?.isActive("table") ?? false;

  // Update editor editable state
  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(isEditable);
  }, [editor, isEditable]);

  // Sync external value changes
  React.useEffect(() => {
    if (!editor) return;
    if (value === undefined) return;
    if (isSameValue(value, lastEmittedValueRef.current)) {
      return;
    }
    lastEmittedValueRef.current = value as OutputValue;
    editor.commands.setContent(value ?? "", false);
  }, [editor, value]);

  // Character count
  const characterCount = getCharacterCount(editor);

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

      <div
        className={cn(
          "qp-rich-text-editor rounded-md border border-input/80 bg-input/20 backdrop-blur-sm",
          disabled || readOnly ? "opacity-60" : "",
          error ? "border-destructive" : "border-input",
        )}
      >
        {/* Toolbar */}
        {editor && allowToolbar && (
          <RichTextToolbar
            editor={editor}
            features={resolvedFeatures}
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
            features={resolvedFeatures}
            disabled={!isEditable}
            onLinkClick={() => setLinkOpen(true)}
          />
        )}

        {/* Editor Content */}
        <EditorContent editor={editor} id={name} />

        {/* Character Count */}
        {allowCharacterCount && showCharacterCount && (
          <div className="flex items-center justify-between border-t bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
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

      {/* Description & Error */}
      {resolvedDescription && (
        <p className="text-muted-foreground text-xs">{resolvedDescription}</p>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
