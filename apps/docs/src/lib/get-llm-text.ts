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

	if (typeof data.getText === "function") {
		try {
			content = await data.getText("processed");
		} catch {
			content = await data.getText("raw");
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
