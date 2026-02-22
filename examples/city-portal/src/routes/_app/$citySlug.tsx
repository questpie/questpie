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
		const settings = loaderData?.settings;
		return {
			title: settings?.metaTitle || `${loaderData?.city.name} - City Council`,
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
				className="min-h-screen bg-background text-foreground antialiased"
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
							logo={settings?.logo || undefined}
							navigation={settings?.navigation ?? []}
							alertEnabled={settings?.alertEnabled}
							alertMessage={settings?.alertMessage}
							alertType={settings?.alertType}
						/>

						<main className="flex-1">
							<Outlet />
						</main>

						<Footer
							cityName={city.name}
							footerText={settings?.footerText}
							footerLinks={settings?.footerLinks ?? []}
							contactEmail={settings?.contactEmail}
							contactPhone={settings?.contactPhone}
							address={settings?.address}
							socialLinks={settings?.socialLinks ?? []}
							copyrightText={settings?.copyrightText}
						/>
					</div>
				</QueryClientProvider>
				<Scripts />
			</body>
		</html>
	);
}
