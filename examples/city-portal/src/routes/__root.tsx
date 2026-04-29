import { createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "City Portal - Local Council Websites",
			},
		],
	}),
	notFoundComponent: () => (
		<main className="container px-6 py-24 text-center">
			<h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
			<p className="text-muted-foreground mt-3">
				The page you are looking for does not exist.
			</p>
			<a
				href="/"
				className="text-primary mt-6 inline-block text-sm font-medium hover:underline"
			>
				Back to homepage
			</a>
		</main>
	),

	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
