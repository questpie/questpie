import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
} from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import admin from "@/questpie/admin/.generated/client";
import { AdminLayoutProvider } from "@questpie/admin/client";

import adminCss from "../admin.css?url";

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
		title: "Autopilot Admin",
		links: [{ rel: "stylesheet", href: adminCss }],
	}),
	component: AdminLayout,
});

function AdminLayout() {
	const location = useLocation();

	return (
		<AdminLayoutProvider
			admin={admin}
			client={client}
			queryClient={queryClient}
			authClient={authClient}
			LinkComponent={AdminLink}
			activeRoute={location.pathname}
			basePath="/admin"
			useServerTranslations
			theme="dark"
		>
			<Outlet />
		</AdminLayoutProvider>
	);
}
