import "virtual:iconify-preload";
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import type * as React from "react";

import { isMarketingPath } from "@/components/marketing/chrome";
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
	const isMarketing = useRouterState({
		select: (state) => isMarketingPath(state.location.pathname),
	});

	return (
		<html suppressHydrationWarning lang="en">
			<head>
				<HeadContent />
			</head>
			<body
				className={`flex min-h-screen flex-col${isMarketing ? " qp-grain-page" : ""}`}
			>
				{/* The mesh has to be a direct child of <body>. It is fixed at
				    z-index -1, and tokens/mesh.css clears the body fill through
				    `body:has(> .qp-mesh-page)` — nested any deeper, the selector
				    misses, body keeps painting --background over it, and the whole
				    atmosphere is simply invisible. */}
				{isMarketing ? <div className="qp-mesh-page" /> : null}
				{/* Marketing is dark-only by design, so a light theme stored while
				    reading the docs must not follow the reader onto the landing. */}
				<RootProvider theme={isMarketing ? { forcedTheme: "dark" } : undefined}>
					{children}
				</RootProvider>
				<Scripts />
			</body>
		</html>
	);
}
