/**
 * City Landing Page
 *
 * Lists all active cities in a card grid.
 */

import {
	createFileRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";

import { getCities } from "@/lib/server-functions";

import stylesCss from "@/styles.css?url";

export const Route = createFileRoute("/")({
	loader: () => getCities(),

	head: () => ({
		title: "City Portal - Local Council Websites",
		meta: [
			{
				name: "description",
				content:
					"Access your local city council portal for services, news, documents, and more.",
			},
		],
		links: [{ rel: "stylesheet", href: stylesCss }],
	}),

	component: CitiesLanding,
});

function CitiesLanding() {
	const { cities } = Route.useLoaderData();

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground min-h-screen antialiased">
				<div className="flex min-h-screen flex-col">
					{/* Header */}
					<header className="border-b">
						<div className="container mx-auto px-4 py-6">
							<h1 className="text-2xl font-bold">City Portal</h1>
							<p className="text-muted-foreground mt-1 text-sm">
								Access your local council services
							</p>
						</div>
					</header>

					{/* Main Content */}
					<main className="flex-1">
						<div className="container mx-auto px-4 py-12">
							<div className="mx-auto mb-12 max-w-3xl text-center">
								<h2 className="mb-4 text-4xl font-bold tracking-tight">
									Choose Your City
								</h2>
								<p className="text-muted-foreground text-lg">
									Select your city council to access local services, news,
									documents, and contact information.
								</p>
							</div>

							{cities.length === 0 && (
								<div className="py-16 text-center">
									<p className="text-muted-foreground mb-4 text-lg">
										No cities have been configured yet.
									</p>
									<a
										href="/admin"
										className="text-primary font-medium hover:underline"
									>
										Set up in Admin
									</a>
								</div>
							)}

							<div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
								{cities.map((city: any) => (
									<Link
										key={city.id}
										to="/$citySlug"
										params={{ citySlug: city.slug }}
										className="group hover:border-primary/30 block rounded-lg border p-6 transition-all hover:shadow-lg"
									>
										<div className="mb-4 flex items-center gap-4">
											{city.logo?.url ? (
												<img
													src={city.logo.url}
													alt={`${city.name} logo`}
													className="h-14 w-14 rounded-full object-cover"
												/>
											) : (
												<div className="bg-primary text-primary-foreground flex h-14 w-14 items-center justify-center rounded-full text-xl font-bold">
													{city.name.charAt(0)}
												</div>
											)}
											<div>
												<h3 className="group-hover:text-primary text-lg font-semibold transition-colors">
													{city.name}
												</h3>
												<p className="text-muted-foreground text-sm">
													City Council
												</p>
											</div>
										</div>

										{city.population && (
											<p className="text-muted-foreground text-sm">
												Population: {city.population.toLocaleString()}
											</p>
										)}

										{city.email && (
											<p className="text-muted-foreground mt-1 truncate text-sm">
												{city.email}
											</p>
										)}

										<div className="text-primary mt-4 text-sm font-medium opacity-0 transition-opacity group-hover:opacity-100">
											Visit Portal →
										</div>
									</Link>
								))}
							</div>
						</div>
					</main>

					{/* Footer */}
					<footer className="bg-muted/30 border-t">
						<div className="text-muted-foreground container mx-auto px-4 py-6 text-center text-sm">
							<p>City Portal — Powered by QUESTPIE</p>
						</div>
					</footer>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
