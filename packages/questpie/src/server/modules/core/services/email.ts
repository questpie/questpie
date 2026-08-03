import { MailerService } from "#questpie/server/modules/core/integrated/mailer/service.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Email service — creates the MailerService from app config.
 *
 * Namespace: null (top-level in AppContext as `email`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		/* No throw here on a missing adapter. This service is resolved eagerly at
		   boot, so throwing meant an app that never sends mail still could not
		   start. Every other optional slot degrades instead: storage falls back to
		   local disk, queue hands back an empty client.

		   MailerService already handles the missing adapter, and better, because
		   it knows a send is actually being attempted. It uses ConsoleAdapter in
		   development and throws in production. That branch was unreachable while
		   this factory threw first. */
		return new MailerService(app.config.email ?? {});
	},
});
