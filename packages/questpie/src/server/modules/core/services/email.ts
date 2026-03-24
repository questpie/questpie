import { service } from "#questpie/server/services/define-service.js";

/**
 * Email service — exposes the MailerService instance.
 *
 * Namespace: null (top-level in AppContext as `email`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ email }) => email,
});
