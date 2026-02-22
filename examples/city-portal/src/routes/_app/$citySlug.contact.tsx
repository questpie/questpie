/**
 * Contact Page Route
 *
 * Displays department contacts and a contact form for submissions.
 */

import {
	createFileRoute,
	getRouteApi,
	useParams,
} from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { getContactPageData, submitContactForm } from "@/lib/server-functions";

const cityRouteApi = getRouteApi("/_app/$citySlug");

const DEPARTMENTS = [
	{ value: "general", label: "General Enquiry" },
	{ value: "planning", label: "Planning" },
	{ value: "housing", label: "Housing" },
	{ value: "environment", label: "Environment" },
	{ value: "council-tax", label: "Council Tax" },
	{ value: "benefits", label: "Benefits" },
	{ value: "parking", label: "Parking" },
	{ value: "waste", label: "Waste & Recycling" },
	{ value: "other", label: "Other" },
];

export const Route = createFileRoute("/_app/$citySlug/contact")({
	loader: async ({ params }) => {
		return getContactPageData({ data: { citySlug: params.citySlug } });
	},

	component: ContactPage,
});

function ContactPage() {
	const { contacts } = Route.useLoaderData();
	const { citySlug } = useParams({ from: "/_app/$citySlug" });
	const { settings } = cityRouteApi.useLoaderData();

	return (
		<div className="container mx-auto px-4 py-12">
			<div className="mb-8">
				<h1 className="text-4xl font-bold tracking-tight mb-2">Contact Us</h1>
				<p className="text-muted-foreground">
					Get in touch with your council. Find the right department or send us a
					message.
				</p>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
				{/* Left: Contact Form */}
				<div className="lg:col-span-2">
					<ContactForm citySlug={citySlug} />
				</div>

				{/* Right: Contact Info */}
				<div className="space-y-8">
					{/* Quick Contact */}
					{(settings?.contactEmail ||
						settings?.contactPhone ||
						settings?.address) && (
						<div className="border rounded-lg p-6">
							<h2 className="font-semibold text-lg mb-4">Quick Contact</h2>
							<div className="space-y-3 text-sm">
								{settings?.contactEmail && (
									<div>
										<p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
											Email
										</p>
										<a
											href={`mailto:${settings.contactEmail}`}
											className="text-primary hover:underline"
										>
											{settings.contactEmail}
										</a>
									</div>
								)}
								{settings?.contactPhone && (
									<div>
										<p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
											Phone
										</p>
										<a
											href={`tel:${settings.contactPhone}`}
											className="text-primary hover:underline"
										>
											{settings.contactPhone}
										</a>
									</div>
								)}
								{settings?.address && (
									<div>
										<p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
											Address
										</p>
										<p className="whitespace-pre-line">{settings.address}</p>
									</div>
								)}
								{settings?.openingHours && (
									<div>
										<p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
											Opening Hours
										</p>
										<p className="whitespace-pre-line">
											{settings.openingHours}
										</p>
									</div>
								)}
							</div>
						</div>
					)}

					{settings?.emergencyPhone && (
						<div className="border border-red-200 bg-red-50 rounded-lg p-6">
							<h2 className="font-semibold text-lg mb-2 text-red-900">
								Emergency Contact
							</h2>
							<a
								href={`tel:${settings.emergencyPhone}`}
								className="text-red-700 font-medium hover:underline"
							>
								{settings.emergencyPhone}
							</a>
							<p className="text-xs text-red-700/75 mt-1">
								Out of hours emergency line
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Department Contacts */}
			{contacts.length > 0 && (
				<div className="mt-16">
					<h2 className="text-2xl font-bold tracking-tight mb-6">
						Departments
					</h2>
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
										<p className="text-muted-foreground">
											{contact.officeHours}
										</p>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Contact Form Component
// ============================================================================

function ContactForm({ citySlug }: { citySlug: string }) {
	const [status, setStatus] = useState<
		"idle" | "submitting" | "success" | "error"
	>("idle");
	const [errorMessage, setErrorMessage] = useState("");

	const handleSubmit = useCallback(
		async (e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault();
			setStatus("submitting");
			setErrorMessage("");

			const formData = new FormData(e.currentTarget);
			const name = formData.get("name") as string;
			const email = formData.get("email") as string;
			const phone = formData.get("phone") as string;
			const department = formData.get("department") as string;
			const subject = formData.get("subject") as string;
			const message = formData.get("message") as string;

			if (!name || !email || !subject || !message) {
				setStatus("error");
				setErrorMessage("Please fill in all required fields.");
				return;
			}

			try {
				await submitContactForm({
					data: {
						citySlug,
						name,
						email,
						phone: phone || undefined,
						department: department || "general",
						subject,
						message,
					},
				});
				setStatus("success");
			} catch {
				setStatus("error");
				setErrorMessage(
					"Something went wrong. Please try again or contact us by phone.",
				);
			}
		},
		[citySlug],
	);

	if (status === "success") {
		return (
			<div className="border rounded-lg p-8 text-center bg-green-50 border-green-200">
				<div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
					<svg
						className="w-8 h-8 text-green-600"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M5 13l4 4L19 7"
						/>
					</svg>
				</div>
				<h2 className="text-xl font-semibold text-green-900 mb-2">
					Message Sent
				</h2>
				<p className="text-green-800">
					Thank you for your enquiry. We will respond within 5 working days.
				</p>
				<button
					type="button"
					onClick={() => setStatus("idle")}
					className="mt-4 text-sm font-medium text-primary hover:underline"
				>
					Send another message
				</button>
			</div>
		);
	}

	return (
		<div className="border rounded-lg p-6">
			<h2 className="text-xl font-semibold mb-6">Send us a message</h2>

			{status === "error" && errorMessage && (
				<div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
					{errorMessage}
				</div>
			)}

			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<div>
						<label htmlFor="name" className="block text-sm font-medium mb-1.5">
							Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							id="name"
							name="name"
							required
							className="w-full px-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						/>
					</div>
					<div>
						<label htmlFor="email" className="block text-sm font-medium mb-1.5">
							Email <span className="text-red-500">*</span>
						</label>
						<input
							type="email"
							id="email"
							name="email"
							required
							className="w-full px-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						/>
					</div>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
					<div>
						<label htmlFor="phone" className="block text-sm font-medium mb-1.5">
							Phone
						</label>
						<input
							type="tel"
							id="phone"
							name="phone"
							className="w-full px-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						/>
					</div>
					<div>
						<label
							htmlFor="department"
							className="block text-sm font-medium mb-1.5"
						>
							Department
						</label>
						<select
							id="department"
							name="department"
							defaultValue="general"
							className="w-full px-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
						>
							{DEPARTMENTS.map((dept) => (
								<option key={dept.value} value={dept.value}>
									{dept.label}
								</option>
							))}
						</select>
					</div>
				</div>

				<div>
					<label htmlFor="subject" className="block text-sm font-medium mb-1.5">
						Subject <span className="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="subject"
						name="subject"
						required
						className="w-full px-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
					/>
				</div>

				<div>
					<label htmlFor="message" className="block text-sm font-medium mb-1.5">
						Message <span className="text-red-500">*</span>
					</label>
					<textarea
						id="message"
						name="message"
						required
						rows={6}
						className="w-full px-3 py-2 border rounded-md text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
					/>
				</div>

				<button
					type="submit"
					disabled={status === "submitting"}
					className="px-6 py-2.5 bg-primary text-primary-foreground rounded-md font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{status === "submitting" ? "Sending..." : "Send Message"}
				</button>
			</form>
		</div>
	);
}
