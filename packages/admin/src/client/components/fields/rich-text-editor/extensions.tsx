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
	labels?: RichTextExtensionLabels;
	placeholder?: string;
	maxCharacters?: number;
	customExtensions?: AnyExtension[];
};

type RichTextExtensionLabels = {
	bulletList: string;
	bulletListDescription: string;
	codeBlock: string;
	codeBlockDescription: string;
	divider: string;
	dividerDescription: string;
	heading: (level: number) => string;
	heading1Description: string;
	heading2Description: string;
	heading3Description: string;
	orderedList: string;
	orderedListDescription: string;
	paragraph: string;
	paragraphDescription: string;
	quote: string;
	quoteDescription: string;
	table: string;
	tableDescription: string;
};

const defaultLabels: RichTextExtensionLabels = {
	bulletList: "Bullet list",
	bulletListDescription: "Create a bulleted list",
	codeBlock: "Code block",
	codeBlockDescription: "Insert code snippet",
	divider: "Divider",
	dividerDescription: "Insert a horizontal rule",
	heading: (level) => `Heading ${level}`,
	heading1Description: "Large section heading",
	heading2Description: "Medium section heading",
	heading3Description: "Small section heading",
	orderedList: "Numbered list",
	orderedListDescription: "Create an ordered list",
	paragraph: "Paragraph",
	paragraphDescription: "Start with plain text",
	quote: "Quote",
	quoteDescription: "Capture a quote",
	table: "Table",
	tableDescription: "Insert a 3x3 table",
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
	labels,
	placeholder,
	maxCharacters,
	customExtensions,
}: BuildExtensionsOptions): AnyExtension[] | Promise<AnyExtension[]> {
	const base = buildBaseExtensions({
		features,
		labels,
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
	labels = defaultLabels,
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
			createSlashCommandExtension((_editor) => {
				const commands: SlashCommandItem[] = [];

				if (features.heading) {
					commands.push(
						{
							title: labels.heading(1),
							description: labels.heading1Description,
							icon: "ph:text-h-one",
							keywords: ["h1"],
							command: (cmdEditor) =>
								cmdEditor.chain().focus().toggleHeading({ level: 1 }).run(),
						},
						{
							title: labels.heading(2),
							description: labels.heading2Description,
							icon: "ph:text-h-two",
							keywords: ["h2"],
							command: (cmdEditor) =>
								cmdEditor.chain().focus().toggleHeading({ level: 2 }).run(),
						},
						{
							title: labels.heading(3),
							description: labels.heading3Description,
							icon: "ph:text-h-three",
							keywords: ["h3"],
							command: (cmdEditor) =>
								cmdEditor.chain().focus().toggleHeading({ level: 3 }).run(),
						},
					);
				}

				commands.push({
					title: labels.paragraph,
					description: labels.paragraphDescription,
					icon: "ph:text-align-left",
					keywords: ["text"],
					command: (cmdEditor) =>
						cmdEditor.chain().focus().setParagraph().run(),
				});

				if (features.bulletList) {
					commands.push({
						title: labels.bulletList,
						description: labels.bulletListDescription,
						icon: "ph:list-bullets",
						keywords: ["list", "ul"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleBulletList().run(),
					});
				}

				if (features.orderedList) {
					commands.push({
						title: labels.orderedList,
						description: labels.orderedListDescription,
						icon: "ph:list-numbers",
						keywords: ["list", "ol"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleOrderedList().run(),
					});
				}

				if (features.blockquote) {
					commands.push({
						title: labels.quote,
						description: labels.quoteDescription,
						icon: "ph:quotes",
						keywords: ["blockquote"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleBlockquote().run(),
					});
				}

				if (features.codeBlock) {
					commands.push({
						title: labels.codeBlock,
						description: labels.codeBlockDescription,
						icon: "ph:code-block",
						keywords: ["code"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().toggleCodeBlock().run(),
					});
				}

				if (features.horizontalRule) {
					commands.push({
						title: labels.divider,
						description: labels.dividerDescription,
						icon: "ph:minus",
						keywords: ["hr"],
						command: (cmdEditor) =>
							cmdEditor.chain().focus().setHorizontalRule().run(),
					});
				}

				if (features.table) {
					commands.push({
						title: labels.table,
						description: labels.tableDescription,
						icon: "ph:table",
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
