/**
 * Admin Dashboard Route
 *
 * Renders when navigating to /admin exactly.
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AdminRouter } from "@questpie/admin/client";

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
