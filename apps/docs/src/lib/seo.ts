/**
 * SEO configuration and helpers for QUESTPIE docs + landing
 */

export const siteConfig = {
	name: "QUESTPIE",
	title: "QUESTPIE — One backend. Ship everywhere.",
	description:
		"Server-first TypeScript framework. Define your schema once, ship REST, RPC, realtime, typed clients, and optional admin UI. Open source.",
	url: "https://questpie.com",
	ogImage: "/og-questpie.png",
	twitterHandle: "@questpie",
	githubUrl: "https://github.com/questpie/questpie",
	keywords: [
		"questpie",
		"typescript backend platform",
		"server-first typescript",
		"schema introspection",
		"introspection contract",
		"runtime projections",
		"typed rest api",
		"field builder",
		"registry-first",
		"typed rpc",
		"realtime sse",
		"typed client sdk",
		"admin framework",
		"typescript backend framework",
		"headless backend",
		"hono",
		"elysia",
		"nextjs adapter",
		"drizzle orm",
		"content platform",
	],
} as const;

export type SeoProps = {
	title?: string;
	description?: string;
	url?: string;
	image?: string;
	type?: "website" | "article";
	noIndex?: boolean;
	keywords?: string[];
	publishedTime?: string;
	modifiedTime?: string;
	section?: string;
	tags?: string[];
};

export function absoluteUrl(path: string): string {
	if (path.startsWith("http://") || path.startsWith("https://")) return path;
	if (path.startsWith("/")) return `${siteConfig.url}${path}`;
	return `${siteConfig.url}/${path}`;
}

/**
 * Generate meta tags for a page.
 */
export function generateMeta(props: SeoProps = {}) {
	const {
		title = siteConfig.title,
		description = siteConfig.description,
		url = siteConfig.url,
		image = siteConfig.ogImage,
		type = "website",
		noIndex = false,
		keywords,
		publishedTime,
		modifiedTime,
		section,
		tags,
	} = props;

	const fullTitle =
		title === siteConfig.title ? title : `${title} | ${siteConfig.name}`;
	const canonical = absoluteUrl(url);
	const fullImageUrl = absoluteUrl(image);
	const mergedKeywords = Array.from(
		new Set([...(keywords ?? []), ...siteConfig.keywords]),
	);

	const robotsContent = noIndex
		? "noindex, nofollow"
		: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

	const meta: Array<Record<string, string>> = [
		{ title: fullTitle },
		{ name: "description", content: description },
		{ name: "keywords", content: mergedKeywords.join(", ") },
		{ name: "robots", content: robotsContent },
		{ name: "author", content: siteConfig.name },
		{ name: "publisher", content: siteConfig.name },
		{ name: "application-name", content: siteConfig.name },
		{ name: "theme-color", content: "#B700FF" },
		{ name: "color-scheme", content: "light dark" },

		{ property: "og:type", content: type },
		{ property: "og:site_name", content: siteConfig.name },
		{ property: "og:title", content: fullTitle },
		{ property: "og:description", content: description },
		{ property: "og:url", content: canonical },
		{ property: "og:image", content: fullImageUrl },
		{ property: "og:image:width", content: "2400" },
		{ property: "og:image:height", content: "1260" },
		{ property: "og:image:type", content: "image/png" },
		{
			property: "og:image:alt",
			content: `${siteConfig.name} - ${description}`,
		},
		{ property: "og:locale", content: "en_US" },

		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:site", content: siteConfig.twitterHandle },
		{ name: "twitter:creator", content: siteConfig.twitterHandle },
		{ name: "twitter:title", content: fullTitle },
		{ name: "twitter:description", content: description },
		{ name: "twitter:image", content: fullImageUrl },
		{
			name: "twitter:image:alt",
			content: `${siteConfig.name} - ${description}`,
		},
		{ name: "twitter:url", content: canonical },

		{ name: "apple-mobile-web-app-capable", content: "yes" },
		{ name: "apple-mobile-web-app-status-bar-style", content: "default" },
		{ name: "apple-mobile-web-app-title", content: siteConfig.name },
	];

	if (type === "article") {
		if (publishedTime) {
			meta.push({ property: "article:published_time", content: publishedTime });
		}
		if (modifiedTime) {
			meta.push({ property: "article:modified_time", content: modifiedTime });
		}
		if (section) {
			meta.push({ property: "article:section", content: section });
		}
		if (tags && tags.length > 0) {
			for (const tag of tags) {
				meta.push({ property: "article:tag", content: tag });
			}
		}
	}

	return meta;
}

/**
 * Generate link tags (canonical, favicon, css, etc.)
 */
export function generateLinks(
	props: {
		url?: string;
		cssUrl?: string;
		includeCanonical?: boolean;
		includeIcons?: boolean;
		includePreconnect?: boolean;
	} = {},
) {
	const {
		url = siteConfig.url,
		cssUrl,
		includeCanonical = true,
		includeIcons = true,
		includePreconnect = true,
	} = props;

	const links: Array<Record<string, string>> = [
		...(includeCanonical ? [{ rel: "canonical", href: absoluteUrl(url) }] : []),
		...(includeIcons
			? [
					{
						rel: "icon",
						type: "image/svg+xml",
						href: "/favicon.svg",
					},
					{
						rel: "icon",
						type: "image/png",
						href: "/favicon-32.png",
						sizes: "32x32",
					},
					{
						rel: "icon",
						type: "image/png",
						href: "/favicon-16.png",
						sizes: "16x16",
					},
					{
						rel: "apple-touch-icon",
						href: "/apple-touch-icon.png",
						sizes: "180x180",
					},
					{
						rel: "mask-icon",
						href: "/favicon.svg",
						color: "#B700FF",
					},
					{
						rel: "manifest",
						href: "/site.webmanifest",
					},
				]
			: []),
		...(includePreconnect
			? [{ rel: "dns-prefetch", href: "https://github.com" }]
			: []),
	];

	if (cssUrl) {
		links.push({ rel: "stylesheet", href: cssUrl });
	}

	return links;
}

/**
 * JSON-LD for landing + website entity.
 */
export function generateJsonLd(props: SeoProps = {}) {
	const {
		title = siteConfig.title,
		description = siteConfig.description,
		url = siteConfig.url,
	} = props;

	const canonical = absoluteUrl(url);

	return {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "Organization",
				"@id": `${siteConfig.url}/#organization`,
				name: siteConfig.name,
				url: siteConfig.url,
				logo: {
					"@type": "ImageObject",
					url: `${siteConfig.url}/favicon-512.png`,
					width: 512,
					height: 512,
				},
				sameAs: [siteConfig.githubUrl],
			},
			{
				"@type": "WebSite",
				"@id": `${siteConfig.url}/#website`,
				name: siteConfig.name,
				url: siteConfig.url,
				description: siteConfig.description,
				inLanguage: "en-US",
				potentialAction: {
					"@type": "SearchAction",
					target: `${siteConfig.url}/docs?q={search_term_string}`,
					"query-input": "required name=search_term_string",
				},
			},
			{
				"@type": "SoftwareApplication",
				"@id": `${siteConfig.url}/#software`,
				name: siteConfig.name,
				applicationCategory: "DeveloperApplication",
				operatingSystem: "Any",
				description,
				url: siteConfig.url,
				codeRepository: siteConfig.githubUrl,
				programmingLanguage: ["TypeScript", "JavaScript"],
				runtimePlatform: ["Bun", "Node.js"],
				offers: {
					"@type": "Offer",
					price: "0",
					priceCurrency: "USD",
				},
			},
			{
				"@type": "WebPage",
				"@id": `${canonical}#webpage`,
				name: title,
				description,
				url: canonical,
				isPartOf: { "@id": `${siteConfig.url}/#website` },
				about: { "@id": `${siteConfig.url}/#software` },
			},
		],
	};
}

/**
 * JSON-LD for documentation pages.
 */
export function generateDocsJsonLd(props: {
	title: string;
	description: string;
	url: string;
	dateModified?: string;
}) {
	const canonical = absoluteUrl(props.url);

	const jsonLd: Record<string, unknown> = {
		"@context": "https://schema.org",
		"@type": "TechArticle",
		headline: props.title,
		description: props.description,
		url: canonical,
		inLanguage: "en-US",
		author: {
			"@type": "Organization",
			name: siteConfig.name,
			url: siteConfig.url,
		},
		publisher: {
			"@type": "Organization",
			name: siteConfig.name,
			logo: {
				"@type": "ImageObject",
				url: `${siteConfig.url}/favicon-512.png`,
			},
		},
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": canonical,
		},
	};

	if (props.dateModified) {
		jsonLd.dateModified = props.dateModified;
	}

	return jsonLd;
}

type BreadcrumbItem = {
	name: string;
	url: string;
};

export function generateBreadcrumbJsonLd(items: BreadcrumbItem[]) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: absoluteUrl(item.url),
		})),
	};
}

export const sectionLabels: Record<string, string> = {
	"getting-started": "Getting Started",
	server: "Server",
	client: "Client",
	admin: "Admin",
	infrastructure: "Infrastructure",
	guides: "Guides",
	examples: "Examples",
	reference: "Reference",
	migration: "Migration",
	mentality: "Architecture",
};

export function buildBreadcrumbs(
	slugs: string[],
	pageTitle: string,
): BreadcrumbItem[] {
	const items: BreadcrumbItem[] = [{ name: "Docs", url: "/docs" }];

	if (slugs.length === 0) return items;

	const section = slugs[0];
	const sectionLabel = sectionLabels[section] ?? section;

	if (slugs.length === 1) {
		items.push({ name: pageTitle, url: `/docs/${slugs.join("/")}` });
	} else {
		items.push({ name: sectionLabel, url: `/docs/${section}` });
		items.push({ name: pageTitle, url: `/docs/${slugs.join("/")}` });
	}

	return items;
}
