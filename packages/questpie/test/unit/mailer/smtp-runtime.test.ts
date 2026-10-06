import { expect, test } from "bun:test";

import type MailMessage from "nodemailer/lib/mailer/mail-message";
import SMTPTransport, {
	type SMTPTransportSendCallback,
} from "nodemailer/lib/smtp-transport";

import { SmtpAdapter } from "../../../src/server/modules/core/integrated/mailer/adapters/smtp.adapter.js";

class CaptureTransport extends SMTPTransport {
	mime = "";

	override send(mail: MailMessage, callback: SMTPTransportSendCallback): void {
		const message = mail.message;
		if (!message) {
			callback(new Error("Nodemailer did not construct a MIME message"));
			return;
		}
		void message.build().then(
			(buffer) => {
				this.mime = buffer.toString("utf8");
				const envelope = message.getEnvelope();
				callback(null, {
					messageId: message.messageId(),
					envelope,
					accepted: envelope.to,
					rejected: [],
					response: "250 accepted by local capture transport",
				});
			},
			(error) => {
				callback(error instanceof Error ? error : new Error(String(error)));
			},
		);
	}
}

test("SMTP adapter uses the installed Nodemailer MIME and address pipeline", async () => {
	const transport = new CaptureTransport();
	let receipt: SMTPTransport.SentMessageInfo | undefined;
	const adapter = new SmtpAdapter({
		transport,
		afterSendCallback: (info) => {
			receipt = info;
		},
	});
	await adapter.send({
		from: "Sender <sender@example.test>",
		to: ["One <one@example.test>", "two@example.test"],
		subject: "SMTP compatibility proof",
		text: "Body proof",
		html: "<p>Body proof</p>",
		attachments: [{ filename: "proof.txt", content: "attachment proof" }],
	});
	expect(receipt?.envelope.from).toBe("sender@example.test");
	expect(receipt?.accepted).toEqual(["one@example.test", "two@example.test"]);
	expect(receipt?.messageId).toBeTruthy();
	expect(transport.mime).toContain("Subject: SMTP compatibility proof");
	expect(transport.mime).toContain("Body proof");
	expect(transport.mime).toContain("proof.txt");
});

test("SMTP adapter propagates an installed transport delivery failure", async () => {
	class FailingTransport extends SMTPTransport {
		override send(
			_mail: MailMessage,
			callback: SMTPTransportSendCallback,
		): void {
			callback(new Error("local transport refused delivery"));
		}
	}
	const adapter = new SmtpAdapter({ transport: new FailingTransport() });
	await expect(
		adapter.send({
			from: "sender@example.test",
			to: "recipient@example.test",
			subject: "Failure proof",
			text: "Body",
			html: "<p>Body</p>",
		}),
	).rejects.toThrow("local transport refused delivery");
});
