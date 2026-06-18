import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "{{projectName}}" },
		],
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	notFoundComponent: () => (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground min-h-screen antialiased">
				<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
					<h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
					<p className="text-muted-foreground mt-3">
						The page you are looking for does not exist.
					</p>
					<Link
						to="/"
						className="text-primary mt-6 inline-block text-sm font-medium hover:underline"
					>
						Back to homepage
					</Link>
				</main>
				<Scripts />
			</body>
		</html>
	),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
