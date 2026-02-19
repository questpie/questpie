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
			<body className="min-h-screen bg-background text-foreground antialiased">
				<div className="min-h-screen flex flex-col">
					{/* Header */}
					<header className="border-b">
						<div className="container mx-auto px-4 py-6">
							<h1 className="text-2xl font-bold">City Portal</h1>
							<p className="text-muted-foreground text-sm mt-1">
								Access your local council services
							</p>
						</div>
					</header>

					{/* Main Content */}
					<main className="flex-1">
						<div className="container mx-auto px-4 py-12">
							<div className="max-w-3xl mx-auto text-center mb-12">
								<h2 className="text-4xl font-bold tracking-tight mb-4">
									Choose Your City
								</h2>
								<p className="text-lg text-muted-foreground">
									Select your city council to access local services, news,
									documents, and contact information.
								</p>
							</div>

							{cities.length === 0 && (
								<div className="text-center py-16">
									<p className="text-muted-foreground text-lg mb-4">
										No cities have been configured yet.
									</p>
									<a
										href="/admin"
										className="text-primary hover:underline font-medium"
									>
										Set up in Admin
									</a>
								</div>
							)}

							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
								{cities.map((city: any) => (
									<Link
										key={city.id}
										to={`/${city.slug}`}
										className="group block border rounded-lg p-6 hover:shadow-lg transition-all hover:border-primary/30"
									>
										<div className="flex items-center gap-4 mb-4">
											{city.logo?.url ? (
												<img
													src={city.logo.url}
													alt={`${city.name} logo`}
													className="h-14 w-14 rounded-full object-cover"
												/>
											) : (
												<div className="h-14 w-14 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-xl">
													{city.name.charAt(0)}
												</div>
											)}
											<div>
												<h3 className="text-lg font-semibold group-hover:text-primary transition-colors">
													{city.name}
												</h3>
												<p className="text-sm text-muted-foreground">
													City Council
												</p>
											</div>
										</div>

										{city.population && (
											<p className="text-sm text-muted-foreground">
												Population:{" "}
												{city.population.toLocaleString()}
											</p>
										)}

										{city.email && (
											<p className="text-sm text-muted-foreground mt-1 truncate">
												{city.email}
											</p>
										)}

										<div className="mt-4 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
											Visit Portal →
										</div>
									</Link>
								))}
							</div>
						</div>
					</main>

					{/* Footer */}
					<footer className="border-t bg-muted/30">
						<div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
							<p>City Portal — Powered by QUESTPIE</p>
						</div>
					</footer>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
