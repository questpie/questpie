import { MailAdapter } from "../adapter";
import type { SerializableMailOptions } from "../types";

/**
 * Console adapter options
 */
export type ConsoleAdapterOptions = {
	/**
	 * Whether to log the full HTML content (can be verbose)
	 * @default false
	 */
	logHtml?: boolean;
	/**
	 * Custom logger function
	 */
	logger?: (message: string) => void;
};

/**
 * Console mail adapter for development
 * Logs email details to console instead of sending
 */
export class ConsoleAdapter extends MailAdapter {
	private logHtml: boolean;
	private logger: (message: string) => void;

	constructor(opts: ConsoleAdapterOptions = {}) {
		super();
		this.logHtml = opts.logHtml ?? false;
		this.logger = opts.logger ?? console.log;
	}

	async send(options: SerializableMailOptions): Promise<void> {
		const separator = "=".repeat(60);

		this.logger("\n" + separator);
		this.logger("📧 EMAIL (Console Adapter - Development Mode)");
		this.logger(separator);
		this.logger(`From: ${options.from}`);
		this.logger(`To: ${Array.isArray(options.to) ? options.to.join(", ") : options.to}`);

		if (options.cc) {
			this.logger(`CC: ${Array.isArray(options.cc) ? options.cc.join(", ") : options.cc}`);
		}

		if (options.bcc) {
			this.logger(`BCC: ${Array.isArray(options.bcc) ? options.bcc.join(", ") : options.bcc}`);
		}

		if (options.replyTo) {
			this.logger(`Reply-To: ${options.replyTo}`);
		}

		this.logger(`Subject: ${options.subject}`);
		this.logger(separator);

		this.logger("\nText Content:");
		this.logger(options.text);

		if (this.logHtml) {
			this.logger("\nHTML Content:");
			this.logger(options.html);
		} else {
			this.logger("\n(HTML content available but not logged. Set logHtml: true to see it)");
		}

		if (options.attachments && options.attachments.length > 0) {
			this.logger("\nAttachments:");
			for (const attachment of options.attachments) {
				this.logger(`  - ${attachment.filename} (${attachment.contentType || "unknown type"})`);
			}
		}

		this.logger(separator + "\n");
	}
}
