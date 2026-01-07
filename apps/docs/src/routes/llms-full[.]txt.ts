import { createFileRoute } from "@tanstack/react-router";
import { source } from "@/lib/source";
import { getLLMText } from "@/lib/get-llm-text";

export const Route = createFileRoute("/llms-full.txt")({
	server: {
		handlers: {
			GET: async () => {
				const scan = source.getPages().map(getLLMText);
				const scanned = await Promise.all(scan);

				return new Response(scanned.join("\n\n"), {
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
