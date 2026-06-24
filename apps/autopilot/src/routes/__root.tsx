import "virtual:iconify-preload";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

const themeInitScript = `
	(function() {
		document.documentElement.classList.add('dark');
		document.documentElement.style.colorScheme = 'dark';
	})();
`;

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover",
			},
			{ name: "theme-color", content: "#121212" },
			{ title: "Autopilot" },
		],
		scripts: [{ id: "autopilot-theme-init", children: themeInitScript }],
	}),
	notFoundComponent: () => (
		<main className="flex min-h-svh items-center justify-center">
			<p className="text-muted-foreground text-sm">Page not found</p>
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
			<body className="bg-background text-foreground min-h-svh antialiased">
				{children}
				<Scripts />
			</body>
		</html>
	);
}
