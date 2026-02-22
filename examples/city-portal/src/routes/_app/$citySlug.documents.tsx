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
				<h1 className="text-4xl font-bold tracking-tight mb-2">Documents</h1>
				<p className="text-muted-foreground">
					Official documents, reports, and publications.
				</p>
			</div>

			{/* Category Filter */}
			<div className="flex flex-wrap gap-2 mb-8">
				{CATEGORIES.map((cat) => (
					<Link
						key={cat.value}
						to={`/${citySlug}/documents`}
						search={{ category: cat.value === "all" ? undefined : cat.value }}
						className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
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
				<div className="text-center py-16">
					<p className="text-muted-foreground text-lg">No documents found.</p>
				</div>
			) : (
				<div className="border rounded-lg divide-y max-w-4xl">
					{documents.map((doc: any) => (
						<div
							key={doc.id}
							className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
						>
							<div className="flex items-center gap-4 flex-1 min-w-0">
								{/* Icon */}
								<div className="flex-shrink-0 w-10 h-10 bg-muted rounded flex items-center justify-center">
									<svg
										className="w-5 h-5 text-muted-foreground"
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

								<div className="flex-1 min-w-0">
									<h3 className="font-medium truncate">{doc.title}</h3>
									<div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
										{doc.category && (
											<span className="capitalize bg-muted px-2 py-0.5 rounded text-xs">
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
										<p className="text-sm text-muted-foreground mt-1 line-clamp-1">
											{doc.description}
										</p>
									)}
								</div>
							</div>

							{doc.file?.url && (
								<a
									href={doc.file.url}
									className="flex-shrink-0 ml-4 text-primary hover:underline text-sm font-medium"
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
