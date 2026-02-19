/**
 * SEO configuration and helpers for QUESTPIE docs + landing
 */

export const siteConfig = {
	name: "QUESTPIE",
	title: "QUESTPIE - Server-First TypeScript Backend Platform",
	description:
		"Define schema, access, and workflows in TypeScript. QUESTPIE emits an introspection contract and projects REST, RPC, realtime, typed clients, and admin interfaces from one server model.",
	url: "https://questpie.com",
	ogImage: "/og-image.svg",
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
		{ name: "theme-color", content: "#a732ee" },
		{ name: "color-scheme", content: "light dark" },

		{ property: "og:type", content: type },
		{ property: "og:site_name", content: siteConfig.name },
		{ property: "og:title", content: fullTitle },
		{ property: "og:description", content: description },
		{ property: "og:url", content: canonical },
		{ property: "og:image", content: fullImageUrl },
		{ property: "og:image:width", content: "1200" },
		{ property: "og:image:height", content: "630" },
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
						href: "/symbol/Q-symbol-dark-pink.svg",
					},
					{
						rel: "icon",
						type: "image/svg+xml",
						href: "/symbol/Q-symbol-white-pink.svg",
						media: "(prefers-color-scheme: dark)",
					},
					{ rel: "apple-touch-icon", href: "/symbol/Q-symbol-dark-pink.svg" },
				]
			: []),
		...(includePreconnect
			? [
					{ rel: "preconnect", href: "https://fonts.googleapis.com" },
					{ rel: "dns-prefetch", href: "https://fonts.googleapis.com" },
					{ rel: "dns-prefetch", href: "https://github.com" },
				]
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
					url: `${siteConfig.url}/logo/Questpie-dark-pink.svg`,
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
				url: `${siteConfig.url}/logo/Questpie-dark-pink.svg`,
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
