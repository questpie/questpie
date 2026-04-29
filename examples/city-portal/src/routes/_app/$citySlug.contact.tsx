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
				<h1 className="mb-2 text-4xl font-bold tracking-tight">Contact Us</h1>
				<p className="text-muted-foreground">
					Get in touch with your council. Find the right department or send us a
					message.
				</p>
			</div>

			<div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
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
						<div className="rounded-lg border p-6">
							<h2 className="mb-4 text-lg font-semibold">Quick Contact</h2>
							<div className="space-y-3 text-sm">
								{settings?.contactEmail && (
									<div>
										<p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
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
										<p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
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
										<p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
											Address
										</p>
										<p className="whitespace-pre-line">{settings.address}</p>
									</div>
								)}
								{settings?.openingHours && (
									<div>
										<p className="text-muted-foreground mb-1 text-xs tracking-wide uppercase">
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
						<div className="rounded-lg border border-red-200 bg-red-50 p-6">
							<h2 className="mb-2 text-lg font-semibold text-red-900">
								Emergency Contact
							</h2>
							<a
								href={`tel:${settings.emergencyPhone}`}
								className="font-medium text-red-700 hover:underline"
							>
								{settings.emergencyPhone}
							</a>
							<p className="mt-1 text-xs text-red-700/75">
								Out of hours emergency line
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Department Contacts */}
			{contacts.length > 0 && (
				<div className="mt-16">
					<h2 className="mb-6 text-2xl font-bold tracking-tight">
						Departments
					</h2>
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
			<div className="rounded-lg border border-green-200 bg-green-50 p-8 text-center">
				<div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
					<svg
						className="h-8 w-8 text-green-600"
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
				<h2 className="mb-2 text-xl font-semibold text-green-900">
					Message Sent
				</h2>
				<p className="text-green-800">
					Thank you for your enquiry. We will respond within 5 working days.
				</p>
				<button
					type="button"
					onClick={() => setStatus("idle")}
					className="text-primary mt-4 text-sm font-medium hover:underline"
				>
					Send another message
				</button>
			</div>
		);
	}

	return (
		<div className="rounded-lg border p-6">
			<h2 className="mb-6 text-xl font-semibold">Send us a message</h2>

			{status === "error" && errorMessage && (
				<div className="mb-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
					{errorMessage}
				</div>
			)}

			<form onSubmit={handleSubmit} className="space-y-5">
				<div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<div>
						<label htmlFor="name" className="mb-1.5 block text-sm font-medium">
							Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							id="name"
							name="name"
							required
							className="bg-background focus:ring-primary/20 focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
						/>
					</div>
					<div>
						<label htmlFor="email" className="mb-1.5 block text-sm font-medium">
							Email <span className="text-red-500">*</span>
						</label>
						<input
							type="email"
							id="email"
							name="email"
							required
							className="bg-background focus:ring-primary/20 focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
						/>
					</div>
				</div>

				<div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
					<div>
						<label htmlFor="phone" className="mb-1.5 block text-sm font-medium">
							Phone
						</label>
						<input
							type="tel"
							id="phone"
							name="phone"
							className="bg-background focus:ring-primary/20 focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
						/>
					</div>
					<div>
						<label
							htmlFor="department"
							className="mb-1.5 block text-sm font-medium"
						>
							Department
						</label>
						<select
							id="department"
							name="department"
							defaultValue="general"
							className="bg-background focus:ring-primary/20 focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
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
					<label htmlFor="subject" className="mb-1.5 block text-sm font-medium">
						Subject <span className="text-red-500">*</span>
					</label>
					<input
						type="text"
						id="subject"
						name="subject"
						required
						className="bg-background focus:ring-primary/20 focus:border-primary w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
					/>
				</div>

				<div>
					<label htmlFor="message" className="mb-1.5 block text-sm font-medium">
						Message <span className="text-red-500">*</span>
					</label>
					<textarea
						id="message"
						name="message"
						required
						rows={6}
						className="bg-background focus:ring-primary/20 focus:border-primary w-full resize-y rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
					/>
				</div>

				<button
					type="submit"
					disabled={status === "submitting"}
					className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-6 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
				>
					{status === "submitting" ? "Sending..." : "Send Message"}
				</button>
			</form>
		</div>
	);
}
