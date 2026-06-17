"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import { admin } from "@/questpie/admin/admin";
import { AdminLayoutProvider } from "@questpie/admin/client";

import "./admin.css";

function AdminLink({
	to,
	className,
	children,
	activeProps,
	activeOptions,
}: {
	to: string;
	className?: string;
	children: React.ReactNode;
	activeProps?: { className?: string };
	activeOptions?: { exact?: boolean };
}) {
	const pathname = usePathname();
	const isActive = activeOptions?.exact
		? pathname === to
		: pathname === to || pathname.startsWith(`${to}/`);
	const mergedClassName = [className, isActive ? activeProps?.className : null]
		.filter(Boolean)
		.join(" ");

	return (
		<Link href={to} className={mergedClassName || undefined}>
			{children}
		</Link>
	);
}

export default function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const pathname = usePathname();

	return (
		<AdminLayoutProvider
			admin={admin}
			client={client}
			queryClient={queryClient}
			authClient={authClient}
			LinkComponent={AdminLink}
			activeRoute={pathname}
			basePath="/admin"
			useServerTranslations
		>
			{children}
		</AdminLayoutProvider>
	);
}
