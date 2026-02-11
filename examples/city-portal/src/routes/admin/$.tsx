/**
 * Admin Catch-All Route with Scope Selection
 *
 * Handles all /admin/* routes with multi-tenant scope support.
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

function AdminCatchAll() {
	const navigate = useNavigate();
	const params = Route.useParams();
	const splat = params._splat as string;

	// Parse URL segments from splat
	const segments = splat ? splat.split("/").filter(Boolean) : [];

	return (
		<ScopeProvider
			headerName="x-selected-city"
			storageKey="city-portal-selected-city"
		>
			<AdminCatchAllContent segments={segments} navigate={navigate} />
		</ScopeProvider>
	);
}

function AdminCatchAllContent({
	segments,
	navigate,
}: {
	segments: string[];
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
				segments={segments}
				navigate={(path) => navigate({ to: path })}
				basePath="/admin"
			/>
		</AdminLayout>
	);
}

export const Route = createFileRoute("/admin/$")({
	component: AdminCatchAll,
});
