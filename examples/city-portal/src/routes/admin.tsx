import {
	createFileRoute,
	HeadContent,
	Link,
	Outlet,
	Scripts,
	useLocation,
} from "@tanstack/react-router";
import { useMemo } from "react";

import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import admin from "@/questpie/admin/.generated/client";
/**
 * Admin Layout Route
 *
 * Uses AdminLayoutProvider for clean setup.
 * Child routes are rendered via <Outlet />.
 */
import {
	AdminLayoutProvider,
	ScopePicker,
	ScopeProvider,
} from "@questpie/admin/client";

import adminCss from "../admin.css?url";

// Wrapper for TanStack Router Link to match admin LinkComponent interface
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
	return (
		<Link
			to={to}
			className={className}
			activeProps={activeProps}
			activeOptions={activeOptions}
		>
			{children}
		</Link>
	);
}

export const Route = createFileRoute("/admin")({
	head: () => ({
		title: "Admin Panel",
		links: [{ rel: "stylesheet", href: adminCss }],
	}),
	component: AdminLayout,
});

function AdminLayout() {
	const location = useLocation();

	// Create city selector slot for the sidebar
	const afterBrandSlot = useMemo(
		() => (
			<div className="border-b px-3 py-2">
				<ScopePicker
					collection="cities"
					labelField="name"
					placeholder="Select city..."
					allowClear
					clearText="All Cities"
					compact
				/>
			</div>
		),
		[],
	);

	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<ScopeProvider
					headerName="x-selected-city"
					storageKey="city-portal-selected-city"
				>
					<AdminLayoutProvider
						admin={admin}
						client={client}
						queryClient={queryClient}
						authClient={authClient}
						LinkComponent={AdminLink}
						activeRoute={location.pathname}
						basePath="/admin"
						useServerTranslations
						sidebarProps={{
							afterBrand: afterBrandSlot,
						}}
					>
						<Outlet />
					</AdminLayoutProvider>
				</ScopeProvider>
				<Scripts />
			</body>
		</html>
	);
}
