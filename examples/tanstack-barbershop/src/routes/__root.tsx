import "virtual:iconify-preload";
import {
	createRootRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";

const themeInitScript = `
	(function() {
		if (window.location.pathname.startsWith('/admin')) {
			document.documentElement.classList.add('dark');
			document.documentElement.classList.remove('light');
			document.documentElement.style.colorScheme = 'dark';
			return;
		}

		const theme = localStorage.getItem('barbershop-theme');
		const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		const resolvedTheme = theme === 'system' || !theme
			? (prefersDark ? 'dark' : 'light')
			: theme;
		document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
		document.documentElement.classList.toggle('light', resolvedTheme === 'light');
		document.documentElement.style.colorScheme = resolvedTheme;
	})();
`;

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
		scripts: [
			{
				id: "barbershop-theme-init",
				children: themeInitScript,
			},
			...(process.env.NODE_ENV !== "production" &&
			process.env.VITE_REACT_SCAN === "true"
				? [
						{
							async: true,
							crossOrigin: "anonymous",
							src: "//unpkg.com/react-scan/dist/auto.global.js",
						},
					]
				: []),
		],
	}),
	notFoundComponent: () => (
		<main className="container px-6 py-24 text-center">
			<h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
			<p className="text-muted-foreground mt-3">
				The page you are looking for does not exist.
			</p>
			<Link
				to="/"
				className="text-highlight mt-6 inline-block text-sm font-medium hover:underline"
			>
				Back to homepage
			</Link>
		</main>
	),

	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground min-h-screen antialiased">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
