/**
 * Documents List Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function DocumentsListRenderer({
	values,
	data,
}: BlockProps<"documents-list">) {
	const documents = (data as any)?.documents || [];

	return (
		<section className="px-6 py-16">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="mb-8 text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}

				{documents.length === 0 && (
					<p className="text-muted-foreground py-8 text-center">
						No documents available.
					</p>
				)}

				<div className="divide-y rounded-lg border">
					{documents.map((doc: any) => (
						<div
							key={doc.id}
							className="hover:bg-muted/50 flex items-center justify-between p-4 transition-colors"
						>
							<div className="flex-1">
								<h3 className="font-medium">{doc.title}</h3>
								<div className="text-muted-foreground mt-1 flex items-center gap-3 text-sm">
									{doc.category && (
										<span className="capitalize">{doc.category}</span>
									)}
									{doc.version && <span>v{doc.version}</span>}
									{doc.publishedDate && (
										<time>
											{new Date(doc.publishedDate).toLocaleDateString("en-GB")}
										</time>
									)}
								</div>
							</div>
							{doc.file && (
								<a
									href={doc.file}
									className="text-primary text-sm font-medium hover:underline"
									download
								>
									Download
								</a>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
