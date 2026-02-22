/**
 * Admin Dashboard Route
 *
 * Renders when navigating to /admin exactly.
 */

import { AdminRouter } from "@questpie/admin/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

function AdminDashboard() {
	const navigate = useNavigate();

	return (
		<AdminRouter
			segments={[]}
			navigate={(path) => navigate({ to: path })}
			basePath="/admin"
		/>
	);
}

export const Route = createFileRoute("/admin/")({
	component: AdminDashboard,
});
