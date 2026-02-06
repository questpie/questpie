/**
 * RichText Editor Type Definitions
 */

import type { Editor, Extension as TiptapExtension } from "@tiptap/core";
import type { FieldComponentProps } from "../../../builder";
import type { RichTextPreset } from "./presets";

/**
 * Feature toggles for the RichText editor
 */
export type RichTextFeatures = {
  toolbar?: boolean;
  bubbleMenu?: boolean;
  slashCommands?: boolean;
  history?: boolean;
  heading?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  codeBlock?: boolean;
  blockquote?: boolean;
  bulletList?: boolean;
  orderedList?: boolean;
  horizontalRule?: boolean;
  align?: boolean;
  link?: boolean;
  image?: boolean;
  table?: boolean;
  tableControls?: boolean;
  characterCount?: boolean;
};

/**
 * Default feature configuration (all enabled)
 */
export const defaultFeatures: Required<RichTextFeatures> = {
  toolbar: true,
  bubbleMenu: true,
  slashCommands: true,
  history: true,
  heading: true,
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  code: true,
  codeBlock: true,
  blockquote: true,
  bulletList: true,
  orderedList: true,
  horizontalRule: true,
  align: true,
  link: true,
  image: true,
  table: true,
  tableControls: true,
  characterCount: true,
};

/**
 * Props for the RichTextEditor component
 */
export interface RichTextEditorProps extends FieldComponentProps<any> {
  /**
   * Custom Tiptap extensions
   */
  extensions?: TiptapExtension[];

  /**
   * Preset configuration (minimal, simple, standard, advanced)
   * Can be overridden by features prop
   */
  preset?: RichTextPreset;

  /**
   * Feature toggles (overrides preset)
   */
  features?: RichTextFeatures;

  /**
   * Show character count
   */
  showCharacterCount?: boolean;

  /**
   * Max character limit
   */
  maxCharacters?: number;

  /**
   * Enable image uploads
   */
  enableImages?: boolean;

  /**
   * Image upload handler
   */
  onImageUpload?: (file: File) => Promise<string>;

  /**
   * Target collection for image uploads
   */
  imageCollection?: string;

  /**
   * Enable media library picker for images
   */
  enableMediaLibrary?: boolean;
}

/**
 * Output value type (always TipTap JSON)
 */
export type OutputValue = Record<string, any>;

/**
 * Slash command item
 */
export type SlashCommandItem = {
  title: string;
  description?: string;
  keywords?: string[];
  command: (editor: Editor) => void;
};

/**
 * Slash command list props
 */
export type SlashCommandListProps = {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
};

/**
 * Slash command list handle (ref API)
 */
export type SlashCommandListHandle = {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
};
