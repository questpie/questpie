import { page } from "#questpie/admin/client/builder/page/page.js";

export default page("setup", {
	component: async () => ({
		default: (await import("#questpie/admin/client/views/pages/setup-page.js"))
			.SetupPage,
	}),
	showInNav: false,
	path: "/setup",
});
