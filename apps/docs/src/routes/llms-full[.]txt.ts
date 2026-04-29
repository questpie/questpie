import { createFileRoute } from "@tanstack/react-router";

import { getLLMText } from "@/lib/get-llm-text";

export const Route = createFileRoute("/llms-full.txt")({
	server: {
		handlers: {
			GET: async () => {
				const { source } = await import("@/lib/source");
				const scan = source.getPages().map(getLLMText);
				const scanned = await Promise.all(scan);
				const intro = `# QUESTPIE Documentation (Full Corpus)

> Server-first TypeScript backend platform

QUESTPIE models schema, access, and workflows on the server, emits introspection, and projects APIs plus interfaces from one source of truth.`;

				return new Response(`${intro}\n\n${scanned.join("\n\n")}`, {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						// Cache for long time since docs don't change often
						"Cache-Control":
							"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					},
				});
			},
		},
	},
});
