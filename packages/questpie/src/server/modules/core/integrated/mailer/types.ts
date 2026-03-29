/**
 * Base mail options interface
 */
export type MailOptions = {
	from?: string;
	to: string | string[];
	cc?: string | string[];
	bcc?: string | string[];
	subject: string;
	attachments?: Array<{
		filename: string;
		content: Buffer | string;
		contentType?: string;
	}>;
	headers?: Record<string, string>;
	replyTo?: string;
	text?: string;
	html?: string;
};

/**
 * Serializable mail options (after rendering)
 */
export type SerializableMailOptions = Omit<MailOptions, "text" | "html"> & {
	text: string;
	html: string;
	from: string;
};

/**
 * Mailer configuration
 */
export interface MailerConfig<
	TTemplates extends Record<string, any> = Record<string, any>,
> {
	/**
	 * Mail adapter (SMTP, Console, Resend, etc.)
	 */
	adapter?:
		| import("./adapter").MailAdapter
		| Promise<import("./adapter").MailAdapter>;
	/**
	 * Default 'from' address
	 */
	defaults?: {
		from?: string;
	};
	/**
	 * Registry of email templates (defined via email)
	 */
	templates?: TTemplates;
}
