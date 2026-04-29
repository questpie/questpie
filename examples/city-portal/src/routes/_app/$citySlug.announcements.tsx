/**
 * Announcements Listing Route
 *
 * Displays city announcements with category badges and validity dates.
 */

import { createFileRoute } from "@tanstack/react-router";

import { getAnnouncementsList } from "@/lib/server-functions";
import { RichTextRenderer } from "@questpie/admin/client";

const categoryStyles: Record<string, string> = {
	notice: "bg-blue-50 border-blue-200 text-blue-900",
	planning: "bg-purple-50 border-purple-200 text-purple-900",
	consultation: "bg-green-50 border-green-200 text-green-900",
	tender: "bg-amber-50 border-amber-200 text-amber-900",
	job: "bg-teal-50 border-teal-200 text-teal-900",
	event: "bg-pink-50 border-pink-200 text-pink-900",
	emergency: "bg-red-50 border-red-200 text-red-900",
};

const categoryBadgeStyles: Record<string, string> = {
	notice: "bg-blue-100 text-blue-800",
	planning: "bg-purple-100 text-purple-800",
	consultation: "bg-green-100 text-green-800",
	tender: "bg-amber-100 text-amber-800",
	job: "bg-teal-100 text-teal-800",
	event: "bg-pink-100 text-pink-800",
	emergency: "bg-red-100 text-red-800",
};

export const Route = createFileRoute("/_app/$citySlug/announcements")({
	loader: async ({ params }) => {
		return getAnnouncementsList({
			data: { citySlug: params.citySlug },
		});
	},

	component: AnnouncementsListing,
});

function AnnouncementsListing() {
	const { announcements } = Route.useLoaderData();

	return (
		<div className="container mx-auto px-4 py-12">
			<div className="mb-8">
				<h1 className="mb-2 text-4xl font-bold tracking-tight">
					Announcements
				</h1>
				<p className="text-muted-foreground">
					Official notices, consultations, and important updates.
				</p>
			</div>

			{announcements.length === 0 ? (
				<div className="py-16 text-center">
					<p className="text-muted-foreground text-lg">
						No active announcements at this time.
					</p>
				</div>
			) : (
				<div className="max-w-4xl space-y-4">
					{announcements.map((announcement: any) => (
						<div
							key={announcement.id}
							className={`rounded-lg border p-5 ${
								categoryStyles[announcement.category] || categoryStyles.notice
							}`}
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="mb-2 flex items-center gap-2">
										{announcement.isPinned && (
											<span className="bg-foreground/10 rounded px-2 py-0.5 text-xs font-bold uppercase">
												Pinned
											</span>
										)}
										<span
											className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${
												categoryBadgeStyles[announcement.category] ||
												categoryBadgeStyles.notice
											}`}
										>
											{announcement.category}
										</span>
									</div>

									<h3 className="mb-2 text-lg font-semibold">
										{announcement.title}
									</h3>

									{announcement.content && (
										<div className="prose prose-sm max-w-none text-sm opacity-90">
											<RichTextRenderer content={announcement.content} />
										</div>
									)}

									{announcement.referenceNumber && (
										<p className="mt-3 text-xs opacity-75">
											Ref: {announcement.referenceNumber}
										</p>
									)}
								</div>

								<div className="flex-shrink-0 text-right text-xs whitespace-nowrap opacity-75">
									{announcement.validFrom && (
										<p>
											From:{" "}
											{new Date(announcement.validFrom).toLocaleDateString(
												"en-GB",
											)}
										</p>
									)}
									{announcement.validTo && (
										<p>
											Until:{" "}
											{new Date(announcement.validTo).toLocaleDateString(
												"en-GB",
											)}
										</p>
									)}
								</div>
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
