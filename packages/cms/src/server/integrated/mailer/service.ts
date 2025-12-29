import { render } from "@react-email/render";
import { convert } from "html-to-text";
import type { ComponentType } from "react";
import type * as React from "react";
import type { MailAdapter } from "./adapter";
import type { MailOptions, MailerConfig, SerializableMailOptions } from "./types";

/**
 * Main mailer service
 */
export class MailerService<
	TTemplates extends Record<string, ComponentType<any>> = Record<
		string,
		ComponentType<any>
	>,
> {
	private templates: TTemplates;
	private defaultFrom?: string;

	constructor(private config: MailerConfig<TTemplates>) {
		this.templates = config.templates;
		this.defaultFrom = config.defaults?.from;
	}

	/**
	 * Serialize mail options (render React, convert to plain text)
	 */
	private async serializeMailOptions({
		react,
		...options
	}: MailOptions): Promise<SerializableMailOptions> {
		let html: string | undefined = options.html;
		let text: string | undefined = options.text;

		if (react) {
			html = await render(react);
			text ??= await render(react, { plainText: true });
		} else if (html && !text) {
			text = convert(html);
		}

		if (!html && !text) {
			throw new Error("No text or html provided");
		}

		return {
			...options,
			from: options.from || this.defaultFrom || "noreply@example.com",
			text: text || "",
			html: html || "",
		};
	}

	/**
	 * Send an email
	 */
	async send(options: MailOptions): Promise<void> {
		const serializedMail = await this.serializeMailOptions(options);
		const adapter = await this.config.adapter;
		return adapter.send(serializedMail);
	}

	/**
	 * Send an email using a React template
	 */
	async sendTemplate<K extends keyof TTemplates>(options: {
		template: K;
		props: React.ComponentProps<TTemplates[K]>;
		to: string | string[];
		subject: string;
		from?: string;
		cc?: string | string[];
		bcc?: string | string[];
	}): Promise<void> {
		const Template = this.templates[options.template];
		if (!Template) {
			throw new Error(`Template "${String(options.template)}" not found.`);
		}

		// @ts-expect-error - React types might mismatch slightly depending on env
		const element = Template(options.props);

		return this.send({
			...options,
			react: element,
		});
	}
}
