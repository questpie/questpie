import { MailAdapter } from "../adapter.js";
import type { SerializableMailOptions } from "../types.js";

export const RESEND_API_BASE_URL = "https://api.resend.com";

export interface ResendSendResponse {
	id?: string;
	[key: string]: unknown;
}

export interface ResendAdapterOptions {
	/**
	 * Resend API key, or an API key for a Resend-compatible provider.
	 */
	apiKey: string;
	/**
	 * API base URL. Use this for Resend-compatible providers.
	 * @default "https://api.resend.com"
	 */
	baseUrl?: string;
	/**
	 * Custom fetch implementation, useful for tests and non-standard runtimes.
	 */
	fetch?: typeof fetch;
	/**
	 * User-Agent sent to the API. Resend requires this for direct HTTP calls.
	 * @default "questpie-resend-adapter"
	 */
	userAgent?: string;
	/**
	 * Optional static or per-email idempotency key.
	 */
	idempotencyKey?:
		| string
		| ((options: SerializableMailOptions) => string | undefined);
	/**
	 * Optional callback after the provider accepts the email.
	 */
	afterSendCallback?: (
		response: ResendSendResponse,
		options: SerializableMailOptions,
	) => Promise<void> | void;
}

/**
 * HTTP mail adapter for Resend and Resend-compatible APIs.
 */
export class ResendAdapter extends MailAdapter {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchFn: typeof fetch;
	private readonly userAgent: string;
	private readonly idempotencyKey?: ResendAdapterOptions["idempotencyKey"];
	private readonly afterSendCallback?: ResendAdapterOptions["afterSendCallback"];

	constructor(options: ResendAdapterOptions) {
		super();
		this.apiKey = options.apiKey;
		this.baseUrl = stripTrailingSlashes(options.baseUrl ?? RESEND_API_BASE_URL);
		this.fetchFn = options.fetch ?? fetch;
		this.userAgent = options.userAgent ?? "questpie-resend-adapter";
		this.idempotencyKey = options.idempotencyKey;
		this.afterSendCallback = options.afterSendCallback;
	}

	async send(options: SerializableMailOptions): Promise<void> {
		const headers = new Headers({
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
			"User-Agent": this.userAgent,
		});
		const idempotencyKey = this.resolveIdempotencyKey(options);
		if (idempotencyKey) {
			headers.set("Idempotency-Key", idempotencyKey);
		}

		const response = await this.fetchFn(`${this.baseUrl}/emails`, {
			method: "POST",
			headers,
			body: JSON.stringify(toResendPayload(options)),
		});

		const body = await readResponseBody(response);
		if (!response.ok) {
			throw new Error(
				`Resend API error (${response.status} ${response.statusText}): ${body}`,
			);
		}

		const parsed = parseJsonObject<ResendSendResponse>(body);
		if (this.afterSendCallback) {
			await this.afterSendCallback(parsed, options);
		}
	}

	private resolveIdempotencyKey(
		options: SerializableMailOptions,
	): string | undefined {
		if (typeof this.idempotencyKey === "function") {
			return this.idempotencyKey(options);
		}
		return this.idempotencyKey;
	}
}

export function resendAdapter(options: ResendAdapterOptions): ResendAdapter {
	return new ResendAdapter(options);
}

function toResendPayload(options: SerializableMailOptions) {
	return {
		from: options.from,
		to: options.to,
		cc: options.cc,
		bcc: options.bcc,
		reply_to: options.replyTo,
		subject: options.subject,
		text: options.text,
		html: options.html,
		headers: options.headers,
		attachments: options.attachments?.map((attachment) => ({
			filename: attachment.filename,
			content: serializeAttachmentContent(attachment.content),
			content_type: attachment.contentType,
		})),
	};
}

function serializeAttachmentContent(content: Buffer | string): string {
	if (typeof content === "string") return content;
	return Buffer.from(content).toString("base64");
}

async function readResponseBody(response: Response): Promise<string> {
	const text = await response.text();
	return text || response.statusText;
}

function parseJsonObject<T extends Record<string, unknown>>(text: string): T {
	if (!text) return {} as T;
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object") return parsed as T;
	} catch {
		return { raw: text } as unknown as T;
	}
	return { raw: text } as unknown as T;
}

function stripTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}
