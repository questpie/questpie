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
				title: "TanStack Start Starter",
			},
		],
	}),
	notFoundComponent: () => (
		<main className="container px-6 py-24 text-center">
			<h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
			<p className="mt-3 text-muted-foreground">
				The page you are looking for does not exist.
			</p>
			<a
				href="/"
				className="mt-6 inline-block text-sm font-medium text-highlight hover:underline"
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
