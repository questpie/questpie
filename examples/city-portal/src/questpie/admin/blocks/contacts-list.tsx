/**
 * Contacts List Block Renderer
 */

import type { BlockProps } from "../.generated/client";

export function ContactsListRenderer({
	values,
	data,
}: BlockProps<"contacts-list">) {
	const contacts = (data as any)?.contacts || [];

	return (
		<section className="px-6 py-16">
			<div className="container mx-auto">
				{values.title && (
					<h2 className="mb-8 text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}

				{contacts.length === 0 && (
					<p className="text-muted-foreground py-8 text-center">
						No contacts available.
					</p>
				)}

				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
					{contacts.map((contact: any) => (
						<div
							key={contact.id}
							className="rounded-lg border p-6 transition-shadow hover:shadow-md"
						>
							<h3 className="mb-2 text-lg font-semibold">
								{contact.department}
							</h3>
							{contact.description && (
								<p className="text-muted-foreground mb-4 text-sm">
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
