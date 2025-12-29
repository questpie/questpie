import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { MailAdapter } from "../adapter";
import type { SerializableMailOptions } from "../types";

/**
 * SMTP adapter options
 */
export type SmtpAdapterOptions = {
	/**
	 * Nodemailer transport options
	 */
	transport: SMTPTransport | SMTPTransport.Options | string;
	/**
	 * Optional callback after email is sent (useful for logging preview URLs)
	 */
	afterSendCallback?: (info: SMTPTransport.SentMessageInfo) => Promise<void> | void;
};

/**
 * SMTP mail adapter using nodemailer
 */
export class SmtpAdapter extends MailAdapter {
	private transporter: Transporter;
	private afterSendCallback?: (info: SMTPTransport.SentMessageInfo) => Promise<void> | void;

	constructor(opts: SmtpAdapterOptions) {
		super();
		this.transporter = createTransport(opts.transport);
		this.afterSendCallback = opts.afterSendCallback;
	}

	async send(options: SerializableMailOptions): Promise<void> {
		const info = (await this.transporter.sendMail(options)) as SMTPTransport.SentMessageInfo;

		if (this.afterSendCallback) {
			await this.afterSendCallback(info);
		}
	}

	/**
	 * Verify SMTP connection
	 */
	async verify(): Promise<boolean> {
		return this.transporter.verify();
	}
}

/**
 * Create an SMTP adapter with Ethereal email test account
 * Automatically generates test credentials and logs preview URLs to console
 */
export async function createEtherealSmtpAdapter(): Promise<SmtpAdapter> {
	const nodemailer = await import("nodemailer");
	const testAccount = await nodemailer.createTestAccount();

	return new SmtpAdapter({
		transport: {
			host: testAccount.smtp.host,
			port: testAccount.smtp.port,
			secure: testAccount.smtp.secure,
			auth: {
				user: testAccount.user,
				pass: testAccount.pass,
			},
		},
		afterSendCallback: (info) => {
			const previewUrl = nodemailer.getTestMessageUrl(info);
			if (previewUrl) {
				console.log("📧 Email sent! Preview URL:", previewUrl);
			}
		},
	});
}
