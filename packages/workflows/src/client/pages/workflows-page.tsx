/**
 * Workflows router page — dispatches to list or detail based on URL segments.
 *
 * Registered as a custom admin page at path "workflows".
 * - /admin/workflows → WorkflowListPage
 * - /admin/workflows/:id → WorkflowDetailPage
 */

import { selectBasePath, useAdminStore } from "@questpie/admin/client";
import { WorkflowDetailPage } from "./workflow-detail-page.js";
import { WorkflowListPage } from "./workflow-list-page.js";

export function WorkflowsPage() {
	const basePath = useAdminStore(selectBasePath);

	// Parse URL to determine if we're viewing a specific workflow
	const pathname =
		typeof window !== "undefined" ? window.location.pathname : "";
	const prefix = `${basePath}/workflows`;

	// Extract the instance ID from the URL if present
	const suffix = pathname.startsWith(prefix)
		? pathname.slice(prefix.length)
		: "";
	const segments = suffix.split("/").filter(Boolean);
	const instanceId = segments[0] || null;

	if (instanceId) {
		return <WorkflowDetailPage instanceId={instanceId} />;
	}

	return <WorkflowListPage />;
}
