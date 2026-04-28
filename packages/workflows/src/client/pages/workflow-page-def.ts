/**
 * Page definition for the workflows admin page.
 *
 * Follows the same pattern as admin's dashboard/login page definitions:
 * - Uses page() factory from @questpie/admin/client
 * - Lazy-loads the component
 * - path: "workflows" → matches /admin/workflows and /admin/workflows/:id
 */

// Inline page() factory — trivial frozen object, same as admin's page.ts
function page<TName extends string>(
	name: TName,
	config: {
		component: () => Promise<{ default: React.ComponentType }>;
		showInNav?: boolean;
		path?: string;
	},
) {
	return Object.freeze({
		name,
		component: config.component,
		path: config.path,
		showInNav: config.showInNav,
	});
}

export default page("workflows", {
	component: async () => ({
		default: (await import("./workflows-page.js")).WorkflowsPage,
	}),
	showInNav: false,
	path: "workflows",
});
