import { createFileRoute, notFound } from "@tanstack/react-router";
import { source } from "@/lib/source";
import { getLLMText } from "@/lib/get-llm-text";

export const Route = createFileRoute("/llms.mdx/docs/$")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const slugs = params._splat?.split("/") ?? [];
				const page = source.getPage(slugs);
				if (!page) throw notFound();

				return new Response(await getLLMText(page), {
					headers: {
						"Content-Type": "text/markdown; charset=utf-8",
						// Cache for long time since docs don't change often
						"Cache-Control":
							"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					},
				});
			},
		},
	},
});
