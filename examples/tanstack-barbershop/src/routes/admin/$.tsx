/**
 * Admin Catch-All Route
 *
 * Handles all /admin/* routes (collections, globals, pages).
 */

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { AdminRouter } from "@questpie/admin/client";

function createAdminNavigate(navigate: ReturnType<typeof useNavigate>) {
	return (path: string) => {
		void navigate({ to: path });
	};
}

function AdminCatchAll() {
	const navigate = useNavigate();
	const params = Route.useParams();
	const splat = params._splat as string;
	const handleNavigate = useMemo(
		() => createAdminNavigate(navigate),
		[navigate],
	);

	// Parse URL segments from splat
	const segments = splat ? splat.split("/").filter(Boolean) : [];

	return (
		<AdminRouter
			segments={segments}
			navigate={handleNavigate}
			basePath="/admin"
		/>
	);
}

export const Route = createFileRoute("/admin/$")({
	component: AdminCatchAll,
});
