import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { AdminRouter } from "@questpie/admin/client";

function createAdminNavigate(navigate: ReturnType<typeof useNavigate>) {
	return (path: string) => {
		void navigate({ to: path });
	};
}

function AdminDashboard() {
	const navigate = useNavigate();
	const handleNavigate = useMemo(
		() => createAdminNavigate(navigate),
		[navigate],
	);

	return (
		<AdminRouter segments={[]} navigate={handleNavigate} basePath="/admin" />
	);
}

export const Route = createFileRoute("/admin/")({
	component: AdminDashboard,
});
