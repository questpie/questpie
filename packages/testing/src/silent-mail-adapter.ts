import { MailAdapter } from "questpie/mailer";
import type { SerializableMailOptions } from "questpie/mailer";

export class SilentMailAdapter extends MailAdapter {
	async send(_options: SerializableMailOptions): Promise<void> {}
}
