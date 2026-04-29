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

	const sectionOrder: Array<{ key: string; title: string }> = [
		{ key: "start-here", title: "Start Here" },
		{ key: "backend", title: "Build Your Backend" },
		{ key: "workspace", title: "Admin Workspace" },
		{ key: "frontend", title: "Client Integration" },
		{ key: "production", title: "Production" },
		{ key: "extend", title: "Extend" },
		{ key: "examples", title: "Examples" },
		{ key: "reference", title: "API Reference" },
		{ key: "getting-started", title: "Platform Quickstart" },
		{ key: "mentality", title: "Architecture Principles" },
		{ key: "server", title: "Server Model" },
		{ key: "infrastructure", title: "Infrastructure Modules" },
		{ key: "client", title: "Client Projections" },
		{ key: "admin", title: "Admin Interface" },
		{ key: "guides", title: "Guides" },
		{ key: "migration", title: "Migration" },
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

> Server-first TypeScript backend platform

QUESTPIE helps you model schema, access, and workflows once, then uses introspection to project APIs, realtime streams, typed clients, and interfaces from the same server model.

## Documentation Surfaces

- Full documentation corpus: ${baseUrl}/llms-full.txt
- Individual docs pages: ${baseUrl}/docs/{path}.mdx

${sections.join("\n")}
## Architecture Notes

- Schema is the source of truth for data and behavior.
- Introspection is the contract between server model and interfaces.
- Runtime projections expose REST, routes, realtime, and typed clients.
- Interfaces (admin and custom apps) resolve these projections via registries.
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
