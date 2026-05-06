import { describe, expect, it } from "bun:test";

import { PlunkAdapter } from "../../../src/server/modules/core/integrated/mailer/adapters/plunk.adapter.js";
import { ResendAdapter } from "../../../src/server/modules/core/integrated/mailer/adapters/resend.adapter.js";

type FetchCall = {
	input: RequestInfo | URL;
	init?: RequestInit;
};

function createFetchMock(
	responseBody: unknown = { id: "email_123", success: true },
	responseInit: ResponseInit = { status: 200, statusText: "OK" },
) {
	const calls: FetchCall[] = [];
	const fetchMock: typeof fetch = async (input, init) => {
		calls.push({ input, init });
		return new Response(JSON.stringify(responseBody), responseInit);
	};
	return { calls, fetchMock };
}

function parseBody(call: FetchCall): Record<string, any> {
	return JSON.parse(String(call.init?.body));
}

function headersOf(call: FetchCall): Headers {
	return new Headers(call.init?.headers as HeadersInit);
}

describe("ResendAdapter", () => {
	it("sends Questpie mail options to the Resend HTTP API", async () => {
		const { calls, fetchMock } = createFetchMock({ id: "email_123" });
		const sentResponses: unknown[] = [];
		const adapter = new ResendAdapter({
			apiKey: "re_test",
			fetch: fetchMock,
			idempotencyKey: "request-key",
			afterSendCallback: (response) => {
				sentResponses.push(response);
			},
		});

		await adapter.send({
			from: "Acme <noreply@example.com>",
			to: ["user@example.com"],
			cc: "cc@example.com",
			bcc: ["bcc@example.com"],
			replyTo: "reply@example.com",
			subject: "Hello",
			text: "Hello text",
			html: "<p>Hello html</p>",
			headers: { "X-Custom": "value" },
			attachments: [
				{
					filename: "hello.txt",
					content: Buffer.from("hello"),
					contentType: "text/plain",
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(String(calls[0].input)).toBe("https://api.resend.com/emails");
		expect(calls[0].init?.method).toBe("POST");

		const headers = headersOf(calls[0]);
		expect(headers.get("Authorization")).toBe("Bearer re_test");
		expect(headers.get("Content-Type")).toBe("application/json");
		expect(headers.get("User-Agent")).toBe("questpie-resend-adapter");
		expect(headers.get("Idempotency-Key")).toBe("request-key");

		const body = parseBody(calls[0]);
		expect(body).toEqual({
			from: "Acme <noreply@example.com>",
			to: ["user@example.com"],
			cc: "cc@example.com",
			bcc: ["bcc@example.com"],
			reply_to: "reply@example.com",
			subject: "Hello",
			text: "Hello text",
			html: "<p>Hello html</p>",
			headers: { "X-Custom": "value" },
			attachments: [
				{
					filename: "hello.txt",
					content: Buffer.from("hello").toString("base64"),
					content_type: "text/plain",
				},
			],
		});
		expect(sentResponses).toEqual([{ id: "email_123" }]);
	});

	it("supports Resend-compatible base URLs", async () => {
		const { calls, fetchMock } = createFetchMock();
		const adapter = new ResendAdapter({
			apiKey: "as_test",
			baseUrl: "https://api.aisend.app/v1/",
			fetch: fetchMock,
		});

		await adapter.send({
			from: "noreply@example.com",
			to: "user@example.com",
			subject: "Hello",
			text: "Hello",
			html: "",
		});

		expect(String(calls[0].input)).toBe("https://api.aisend.app/v1/emails");
	});

	it("throws provider errors", async () => {
		const { fetchMock } = createFetchMock(
			{ message: "Invalid API key" },
			{ status: 401, statusText: "Unauthorized" },
		);
		const adapter = new ResendAdapter({
			apiKey: "bad",
			fetch: fetchMock,
		});

		await expect(
			adapter.send({
				from: "noreply@example.com",
				to: "user@example.com",
				subject: "Hello",
				text: "Hello",
				html: "",
			}),
		).rejects.toThrow("Resend API error (401 Unauthorized)");
	});
});

describe("PlunkAdapter", () => {
	it("sends Questpie mail options to the Plunk transactional API", async () => {
		const { calls, fetchMock } = createFetchMock({
			success: true,
			data: { email: "email_123" },
		});
		const adapter = new PlunkAdapter({
			apiKey: "sk_test",
			fetch: fetchMock,
			subscribed: false,
		});

		await adapter.send({
			from: "Acme <noreply@example.com>",
			to: ["user@example.com"],
			replyTo: "reply@example.com",
			subject: "Hello",
			text: "Hello text",
			html: "<p>Hello html</p>",
			headers: { "X-Custom": "value" },
			attachments: [
				{
					filename: "invoice.pdf",
					content: Buffer.from("pdf"),
					contentType: "application/pdf",
				},
			],
		});

		expect(calls).toHaveLength(1);
		expect(String(calls[0].input)).toBe(
			"https://next-api.useplunk.com/v1/send",
		);
		expect(calls[0].init?.method).toBe("POST");

		const headers = headersOf(calls[0]);
		expect(headers.get("Authorization")).toBe("Bearer sk_test");
		expect(headers.get("Content-Type")).toBe("application/json");

		const body = parseBody(calls[0]);
		expect(body).toEqual({
			to: ["user@example.com"],
			subject: "Hello",
			body: "<p>Hello html</p>",
			from: { name: "Acme", email: "noreply@example.com" },
			subscribed: false,
			headers: { "X-Custom": "value" },
			reply: "reply@example.com",
			attachments: [
				{
					filename: "invoice.pdf",
					content: Buffer.from("pdf").toString("base64"),
					contentType: "application/pdf",
				},
			],
		});
	});

	it("supports self-hosted Plunk base URLs", async () => {
		const { calls, fetchMock } = createFetchMock();
		const adapter = new PlunkAdapter({
			apiKey: "sk_test",
			baseUrl: "https://plunk.example.com/",
			fetch: fetchMock,
			fromName: "Acme",
		});

		await adapter.send({
			from: "noreply@example.com",
			to: "user@example.com",
			subject: "Hello",
			text: "Hello text",
			html: "",
		});

		expect(String(calls[0].input)).toBe("https://plunk.example.com/v1/send");
		expect(parseBody(calls[0]).name).toBe("Acme");
	});

	it("does not silently drop cc or bcc", async () => {
		const { fetchMock } = createFetchMock();
		const adapter = new PlunkAdapter({
			apiKey: "sk_test",
			fetch: fetchMock,
		});

		await expect(
			adapter.send({
				from: "noreply@example.com",
				to: "user@example.com",
				cc: "cc@example.com",
				subject: "Hello",
				text: "Hello text",
				html: "",
			}),
		).rejects.toThrow("PlunkAdapter does not support cc");
	});
});
