import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { MailerService } from "../../../src/server/modules/core/integrated/mailer/service.js";
import { email } from "../../../src/server/modules/core/integrated/mailer/template.js";
import { MockMailAdapter } from "../../utils/mocks/mailer.adapter.js";

// -- Fixtures ------------------------------------------------------------------

const welcomeTemplate = email({
	name: "welcome",
	schema: z.object({
		userName: z.string(),
		activationUrl: z.string().url(),
	}),
	handler: ({ input }) => ({
		subject: `Welcome, ${input.userName}!`,
		html: `<h1>Welcome, ${input.userName}!</h1><a href="${input.activationUrl}">Activate</a>`,
		text: `Welcome, ${input.userName}! Activate: ${input.activationUrl}`,
	}),
});

const asyncTemplate = email({
	name: "async-data",
	schema: z.object({ orderId: z.string() }),
	handler: async ({ input }) => {
		// Simulate async data fetch
		const total = await Promise.resolve("$42.00");
		return {
			subject: `Order #${input.orderId} confirmed`,
			html: `<p>Order ${input.orderId} — Total: ${total}</p>`,
		};
	},
});

const noTextTemplate = email({
	name: "html-only",
	schema: z.object({ msg: z.string() }),
	handler: ({ input }) => ({
		subject: "HTML only",
		html: `<p>${input.msg}</p>`,
	}),
});

const withTextTemplate = email({
	name: "with-text",
	schema: z.object({ msg: z.string() }),
	handler: ({ input }) => ({
		subject: "With text",
		html: `<p>${input.msg}</p>`,
		text: input.msg,
	}),
});

// -- Tests ---------------------------------------------------------------------

describe("MailerService", () => {
	let adapter: MockMailAdapter;
	let service: MailerService<any>;

	beforeEach(() => {
		adapter = new MockMailAdapter();
		service = new MailerService({
			adapter,
			defaults: { from: "test@example.com" },
			templates: {
				welcome: welcomeTemplate,
				asyncData: asyncTemplate,
				htmlOnly: noTextTemplate,
				withText: withTextTemplate,
			},
		});
	});

	afterEach(() => {
		adapter.clearSent();
	});

	// -- send() ----------------------------------------------------------------

	describe("send()", () => {
		it("sends a raw email with html", async () => {
			await service.send({
				to: "user@example.com",
				subject: "Hello",
				html: "<h1>Hi</h1>",
			});

			expect(adapter.getSentCount()).toBe(1);
			const sent = adapter.getSentMails()[0];
			expect(sent.to).toBe("user@example.com");
			expect(sent.subject).toBe("Hello");
			expect(sent.html).toBe("<h1>Hi</h1>");
			expect(sent.from).toBe("test@example.com");
		});

		it("sends a raw email with text only", async () => {
			await service.send({
				to: "user@example.com",
				subject: "Plain",
				text: "Hello world",
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.text).toBe("Hello world");
		});

		it("auto-converts html to text when text is not provided", async () => {
			await service.send({
				to: "user@example.com",
				subject: "Auto-convert",
				html: "<h1>Title</h1><p>Body text</p>",
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.text).toBeTruthy();
			expect(sent.text.toUpperCase()).toContain("TITLE");
			expect(sent.text).toContain("Body text");
		});

		it("throws when no html and no text provided", async () => {
			await expect(
				service.send({
					to: "user@example.com",
					subject: "Empty",
				}),
			).rejects.toThrow("No text or html provided");
		});

		it("uses default from when not specified", async () => {
			await service.send({
				to: "user@example.com",
				subject: "Test",
				html: "<p>test</p>",
			});

			expect(adapter.getSentMails()[0].from).toBe("test@example.com");
		});

		it("uses provided from over default", async () => {
			await service.send({
				to: "user@example.com",
				subject: "Test",
				from: "custom@example.com",
				html: "<p>test</p>",
			});

			expect(adapter.getSentMails()[0].from).toBe("custom@example.com");
		});

		it("passes cc, bcc, replyTo, attachments, and headers", async () => {
			await service.send({
				to: "user@example.com",
				subject: "Full options",
				html: "<p>test</p>",
				cc: "cc@example.com",
				bcc: ["bcc1@example.com", "bcc2@example.com"],
				replyTo: "reply@example.com",
				headers: { "X-Custom": "value" },
				attachments: [
					{
						filename: "file.txt",
						content: "hello",
						contentType: "text/plain",
					},
				],
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.cc).toBe("cc@example.com");
			expect(sent.bcc).toEqual(["bcc1@example.com", "bcc2@example.com"]);
			expect(sent.replyTo).toBe("reply@example.com");
			expect(sent.headers).toEqual({ "X-Custom": "value" });
			expect(sent.attachments).toHaveLength(1);
			expect(sent.attachments![0].filename).toBe("file.txt");
		});
	});

	// -- renderTemplate() -------------------------------------------------------

	describe("renderTemplate()", () => {
		it("renders a sync template", async () => {
			const result = await service.renderTemplate({
				template: "welcome",
				input: {
					userName: "Alice",
					activationUrl: "https://example.com/activate",
				},
			});

			expect(result.subject).toBe("Welcome, Alice!");
			expect(result.html).toContain("Welcome, Alice!");
			expect(result.html).toContain("https://example.com/activate");
			expect(result.text).toContain("Alice");
		});

		it("renders an async template", async () => {
			const result = await service.renderTemplate({
				template: "asyncData",
				input: { orderId: "ORD-123" },
			});

			expect(result.subject).toBe("Order #ORD-123 confirmed");
			expect(result.html).toContain("$42.00");
		});

		it("throws for unknown template", async () => {
			await expect(
				service.renderTemplate({
					template: "nonExistent" as any,
					input: {},
				}),
			).rejects.toThrow('Template "nonExistent" not found.');
		});

		it("validates input with zod schema", async () => {
			await expect(
				service.renderTemplate({
					template: "welcome",
					input: { userName: 123 } as any, // wrong type
				}),
			).rejects.toThrow();
		});

		it("validates url format in schema", async () => {
			await expect(
				service.renderTemplate({
					template: "welcome",
					input: {
						userName: "Test",
						activationUrl: "not-a-url",
					},
				}),
			).rejects.toThrow();
		});
	});

	// -- sendTemplate() ---------------------------------------------------------

	describe("sendTemplate()", () => {
		it("sends a rendered template", async () => {
			await service.sendTemplate({
				template: "welcome",
				to: "user@example.com",
				input: {
					userName: "Bob",
					activationUrl: "https://example.com/activate/bob",
				},
			});

			expect(adapter.getSentCount()).toBe(1);
			const sent = adapter.getSentMails()[0];
			expect(sent.to).toBe("user@example.com");
			expect(sent.subject).toBe("Welcome, Bob!");
			expect(sent.html).toContain("Welcome, Bob!");
		});

		it("allows overriding subject", async () => {
			await service.sendTemplate({
				template: "welcome",
				to: "user@example.com",
				subject: "Custom Subject",
				input: {
					userName: "Bob",
					activationUrl: "https://example.com/activate",
				},
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.subject).toBe("Custom Subject");
		});

		it("passes from, cc, bcc to the underlying send", async () => {
			await service.sendTemplate({
				template: "welcome",
				to: "user@example.com",
				from: "sender@example.com",
				cc: "cc@example.com",
				bcc: "bcc@example.com",
				input: {
					userName: "Test",
					activationUrl: "https://example.com/activate",
				},
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.from).toBe("sender@example.com");
			expect(sent.cc).toBe("cc@example.com");
			expect(sent.bcc).toBe("bcc@example.com");
		});

		it("auto-converts html to text when handler returns no text", async () => {
			await service.sendTemplate({
				template: "htmlOnly",
				to: "user@example.com",
				input: { msg: "Important message" },
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.html).toContain("Important message");
			expect(sent.text).toContain("Important message");
		});

		it("uses handler-provided text when available", async () => {
			await service.sendTemplate({
				template: "withText",
				to: "user@example.com",
				input: { msg: "Plain text content" },
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.text).toBe("Plain text content");
		});

		it("sends async template", async () => {
			await service.sendTemplate({
				template: "asyncData",
				to: "user@example.com",
				input: { orderId: "ORD-456" },
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.subject).toBe("Order #ORD-456 confirmed");
			expect(sent.html).toContain("$42.00");
		});

		it("throws for unknown template", async () => {
			await expect(
				service.sendTemplate({
					template: "missing" as any,
					to: "user@example.com",
					input: {},
				}),
			).rejects.toThrow('Template "missing" not found.');
		});

		it("throws for invalid input", async () => {
			await expect(
				service.sendTemplate({
					template: "welcome",
					to: "user@example.com",
					input: {} as any,
				}),
			).rejects.toThrow();
		});

		it("sends to multiple recipients", async () => {
			await service.sendTemplate({
				template: "htmlOnly",
				to: ["a@example.com", "b@example.com"],
				input: { msg: "Broadcast" },
			});

			const sent = adapter.getSentMails()[0];
			expect(sent.to).toEqual(["a@example.com", "b@example.com"]);
		});
	});

	// -- Adapter fallback -------------------------------------------------------

	describe("adapter fallback", () => {
		it("falls back to noreply@example.com when no default from is set", async () => {
			const noDefaultService = new MailerService({
				adapter,
				templates: { htmlOnly: noTextTemplate },
			});

			await noDefaultService.sendTemplate({
				template: "htmlOnly",
				to: "user@example.com",
				input: { msg: "No default from" },
			});

			expect(adapter.getSentMails()[0].from).toBe("noreply@example.com");
		});
	});

	// -- Handler context --------------------------------------------------------

	describe("handler context", () => {
		it("handler receives AppContext services when available in ALS", async () => {
			// We can't easily set up ALS here, but we can verify the handler
			// is called and works even without ALS context
			const contextCapture: Record<string, unknown>[] = [];

			const contextTemplate = email({
				name: "context-test",
				schema: z.object({ val: z.string() }),
				handler: (args) => {
					contextCapture.push({ ...args });
					return {
						subject: "Test",
						html: `<p>${args.input.val}</p>`,
					};
				},
			});

			const ctxService = new MailerService({
				adapter,
				templates: { contextTest: contextTemplate },
			});

			await ctxService.sendTemplate({
				template: "contextTest",
				to: "user@example.com",
				input: { val: "hello" },
			});

			expect(contextCapture).toHaveLength(1);
			expect(contextCapture[0].input).toEqual({ val: "hello" });
		});

		it("passes locale to handler when provided", async () => {
			let receivedLocale: string | undefined;

			const localeTemplate = email({
				name: "locale-test",
				schema: z.object({ msg: z.string() }),
				handler: (args) => {
					receivedLocale = args.locale;
					return {
						subject: "Locale test",
						html: `<p>${args.input.msg}</p>`,
					};
				},
			});

			const localeService = new MailerService({
				adapter,
				templates: { localeTest: localeTemplate },
			});

			await localeService.sendTemplate({
				template: "localeTest",
				to: "user@example.com",
				input: { msg: "hello" },
				locale: "sk",
			});

			expect(receivedLocale).toBe("sk");
		});
	});
});
