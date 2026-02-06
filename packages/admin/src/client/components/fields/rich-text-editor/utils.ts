/**
 * RichText Editor Utility Functions
 */

import type { Editor } from "@tiptap/core";

import type { OutputValue } from "./types";

/**
 * Get the current heading level or "paragraph"
 */
export function getHeadingLevel(editor: Editor | null): string {
  if (!editor) return "paragraph";
  for (let level = 1; level <= 6; level += 1) {
    if (editor.isActive("heading", { level })) {
      return String(level);
    }
  }
  return "paragraph";
}

/**
 * Get output as TipTap JSON.
 */
export function getOutput(editor: Editor): OutputValue {
  return editor.getJSON();
}

/**
 * Compare two output values for equality
 */
export function isSameValue(
  a: OutputValue | undefined,
  b: OutputValue | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Get character and word count from editor
 */
export function getCharacterCount(editor: Editor | null): {
  characters: number;
  words: number;
} {
  if (!editor) return { characters: 0, words: 0 };
  const storage = editor.storage as any;
  if (storage?.characterCount) {
    return {
      characters: storage.characterCount.characters(),
      words: storage.characterCount.words(),
    };
  }
  const text = editor.getText();
  const words = text.trim().length ? text.trim().split(/\s+/).length : 0;
  return { characters: text.length, words };
}
