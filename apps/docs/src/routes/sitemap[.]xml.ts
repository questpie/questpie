import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createFileRoute } from "@tanstack/react-router";

const execAsync = promisify(exec);

type DocsPage = {
	slugs: string[];
	url: string;
	data: {
		title?: string;
		description?: string;
	};
};

type PagePriority = {
	pattern: RegExp;
	priority: number;
	changefreq: string;
};

const pagePriorities: PagePriority[] = [
	{ pattern: /^getting-started$/, priority: 1.0, changefreq: "weekly" },
	{ pattern: /^getting-started\//, priority: 0.9, changefreq: "weekly" },
	{ pattern: /^server$/, priority: 0.9, changefreq: "weekly" },
	{ pattern: /^server\//, priority: 0.8, changefreq: "weekly" },
	{ pattern: /^client$/, priority: 0.9, changefreq: "weekly" },
	{ pattern: /^client\//, priority: 0.8, changefreq: "weekly" },
	{ pattern: /^admin$/, priority: 0.9, changefreq: "weekly" },
	{ pattern: /^admin\//, priority: 0.8, changefreq: "weekly" },
	{ pattern: /^infrastructure$/, priority: 0.8, changefreq: "monthly" },
	{ pattern: /^infrastructure\//, priority: 0.7, changefreq: "monthly" },
	{ pattern: /^guides\//, priority: 0.7, changefreq: "monthly" },
	{ pattern: /^reference\//, priority: 0.6, changefreq: "monthly" },
	{ pattern: /^examples\//, priority: 0.6, changefreq: "monthly" },
	{ pattern: /^migration\//, priority: 0.5, changefreq: "yearly" },
	{ pattern: /^mentality\//, priority: 0.6, changefreq: "monthly" },
];

function getPagePriority(slugs: string[]): {
	priority: number;
	changefreq: string;
} {
	const path = slugs.join("/");
	for (const { pattern, priority, changefreq } of pagePriorities) {
		if (pattern.test(path)) {
			return { priority, changefreq };
		}
	}
	return { priority: 0.5, changefreq: "monthly" };
}

async function getGitLastModified(filePath: string): Promise<string | null> {
	try {
		const { stdout } = await execAsync(
			`git log -1 --format="%Y-%m-%dT%H:%M:%SZ" -- "apps/docs/content/docs/${filePath}.mdx"`,
			{ cwd: process.cwd() },
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

async function generateSitemap(
	baseUrl: string,
	pages: DocsPage[],
): Promise<string> {
	const now = new Date().toISOString();
	const urlEntries: string[] = [];

	urlEntries.push(`  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${now.split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`);

	urlEntries.push(`  <url>
    <loc>${baseUrl}/docs</loc>
    <lastmod>${now.split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);

	for (const page of pages) {
		const { priority, changefreq } = getPagePriority(page.slugs);
		const lastmod = await getGitLastModified(page.slugs.join("/"));
		const loc = `${baseUrl}${page.url}`;

		urlEntries.push(`  <url>
    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod.split("T")[0]}</lastmod>` : ""}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority.toFixed(1)}</priority>
  </url>`);
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join("\n")}
</urlset>`;
}

function getBaseUrl(request: Request): string {
	const url = new URL(request.url);
	const isLocalhost =
		url.hostname === "localhost" || url.hostname === "127.0.0.1";
	const protocol = isLocalhost
		? "http"
		: request.headers.get("x-forwarded-proto") || "https";
	const host = request.headers.get("x-forwarded-host") || url.host;
	return `${protocol}://${host}`;
}

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { source } = await import("@/lib/source");
				const baseUrl = getBaseUrl(request);
				const pages = source.getPages() as DocsPage[];

				const sitemap = await generateSitemap(baseUrl, pages);

				return new Response(sitemap, {
					headers: {
						"Content-Type": "application/xml; charset=utf-8",
						"Cache-Control":
							"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					},
				});
			},
		},
	},
});
