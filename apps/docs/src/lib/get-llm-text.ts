import type { InferPageType } from "fumadocs-core/source";

import type { source } from "@/lib/source";

export async function getLLMText(page: InferPageType<typeof source>) {
	const data = page.data as {
		getText?: (type: "raw" | "processed") => Promise<string>;
		structuredData?: {
			contents?: Array<{ content?: string }>;
		};
	};

	let content = "";

	/*
	 * `getText` opens the source .mdx from disk, so it fails whenever the markdown
	 * is not deployed beside the bundle. The raw fallback used to sit outside the
	 * try, so when both calls threw the error escaped and the route answered 500
	 * for every page. Structured data is bundled and always available, which makes
	 * a degraded answer better than no answer.
	 */
	if (typeof data.getText === "function") {
		for (const variant of ["processed", "raw"] as const) {
			try {
				content = await data.getText(variant);
				if (content) break;
			} catch {
				// Try the next variant, then fall through to structured data.
			}
		}
	}

	if (!content && data.structuredData?.contents) {
		content = data.structuredData.contents
			.map((entry) => entry.content ?? "")
			.filter(Boolean)
			.join("\n\n");
	}

	return `# ${page.data.title ?? "Untitled"} (${page.url})

${content}`;
}
