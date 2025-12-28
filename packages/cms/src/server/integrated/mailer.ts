import { createTransport, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { render } from "@react-email/render";
import type { ComponentType } from "react";
import * as React from "react";

export interface MailerConfig<TTemplates extends Record<string, ComponentType<any>> = Record<string, ComponentType<any>>> {
	/**
	 * Nodemailer transport options (SMTP, JSON, etc.)
	 * For SMTP: { host, port, secure, auth, etc. }
	 * Or connection URL: "smtp://user:pass@smtp.example.com"
	 */
	transport: string | SMTPTransport.Options;
	/**
	 * Default 'from' address
	 */
	defaults?: {
		from?: string;
	};
	/**
	 * Registry of React Email templates
	 */
	templates: TTemplates;
}

export class MailerService<TTemplates extends Record<string, ComponentType<any>> = Record<string, ComponentType<any>>> {
	private transporter: Transporter;
	private templates: TTemplates;
	private defaultFrom?: string;

	constructor(config: MailerConfig<TTemplates>) {
		this.transporter = createTransport(config.transport);
		this.templates = config.templates;
		this.defaultFrom = config.defaults?.from;
	}

	/**
	 * Send an email using a React template
	 */
	async send<K extends keyof TTemplates>(
		options: {
			template: K;
			props: React.ComponentProps<TTemplates[K]>;
			to: string | string[];
			subject: string;
			from?: string;
			cc?: string | string[];
			bcc?: string | string[];
		}
	) {
		const Template = this.templates[options.template];
		if (!Template) {
			throw new Error(`Template "${String(options.template)}" not found.`);
		}

		// Render the email to HTML
		// @ts-ignore - React types might mismatch slightly depending on env
		const html = await render(Template(options.props));

		// Send via Nodemailer
		return this.transporter.sendMail({
			from: options.from || this.defaultFrom,
			to: options.to,
			cc: options.cc,
			bcc: options.bcc,
			subject: options.subject,
			html,
		});
	}

	/**
	 * Verify connection
	 */
	async verify() {
		return this.transporter.verify();
	}
}
