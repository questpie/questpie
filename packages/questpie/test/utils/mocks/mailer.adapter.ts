import type { MailAdapter } from "../../../src/server/integrated/mailer/adapter.js";
import type { SerializableMailOptions } from "../../../src/server/integrated/mailer/types.js";

export interface SentMail {
	to: string | string[];
	from: string;
	subject: string;
	html: string;
	text: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string;
	attachments?: Array<{
		filename: string;
		content: Buffer | string;
		contentType?: string;
	}>;
	headers?: Record<string, string>;
	sentAt: Date;
}

/**
 * Mock Mail Adapter for testing
 * Captures all sent emails for inspection in tests
 */
export class MockMailAdapter implements MailAdapter {
	private sentMails: SentMail[] = [];

	/**
	 * Get all sent emails (test utility)
	 */
	getSentMails(): SentMail[] {
		return [...this.sentMails];
	}

	/**
	 * Get sent emails to a specific recipient (test utility)
	 */
	getSentMailsTo(to: string): SentMail[] {
		return this.sentMails.filter((mail) => {
			const recipients = Array.isArray(mail.to) ? mail.to : [mail.to];
			return recipients.includes(to);
		});
	}

	/**
	 * Get sent emails with specific subject (test utility)
	 */
	getSentMailsWithSubject(subject: string): SentMail[] {
		return this.sentMails.filter((mail) => mail.subject === subject);
	}

	/**
	 * Check if email was sent (test utility)
	 */
	wasSent(predicate: (mail: SentMail) => boolean): boolean {
		return this.sentMails.some(predicate);
	}

	/**
	 * Get count of sent emails (test utility)
	 */
	getSentCount(): number {
		return this.sentMails.length;
	}

	/**
	 * Clear all sent emails (test utility)
	 */
	clearSent(): void {
		this.sentMails = [];
	}

	async send(options: SerializableMailOptions): Promise<void> {
		this.sentMails.push({
			...options,
			sentAt: new Date(),
		});
	}
}
