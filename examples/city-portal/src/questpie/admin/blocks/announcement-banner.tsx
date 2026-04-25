/**
 * Announcement Banner Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function AnnouncementBannerRenderer({
	data,
}: BlockProps<"announcement-banner">) {
	const announcements = (data as any)?.announcements || [];

	if (announcements.length === 0) return null;

	const categoryStyles: Record<string, string> = {
		notice: "bg-blue-50 border-blue-200 text-blue-900",
		planning: "bg-purple-50 border-purple-200 text-purple-900",
		consultation: "bg-green-50 border-green-200 text-green-900",
		tender: "bg-amber-50 border-amber-200 text-amber-900",
		job: "bg-teal-50 border-teal-200 text-teal-900",
		event: "bg-pink-50 border-pink-200 text-pink-900",
		emergency: "bg-red-50 border-red-200 text-red-900",
	};

	return (
		<section className="px-6 py-4">
			<div className="container mx-auto space-y-2">
				{announcements.map((announcement: any) => (
					<div
						key={announcement.id}
						className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${
							categoryStyles[announcement.category] || categoryStyles.notice
						}`}
					>
						{announcement.isPinned && (
							<span className="text-xs font-bold uppercase">Pinned</span>
						)}
						<span className="font-medium">{announcement.title}</span>
						{announcement.validTo && (
							<span className="ml-auto text-xs opacity-75">
								Until{" "}
								{new Date(announcement.validTo).toLocaleDateString("en-GB")}
							</span>
						)}
					</div>
				))}
			</div>
		</section>
	);
}
