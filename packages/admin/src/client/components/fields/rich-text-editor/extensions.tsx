/**
 * Tiptap Extensions Configuration
 *
 * Factory functions for creating and configuring Tiptap extensions.
 *
 * `buildExtensions` returns synchronously when codeBlock is disabled (most
 * editors), so the editor mounts on the very first render — no loading state.
 * When codeBlock IS enabled, lowlight is lazy-loaded once and cached at module
 * level, making subsequent builds instant.
 */

import type { AnyExtension } from "@tiptap/core";
import CharacterCount from "@tiptap/extension-character-count";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";

import { createSlashCommandExtension } from "./slash-commands";
import type { RichTextFeatures, SlashCommandItem } from "./types";

// ============================================================================
// Module-level lowlight cache — loaded once, reused forever
// ============================================================================

let codeBlockExtension: AnyExtension | null = null;
let codeBlockLoadPromise: Promise<AnyExtension> | null = null;

/**
 * Returns the cached CodeBlockLowlight extension synchronously if already
 * loaded, otherwise starts a single shared fetch and returns the promise.
 */
function getCodeBlockExtension(): AnyExtension | Promise<AnyExtension> {
	if (codeBlockExtension) return codeBlockExtension;

	if (!codeBlockLoadPromise) {
		codeBlockLoadPromise = Promise.all([
			import("@tiptap/extension-code-block-lowlight"),
			import("lowlight"),
		]).then(([{ default: CodeBlockLowlight }, { common, createLowlight }]) => {
			const lowlight = createLowlight(common);
			codeBlockExtension = CodeBlockLowlight.configure({ lowlight });
			return codeBlockExtension;
		});
	}

	return codeBlockLoadPromise;
}

// ============================================================================
// Extension builder
// ============================================================================

type BuildExtensionsOptions = {
	features: Required<RichTextFeatures>;
	placeholder?: string;
	maxCharacters?: number;
	customExtensions?: AnyExtension[];
};

/**
 * Build Tiptap extensions based on feature configuration.
 *
 * Returns **synchronously** (`AnyExtension[]`) when no async deps are needed
 * (i.e. codeBlock disabled, or lowlight already cached). Only returns a
 * `Promise` on the first build that includes codeBlock.
 */
export function buildExtensions({
	features,
	placeholder,
	maxCharacters,
	customExtensions,
}: BuildExtensionsOptions): AnyExtension[] | Promise<AnyExtension[]> {
	const base = buildBaseExtensions({
		features,
		placeholder,
		maxCharacters,
		customExtensions,
	});

	if (!features.codeBlock) return base;

	const codeBlock = getCodeBlockExtension();

	// Cached — return sync
	if (!((codeBlock as any) instanceof Promise)) {
		return [...base, codeBlock as AnyExtension];
	}

	// First load — async
	return (codeBlock as Promise<AnyExtension>).then((ext) => [...base, ext]);
}

// ============================================================================
// Sync base extension builder (everything except lowlight)
// ============================================================================

function buildBaseExtensions({
	features,
	placeholder,
	maxCharacters,
	customExtensions,
}: BuildExtensionsOptions): AnyExtension[] {
	const starterKitConfig: Record<string, any> = {
		codeBlock: false,
	};

	if (!features.bold) starterKitConfig.bold = false;
	if (!features.italic) starterKitConfig.italic = false;
	if (!features.strike) starterKitConfig.strike = false;
	if (!features.code) starterKitConfig.code = false;
	if (!features.blockquote) starterKitConfig.blockquote = false;
	if (!features.heading) starterKitConfig.heading = false;
	if (!features.bulletList) starterKitConfig.bulletList = false;
	if (!features.orderedList) starterKitConfig.orderedList = false;
	if (!features.bulletList && !features.orderedList) {
		starterKitConfig.listItem = false;
	}
	if (!features.horizontalRule) starterKitConfig.horizontalRule = false;
	if (!features.history) starterKitConfig.history = false;

	const extensions: AnyExtension[] = [
		StarterKit.configure(starterKitConfig),
		Placeholder.configure({
			placeholder: placeholder || "Start writing...", // Fallback; parent should pass translated string
		}),
	];

	if (features.underline) {
		extensions.push(Underline);
	}

	if (features.link) {
		extensions.push(
			Link.configure({
				openOnClick: false,
				autolink: true,
				linkOnPaste: true,
			}),
		);
	}

	if (features.align) {
		extensions.push(TextAlign.configure({ types: ["heading", "paragraph"] }));
	}

	if (features.image) {
		extensions.push(Image);
	}

	if (features.table) {
		extensions.push(
			Table.configure({ resizable: true }),
			TableRow,
			TableHeader,
			TableCell,
		);
	}

	if (features.characterCount && maxCharacters) {
		extensions.push(
			CharacterCount.configure({
				limit: maxCharacters,
			}),
		);
	}

	if (features.slashCommands) {
		extensions.push(
			createSlashCommandExtension((editor) => {
				const commands: SlashCommandItem[] = [];

				if (features.heading) {
					commands.push(
						{
							title: "Heading 1",
							description: "Large section heading",
							keywords: ["h1"],
							command: (cmdEditor) =>
								cmdEditor.chain().focus().toggleHeading({ level: 1 }).run(),
						},
						{
							title: "Heading 2",
							description: "Medium section heading",
							keywords: ["h2"],
							command: (cmdEditor) =>
								cmdEditor.chain().focus().toggleHeading({ level: 2 }).run(),
						},
						{
							title: "Heading 3",
							description: "Small section heading",
							keywords: ["h3"],
							command: (cmdEditor) =>
								cmdEditor.chain().focus().toggleHeading({ level: 3 }).run(),
						},
					);
				}

				commands.push({
					title: "Paragraph",
					description: "Start with plain text",
					keywords: ["text"],
					command: (cmdEditor) =>
						cmdEditor.chain().focus().setParagraph().run(),
				});

				if (features.bulletList) {
					commands.push({
						title: "Bullet list",
						description: "Create a bulleted list",
						keywords: ["list", "ul"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleBulletList().run(),
					});
				}

				if (features.orderedList) {
					commands.push({
						title: "Numbered list",
						description: "Create an ordered list",
						keywords: ["list", "ol"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleOrderedList().run(),
					});
				}

				if (features.blockquote) {
					commands.push({
						title: "Quote",
						description: "Capture a quote",
						keywords: ["blockquote"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleBlockquote().run(),
					});
				}

				if (features.codeBlock) {
					commands.push({
						title: "Code block",
						description: "Insert code snippet",
						keywords: ["code"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleCodeBlock().run(),
					});
				}

				if (features.horizontalRule) {
					commands.push({
						title: "Divider",
						description: "Insert a horizontal rule",
						keywords: ["hr"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().setHorizontalRule().run(),
					});
				}

				if (features.table) {
					commands.push({
						title: "Table",
						description: "Insert a 3x3 table",
						keywords: ["grid"],
						command: (cmdEditor) =>
							cmdEditor
								.chain()
								.focus()
								.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
								.run(),
					});
				}

				return commands;
			}),
		);
	}

	if (customExtensions?.length) {
		extensions.push(...customExtensions);
	}

	return extensions;
}
