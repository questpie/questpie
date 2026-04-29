import { page } from "#questpie/admin/client/builder/page/page.js";

export default page("dashboard", {
	component: async () => ({
		default: (
			await import("#questpie/admin/client/views/pages/dashboard-page.js")
		).DashboardPage,
	}),
	showInNav: false,
	path: "/",
});
