import {
	createFileRoute,
	HeadContent,
	Link,
	Scripts,
} from "@tanstack/react-router";

import appCss from "@/styles.css?url";

export const Route = createFileRoute("/")({
	head: () => ({
		title: "{{projectName}}",
		links: [{ rel: "stylesheet", href: appCss }],
	}),
	component: Home,
});

function Home() {
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body className="bg-background text-foreground min-h-screen antialiased">
				<main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
					<span className="text-muted-foreground mb-4 text-xs font-medium uppercase tracking-widest">
						Powered by QUESTPIE
					</span>
					<h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
						{"{{projectName}}"}
					</h1>
					<p className="text-muted-foreground mt-4 text-lg">
						Your QUESTPIE app is running. Here is where to go next.
					</p>

					<div className="mt-12 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3">
						<Link
							to="/admin"
							className="group hover:border-primary/30 block rounded-lg border p-5 transition-all hover:shadow-md"
						>
							<h2 className="group-hover:text-primary font-semibold transition-colors">
								Admin panel
							</h2>
							<p className="text-muted-foreground mt-1 text-sm">
								Manage your content and settings.
							</p>
							<span className="text-primary mt-3 inline-block text-sm font-medium">
								Open /admin →
							</span>
						</Link>

						<a
							href="/api/docs"
							className="group hover:border-primary/30 block rounded-lg border p-5 transition-all hover:shadow-md"
						>
							<h2 className="group-hover:text-primary font-semibold transition-colors">
								API docs
							</h2>
							<p className="text-muted-foreground mt-1 text-sm">
								Explore the REST API in Scalar.
							</p>
							<span className="text-primary mt-3 inline-block text-sm font-medium">
								Open /api/docs →
							</span>
						</a>

						<a
							href="https://questpie.com/docs"
							target="_blank"
							rel="noreferrer"
							className="group hover:border-primary/30 block rounded-lg border p-5 transition-all hover:shadow-md"
						>
							<h2 className="group-hover:text-primary font-semibold transition-colors">
								Documentation
							</h2>
							<p className="text-muted-foreground mt-1 text-sm">
								Learn the framework and patterns.
							</p>
							<span className="text-primary mt-3 inline-block text-sm font-medium">
								questpie.com/docs →
							</span>
						</a>
					</div>

					<p className="text-muted-foreground mt-12 text-sm">
						Edit{" "}
						<code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
							src/routes/index.tsx
						</code>{" "}
						to change this page.
					</p>
				</main>
				<Scripts />
			</body>
		</html>
	);
}
