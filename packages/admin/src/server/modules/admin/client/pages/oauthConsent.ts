import { page } from "#questpie/admin/client/builder/page/page.js";

export default page("oauth-consent", {
	component: async () => ({
		default: (
			await import("#questpie/admin/client/views/pages/oauth-consent-page.js")
		).OAuthConsentPage,
	}),
	showInNav: false,
	path: "/oauth/consent",
});
