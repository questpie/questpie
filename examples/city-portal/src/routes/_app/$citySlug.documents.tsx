/**
 * Documents Listing Route
 *
 * Displays city documents with category filtering and download links.
 */

import { createFileRoute, Link, useParams } from "@tanstack/react-router";

import { getDocumentsList } from "@/lib/server-functions";

const CATEGORIES = [
	{ value: "all", label: "All" },
	{ value: "policy", label: "Policy" },
	{ value: "minutes", label: "Minutes" },
	{ value: "budget", label: "Budget" },
	{ value: "planning", label: "Planning" },
	{ value: "strategy", label: "Strategy" },
	{ value: "report", label: "Report" },
	{ value: "form", label: "Form" },
	{ value: "guide", label: "Guide" },
];

export const Route = createFileRoute("/_app/$citySlug/documents")({
	validateSearch: (search: Record<string, unknown>) => ({
		category: (search.category as string) || "all",
	}),

	loaderDeps: ({ search }) => ({ category: search.category }),

	loader: async ({ params, deps }) => {
		return getDocumentsList({
			data: {
				citySlug: params.citySlug,
				category: deps.category,
			},
		});
	},

	component: DocumentsListing,
});

function DocumentsListing() {
	const { documents } = Route.useLoaderData();
	const { category } = Route.useSearch();
	const { citySlug } = useParams({ from: "/_app/$citySlug" });

	return (
		<div className="container mx-auto px-4 py-12">
			<div className="mb-8">
				<h1 className="mb-2 text-4xl font-bold tracking-tight">Documents</h1>
				<p className="text-muted-foreground">
					Official documents, reports, and publications.
				</p>
			</div>

			{/* Category Filter */}
			<div className="mb-8 flex flex-wrap gap-2">
				{CATEGORIES.map((cat) => (
					<Link
						key={cat.value}
						to="/$citySlug/documents"
						params={{ citySlug }}
						search={{ category: cat.value }}
						className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
							(category || "all") === cat.value
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						}`}
					>
						{cat.label}
					</Link>
				))}
			</div>

			{/* Documents List */}
			{documents.length === 0 ? (
				<div className="py-16 text-center">
					<p className="text-muted-foreground text-lg">No documents found.</p>
				</div>
			) : (
				<div className="max-w-4xl divide-y rounded-lg border">
					{documents.map((doc: any) => (
						<div
							key={doc.id}
							className="hover:bg-muted/50 flex items-center justify-between p-4 transition-colors"
						>
							<div className="flex min-w-0 flex-1 items-center gap-4">
								{/* Icon */}
								<div className="bg-muted flex h-10 w-10 flex-shrink-0 items-center justify-center rounded">
									<svg
										className="text-muted-foreground h-5 w-5"
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
										/>
									</svg>
								</div>

								<div className="min-w-0 flex-1">
									<h3 className="truncate font-medium">{doc.title}</h3>
									<div className="text-muted-foreground mt-1 flex items-center gap-3 text-sm">
										{doc.category && (
											<span className="bg-muted rounded px-2 py-0.5 text-xs capitalize">
												{doc.category}
											</span>
										)}
										{doc.version && (
											<span className="text-xs">v{doc.version}</span>
										)}
										{doc.publishedDate && (
											<time className="text-xs">
												{new Date(doc.publishedDate).toLocaleDateString(
													"en-GB",
												)}
											</time>
										)}
									</div>
									{doc.description && (
										<p className="text-muted-foreground mt-1 line-clamp-1 text-sm">
											{doc.description}
										</p>
									)}
								</div>
							</div>

							{doc.file?.url && (
								<a
									href={doc.file.url}
									className="text-primary ml-4 flex-shrink-0 text-sm font-medium hover:underline"
									download
								>
									Download
								</a>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
