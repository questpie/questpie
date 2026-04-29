import { page } from "#questpie/admin/client/builder/page/page.js";

export default page("login", {
	component: async () => ({
		default: (await import("#questpie/admin/client/views/pages/login-page.js"))
			.LoginPage,
	}),
	showInNav: false,
	path: "/login",
});
