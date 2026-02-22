import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createFileRoute } from "@tanstack/react-router";
import { siteConfig } from "@/lib/seo";

const execAsync = promisify(exec);

type DocsPage = {
	slugs: string[];
	url: string;
	data: {
		title?: string;
		description?: string;
	};
};

async function getGitLastModified(filePath: string): Promise<Date | null> {
	try {
		const { stdout } = await execAsync(
			`git log -1 --format="%aI" -- "apps/docs/content/docs/${filePath}.mdx"`,
			{ cwd: process.cwd() },
		);
		const iso = stdout.trim();
		return iso ? new Date(iso) : null;
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

function formatRfc822(date: Date): string {
	return date.toUTCString();
}

async function generateRssFeed(
	baseUrl: string,
	pages: DocsPage[],
): Promise<string> {
	const now = new Date();
	const items: string[] = [];

	const sortedPages = await Promise.all(
		pages.map(async (page) => {
			const gitDate = await getGitLastModified(page.slugs.join("/"));
			return { page, date: gitDate ?? now };
		}),
	);

	sortedPages.sort((a, b) => b.date.getTime() - a.date.getTime());

	const recentPages = sortedPages.slice(0, 50);

	for (const { page, date } of recentPages) {
		const title = page.data.title ?? "Untitled";
		const description = page.data.description ?? "";
		const url = `${baseUrl}${page.url}`;

		items.push(`    <item>
      <title>${escapeXml(title)}</title>
      <description>${escapeXml(description)}</description>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${formatRfc822(date)}</pubDate>
    </item>`);
	}

	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(siteConfig.name)} Documentation</title>
    <description>${escapeXml(siteConfig.description)}</description>
    <link>${escapeXml(baseUrl)}/docs</link>
    <atom:link href="${escapeXml(baseUrl)}/rss.xml" rel="self" type="application/rss+xml"/>
    <language>en-us</language>
    <lastBuildDate>${formatRfc822(now)}</lastBuildDate>
    <generator>QUESTPIE RSS Generator</generator>
${items.join("\n")}
  </channel>
</rss>`;
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

export const Route = createFileRoute("/rss.xml")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { source } = await import("@/lib/source");
				const baseUrl = getBaseUrl(request);
				const pages = source.getPages() as DocsPage[];

				const feed = await generateRssFeed(baseUrl, pages);

				return new Response(feed, {
					headers: {
						"Content-Type": "application/rss+xml; charset=utf-8",
						"Cache-Control":
							"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					},
				});
			},
		},
	},
});
