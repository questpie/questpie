/**
 * Seed Helper Functions
 *
 * Utilities for creating seed data.
 */

import { app } from "../src/questpie/server/app";

// ============================================================================
// Rich Text Helpers
// ============================================================================

/**
 * Create a simple TipTap rich text document from paragraphs
 */
export function richText(paragraphs: string[]) {
	return {
		type: "doc",
		content: paragraphs.map((text) => ({
			type: "paragraph",
			content: [{ type: "text", text }],
		})),
	};
}

/**
 * Create formatted TipTap rich text with bold, italic, links
 */
export function richTextFormatted(
	blocks: Array<
		string | { text: string; bold?: boolean; italic?: boolean; link?: string }[]
	>,
) {
	return {
		type: "doc",
		content: blocks.map((block) => {
			if (typeof block === "string") {
				return {
					type: "paragraph",
					content: [{ type: "text", text: block }],
				};
			}
			return {
				type: "paragraph",
				content: block.map((part) => {
					const marks: Array<{ type: string; attrs?: Record<string, any> }> =
						[];
					if (part.bold) marks.push({ type: "bold" });
					if (part.italic) marks.push({ type: "italic" });
					if (part.link)
						marks.push({
							type: "link",
							attrs: { href: part.link, target: "_blank" },
						});
					return { type: "text", text: part.text, marks };
				}),
			};
		}),
	};
}

// ============================================================================
// Upload Helper
// ============================================================================

/**
 * Download and upload an image to the app
 */
export async function uploadImage(url: string, name: string, ctx: any) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download image: ${url}`);
	}

	const contentType = response.headers.get("content-type") || "image/jpeg";
	const extension = contentType.includes("png") ? "png" : "jpg";
	const buffer = await response.arrayBuffer();
	const file = new File([buffer], `${name}.${extension}`, {
		type: contentType,
	});

	const asset = await app.api.collections.assets.upload(file, ctx);
	return asset.id as string;
}

// ============================================================================
// Types
// ============================================================================

export interface SeedContext {
	en: any;
	sk: any;
}

export interface UploadedImages {
	[key: string]: string;
}
