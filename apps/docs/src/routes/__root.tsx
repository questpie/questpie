import bricolageLatinUrl from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
import hankenLatinUrl from "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2?url";
import jetbrainsMonoLatinUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
import { preload } from "react-dom";

import { generateLinks } from "@/lib/seo";

import appCss from "@/styles/app.css?url";

export const Route = createRootRoute({
	head: () => {
		const umamiUrl = process.env.UMAMI_URL;
		const umamiWebsiteId = process.env.UMAMI_WEBSITE_ID;

		return {
			meta: [
				{ charSet: "utf-8" },
				{ name: "viewport", content: "width=device-width, initial-scale=1" },
				{ name: "format-detection", content: "telephone=no" },
				/* Dark first, matching the canon: `.dark` is the default block in
				   tokens/colors.css and `.light` is the override. */
				{ name: "color-scheme", content: "dark light" },
				{
					name: "theme-color",
					media: "(prefers-color-scheme: light)",
					content: "#fbf9f5",
				},
				{
					name: "theme-color",
					media: "(prefers-color-scheme: dark)",
					content: "#12100d",
				},
			],
			links: [
				...generateLinks({ cssUrl: appCss, includeCanonical: false }),
				{
					rel: "alternate",
					type: "application/rss+xml",
					title: "QUESTPIE Documentation RSS",
					href: "/rss.xml",
				},
			],
			scripts:
				umamiUrl && umamiWebsiteId
					? [
							{
								defer: true,
								src: umamiUrl,
								"data-website-id": umamiWebsiteId,
							},
						]
					: [],
		};
	},
	component: RootComponent,
});

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	preload(hankenLatinUrl, {
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	});
	preload(bricolageLatinUrl, {
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	});
	preload(jetbrainsMonoLatinUrl, {
		as: "font",
		type: "font/woff2",
		crossOrigin: "anonymous",
	});

	return (
		<html suppressHydrationWarning lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="flex min-h-screen flex-col">
				<RootProvider>{children}</RootProvider>
				<Scripts />
			</body>
		</html>
	);
}
