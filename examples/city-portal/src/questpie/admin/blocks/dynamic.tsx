/**
 * Dynamic Block Renderers
 *
 * Blocks that display data from collections (latest news, contacts, documents, announcements).
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import type { AppCMS } from "@/questpie/server/cms";

// ============================================================================
// LATEST NEWS
// ============================================================================

export function LatestNewsRenderer({
	values,
	data,
}: BlockComponentProps<AppCMS, "latest-news">) {
	const news = data?.news || [];

	return (
		<section className="py-16 px-6">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="text-3xl font-bold tracking-tight mb-8">
						{values.title}
					</h2>
				)}

				{news.length === 0 && (
					<p className="text-muted-foreground text-center py-8">
						No news articles available.
					</p>
				)}

				<div
					className={
						values.layout === "list"
							? "space-y-4"
							: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
					}
				>
					{news.map((article: any) => (
						<article
							key={article.id}
							className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow"
						>
							<div className="p-6">
								{article.category && (
									<span className="text-xs font-medium text-primary uppercase tracking-wide">
										{article.category}
									</span>
								)}
								<h3 className="font-semibold mt-1 mb-2">{article.title}</h3>
								{article.excerpt && (
									<p className="text-sm text-muted-foreground line-clamp-2">
										{article.excerpt}
									</p>
								)}
								{article.publishedAt && (
									<time className="text-xs text-muted-foreground mt-3 block">
										{new Date(article.publishedAt).toLocaleDateString("en-GB", {
											day: "numeric",
											month: "long",
											year: "numeric",
										})}
									</time>
								)}
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}

// ============================================================================
// CONTACTS LIST
// ============================================================================

export function ContactsListRenderer({
	values,
	data,
}: BlockComponentProps<AppCMS, "contacts-list">) {
	const contacts = data?.contacts || [];

	return (
		<section className="py-16 px-6">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="text-3xl font-bold tracking-tight mb-8">
						{values.title}
					</h2>
				)}

				{contacts.length === 0 && (
					<p className="text-muted-foreground text-center py-8">
						No contacts available.
					</p>
				)}

				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{contacts.map((contact: any) => (
						<div
							key={contact.id}
							className="border rounded-lg p-6 hover:shadow-md transition-shadow"
						>
							<h3 className="font-semibold text-lg mb-2">
								{contact.department}
							</h3>
							{contact.description && (
								<p className="text-sm text-muted-foreground mb-4">
									{contact.description}
								</p>
							)}
							<div className="space-y-1 text-sm">
								{contact.contactPerson && (
									<p className="font-medium">{contact.contactPerson}</p>
								)}
								{contact.email && (
									<p>
										<a
											href={`mailto:${contact.email}`}
											className="text-primary hover:underline"
										>
											{contact.email}
										</a>
									</p>
								)}
								{contact.phone && (
									<p>
										<a
											href={`tel:${contact.phone}`}
											className="text-primary hover:underline"
										>
											{contact.phone}
										</a>
									</p>
								)}
								{contact.officeHours && (
									<p className="text-muted-foreground">{contact.officeHours}</p>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

// ============================================================================
// DOCUMENTS LIST
// ============================================================================

export function DocumentsListRenderer({
	values,
	data,
}: BlockComponentProps<AppCMS, "documents-list">) {
	const documents = data?.documents || [];

	return (
		<section className="py-16 px-6">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="text-3xl font-bold tracking-tight mb-8">
						{values.title}
					</h2>
				)}

				{documents.length === 0 && (
					<p className="text-muted-foreground text-center py-8">
						No documents available.
					</p>
				)}

				<div className="border rounded-lg divide-y">
					{documents.map((doc: any) => (
						<div
							key={doc.id}
							className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
						>
							<div className="flex-1">
								<h3 className="font-medium">{doc.title}</h3>
								<div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
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
									className="text-primary hover:underline text-sm font-medium"
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

// ============================================================================
// ANNOUNCEMENT BANNER
// ============================================================================

export function AnnouncementBannerRenderer({
	data,
}: BlockComponentProps<AppCMS, "announcement-banner">) {
	const announcements = data?.announcements || [];

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
		<section className="py-4 px-6">
			<div className="container mx-auto space-y-2">
				{announcements.map((announcement: any) => (
					<div
						key={announcement.id}
						className={`flex items-center gap-3 px-4 py-3 rounded-md border text-sm ${
							categoryStyles[announcement.category] || categoryStyles.notice
						}`}
					>
						{announcement.isPinned && (
							<span className="font-bold text-xs uppercase">Pinned</span>
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
