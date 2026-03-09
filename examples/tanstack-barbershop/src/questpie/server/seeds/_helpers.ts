/**
 * Shared helpers for seed files
 */

// ============================================================================
// Image URLs
// ============================================================================

export const IMAGES = {
	// Heroes
	heroHome:
		"https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=1920&h=1080&fit=crop",
	heroServices:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=1920&h=1080&fit=crop",
	heroAbout:
		"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=1920&h=1080&fit=crop",
	heroGallery:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=1920&h=1080&fit=crop",

	// Barbers
	barber1:
		"https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop",
	barber2:
		"https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop",
	barber3:
		"https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop",
	barber4:
		"https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop",

	// Services
	serviceHaircut:
		"https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=800&h=600&fit=crop",
	serviceFade:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&h=600&fit=crop",
	serviceShave:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&h=600&fit=crop",
	serviceBeard:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&h=600&fit=crop",
	serviceKids:
		"https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&h=600&fit=crop",
	serviceGrooming:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&h=600&fit=crop",

	// About / Image-Text
	shopInterior:
		"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&h=800&fit=crop",
	shopDetail:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&h=800&fit=crop",

	// Gallery
	gallery1:
		"https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=600&h=600&fit=crop",
	gallery2:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=600&h=600&fit=crop",
	gallery3:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&h=600&fit=crop",
	gallery4:
		"https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=600&h=600&fit=crop",
	gallery5:
		"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&h=600&fit=crop",
	gallery6:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=600&h=600&fit=crop",
} as const;

// ============================================================================
// Rich Text Helpers
// ============================================================================

export function richText(paragraphs: string[]) {
	return {
		type: "doc" as const,
		content: paragraphs.map((text) => ({
			type: "paragraph",
			content: [{ type: "text", text }],
		})),
	};
}

export function richTextFormatted(
	blocks: Array<
		string | { text: string; bold?: boolean; italic?: boolean; link?: string }[]
	>,
) {
	return {
		type: "doc" as const,
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

export async function uploadImage(
	collections: any,
	url: string,
	name: string,
	ctx: any,
) {
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

	const asset = await collections.assets.upload(file, ctx);
	return asset.id as string;
}

/**
 * Upload all demo images and return a map of key -> asset ID.
 */
export async function uploadAllImages(
	collections: any,
	ctx: any,
	log: (msg: string) => void,
): Promise<Record<string, string>> {
	const img: Record<string, string> = {};
	for (const [key, url] of Object.entries(IMAGES)) {
		img[key] = await uploadImage(collections, url, key, ctx);
		log(`  uploaded ${key}`);
	}
	return img;
}
