import { createFileRoute } from "@tanstack/react-router";

type LLMSPage = {
	slugs: string[];
	url: string;
	data: {
		title?: string;
	};
};

function generateLLMSTxt(baseUrl: string, pages: LLMSPage[]) {
	// Group pages by first slug segment (section)
	const categories = new Map<string, typeof pages>();
	for (const page of pages) {
		const category = page.slugs[0] ?? "root";
		if (!categories.has(category)) {
			categories.set(category, []);
		}
		categories.get(category)!.push(page);
	}

	// Generate structured links
	const sections: string[] = [];

	// Mirrors the top-level sections in content/docs/meta.json (root `index`
	// page lands in the "root" bucket and is intentionally omitted here).
	const sectionOrder: Array<{ key: string; title: string }> = [
		{ key: "v4", title: "QUESTPIE v4" },
	];

	for (const section of sectionOrder) {
		const sectionPages = categories.get(section.key);
		if (!sectionPages?.length) continue;

		sections.push(`## ${section.title}\n`);
		for (const page of sectionPages) {
			sections.push(`- ${page.data.title}: ${baseUrl}${page.url}.mdx`);
		}
		sections.push("");
	}

	// Any remaining categories not listed above
	const covered = new Set(sectionOrder.map((s) => s.key));
	for (const [category, categoryPages] of categories) {
		if (covered.has(category) || category === "root") continue;

		const title = category
			.split("-")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
		sections.push(`## ${title}\n`);
		for (const page of categoryPages) {
			sections.push(`- ${page.data.title}: ${baseUrl}${page.url}.mdx`);
		}
		sections.push("");
	}

	return `# QUESTPIE Documentation

> PostgreSQL-native TypeScript application compiler and runtime

QUESTPIE compiles TypeScript application definitions into one deterministic Compiled Manifest, one executable Runtime, and one concrete App Contract.

## Documentation Surfaces

- Full documentation corpus: ${baseUrl}/llms-full.txt
- Individual docs pages: ${baseUrl}/docs/{path}.mdx

${sections.join("\n")}
## Architecture Notes

- The Compiled Manifest is desired application state.
- Each resource has stable identity, one Owner, and a recorded Origin.
- PostgreSQL is part of the v4.0 product contract.
- Runtime merge order cannot change the application shape.
- Studio is an operational inspector, not a CMS Admin or Operator App framework.
`;
}

function getBaseUrl(request: Request): string {
	const url = new URL(request.url);
	const isLocalhost =
		url.hostname === "localhost" || url.hostname === "127.0.0.1";
	// Use X-Forwarded-Proto header if behind reverse proxy, force https in production
	const protocol = isLocalhost
		? "http"
		: request.headers.get("x-forwarded-proto") || "https";
	const host = request.headers.get("x-forwarded-host") || url.host;
	return `${protocol}://${host}`;
}

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { source } = await import("@/lib/source");
				const baseUrl = getBaseUrl(request);
				const pages = source.getPages() as LLMSPage[];

				return new Response(generateLLMSTxt(baseUrl, pages), {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control":
							"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					},
				});
			},
		},
	},
});
