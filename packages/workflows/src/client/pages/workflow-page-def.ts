/**
 * Page definition for the workflows admin page.
 *
 * Follows the same pattern as admin's dashboard/login page definitions:
 * - Uses page() factory from @questpie/admin/client
 * - Lazy-loads the component
 * - path: "workflows" → matches /admin/workflows and /admin/workflows/:id
 */

import { page } from "@questpie/admin/client";

export default page("workflows", {
	component: async () => ({
		default: (await import("./workflows-page.js")).WorkflowsPage,
	}),
	showInNav: false,
	path: "workflows",
});
