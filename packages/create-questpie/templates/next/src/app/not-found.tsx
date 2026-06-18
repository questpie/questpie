import Link from "next/link";

export default function NotFound() {
	return (
		<main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
			<h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
			<p className="text-muted-foreground mt-3">
				The page you are looking for does not exist.
			</p>
			<Link
				href="/"
				className="text-primary mt-6 inline-block text-sm font-medium hover:underline"
			>
				Back to homepage
			</Link>
		</main>
	);
}
