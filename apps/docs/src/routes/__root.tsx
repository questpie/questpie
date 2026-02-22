import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";
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
				{ name: "color-scheme", content: "light dark" },
				{ name: "theme-color", content: "#B700FF" },
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
			scripts: [
				...(umamiUrl && umamiWebsiteId
					? [
							{
								defer: true,
								src: umamiUrl,
								"data-website-id": umamiWebsiteId,
							},
						]
					: []),
			],
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
	return (
		<html suppressHydrationWarning lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="flex flex-col min-h-screen">
				<RootProvider>{children}</RootProvider>
				<Scripts />
			</body>
		</html>
	);
}
