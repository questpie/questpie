/**
 * Admin Layout Route
 *
 * Uses AdminLayoutProvider for clean setup.
 * Child routes are rendered via <Outlet />.
 */
import { AdminLayoutProvider } from "@questpie/admin/client";
import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createFileRoute,
	HeadContent,
	Link,
	Outlet,
	Scripts,
	useLocation,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { authClient } from "~/lib/auth-client";
import { client } from "~/lib/cms-client";
import { queryClient } from "~/lib/query-client";
import { admin } from "~/questpie/admin/builder";

import adminCss from "../admin.css?url";

// Wrapper for TanStack Router Link to match admin LinkComponent interface
function AdminLink({
	to,
	className,
	children,
	activeProps,
}: {
	to: string;
	className?: string;
	children: React.ReactNode;
	activeProps?: { className?: string };
}) {
	return (
		<Link to={to} className={className} activeProps={activeProps}>
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

	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
			</head>
			<body>
				<AdminLayoutProvider
					admin={admin}
					client={client}
					queryClient={queryClient}
					authClient={authClient}
					LinkComponent={AdminLink}
					activeRoute={location.pathname}
					basePath="/admin"
					// Enable server-side translations
					// Translations are configured on server via .adminLocale() and .messages()
					useServerTranslations
					// theme="dark"
				>
					<Outlet />
				</AdminLayoutProvider>
				<TanStackDevtools
					config={{
						position: "bottom-right",
					}}
					plugins={[
						{
							name: "Tanstack Router",
							render: <TanStackRouterDevtoolsPanel />,
						},
					]}
				/>
				<Scripts />
			</body>
		</html>
	);
}
