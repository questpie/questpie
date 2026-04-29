import { page } from "#questpie/admin/client/builder/page/page.js";

export default page("forgot-password", {
	component: async () => ({
		default: (
			await import("#questpie/admin/client/views/pages/forgot-password-page.js")
		).ForgotPasswordPage,
	}),
	showInNav: false,
	path: "/forgot-password",
});
