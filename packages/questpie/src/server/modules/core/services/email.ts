import { service } from "#questpie/server/services/define-service.js";
import { MailerService } from "#questpie/server/modules/core/integrated/mailer/service.js";

/**
 * Email service — creates the MailerService from app config.
 *
 * Namespace: null (top-level in AppContext as `email`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const config = app.config;

		if (!config.email?.adapter) {
			throw new Error(
				"QUESTPIE: 'email.adapter' is required. Provide adapter in .build({ email: { adapter: ... } })",
			);
		}

		return new MailerService(config.email);
	},
});
