/**
 * Admin Dashboard Route with Scope Selection
 *
 * Wraps the admin interface with ScopeProvider for multi-tenant city management.
 */

import {
	AdminLayout,
	AdminRouter,
	ScopePicker,
	ScopeProvider,
} from "@questpie/admin/client";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { admin } from "@/questpie/admin/admin";

function AdminDashboard() {
	const navigate = useNavigate();

	return (
		<ScopeProvider
			headerName="x-selected-city"
			storageKey="city-portal-selected-city"
		>
			<AdminDashboardContent navigate={navigate} />
		</ScopeProvider>
	);
}

function AdminDashboardContent({
	navigate,
}: {
	navigate: (opts: { to: string }) => void;
}) {
	// Create city selector slot for the sidebar
	const afterBrandSlot = useMemo(
		() => (
			<div className="px-3 py-2 border-b">
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
		<AdminLayout
			admin={admin}
			basePath="/admin"
			slots={{
				afterBrand: afterBrandSlot,
			}}
		>
			<AdminRouter
				segments={[]}
				navigate={(path) => navigate({ to: path })}
				basePath="/admin"
			/>
		</AdminLayout>
	);
}

export const Route = createFileRoute("/admin/")({
	component: AdminDashboard,
});
