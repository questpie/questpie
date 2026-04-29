import { page } from "#questpie/admin/client/builder/page/page.js";

export default page("reset-password", {
	component: async () => ({
		default: (
			await import("#questpie/admin/client/views/pages/reset-password-page.js")
		).ResetPasswordPage,
	}),
	showInNav: false,
	path: "/reset-password",
});
