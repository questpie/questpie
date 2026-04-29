/**
 * City Layout Route
 *
 * Layout for city-specific pages.
 * Fetches city data and site settings for the current city.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import {
	createFileRoute,
	HeadContent,
	Outlet,
	Scripts,
	useParams,
} from "@tanstack/react-router";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { queryClient } from "@/lib/query-client";
import { getCityBySlug, getSiteSettings } from "@/lib/server-functions";
import type {
	FooterLink,
	NavItem,
	SocialLink,
} from "@/questpie/server/globals";

import stylesCss from "@/styles.css?url";

export const Route = createFileRoute("/_app/$citySlug")({
	loader: async ({ params }) => {
		const { citySlug } = params;

		// Fetch city data and site settings in parallel
		const [cityResult, settings] = await Promise.all([
			getCityBySlug({ data: { slug: citySlug } }),
			getSiteSettings({ data: { citySlug } }),
		]);

		return {
			city: cityResult.city,
			settings,
		};
	},

	head: ({ loaderData }) => {
		const data = loaderData as { city: any; settings: any } | undefined;
		const settings = data?.settings;
		return {
			title:
				settings?.metaTitle || `${data?.city?.name ?? "City"} - City Council`,
			meta: settings?.metaDescription
				? [{ name: "description", content: settings.metaDescription }]
				: [],
			links: [{ rel: "stylesheet", href: stylesCss }],
		};
	},

	component: CityLayout,
});

function CityLayout() {
	const { city, settings } = Route.useLoaderData();

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body
				className="bg-background text-foreground min-h-screen antialiased"
				style={
					settings?.primaryColour
						? ({ "--primary": settings.primaryColour } as React.CSSProperties)
						: undefined
				}
			>
				<QueryClientProvider client={queryClient}>
					<div className="flex min-h-screen flex-col">
						<Header
							cityName={city.name}
							citySlug={city.slug}
							logo={settings?.logo?.url ?? undefined}
							navigation={(settings?.navigation ?? []) as NavItem[]}
							alertEnabled={settings?.alertEnabled ?? undefined}
							alertMessage={settings?.alertMessage ?? undefined}
							alertType={
								(settings?.alertType as "info" | "warning" | "emergency") ??
								undefined
							}
						/>

						<main className="flex-1">
							<Outlet />
						</main>

						<Footer
							cityName={city.name}
							footerText={settings?.footerText ?? undefined}
							footerLinks={(settings?.footerLinks ?? []) as FooterLink[]}
							contactEmail={settings?.contactEmail ?? undefined}
							contactPhone={settings?.contactPhone ?? undefined}
							address={settings?.address ?? undefined}
							socialLinks={(settings?.socialLinks ?? []) as SocialLink[]}
							copyrightText={settings?.copyrightText ?? undefined}
						/>
					</div>
				</QueryClientProvider>
				<Scripts />
			</body>
		</html>
	);
}
