import { MailAdapter } from "../adapter.js";
import type { SerializableMailOptions } from "../types.js";

export const PLUNK_API_BASE_URL = "https://next-api.useplunk.com";

export interface PlunkSendResponse {
	success?: boolean;
	data?: unknown;
	error?: {
		code?: string;
		message?: string;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

export interface PlunkAdapterOptions {
	/**
	 * Plunk secret API key. Public keys are only valid for event tracking.
	 */
	apiKey: string;
	/**
	 * API base URL. Override for self-hosted Plunk.
	 * @default "https://next-api.useplunk.com"
	 */
	baseUrl?: string;
	/**
	 * Custom fetch implementation, useful for tests and non-standard runtimes.
	 */
	fetch?: typeof fetch;
	/**
	 * Sender display name when options.from does not include one.
	 */
	fromName?: string;
	/**
	 * Whether recipients should be subscribed to marketing emails in Plunk.
	 * Transactional emails default to false.
	 */
	subscribed?: boolean;
	/**
	 * Optional callback after Plunk accepts the email.
	 */
	afterSendCallback?: (
		response: PlunkSendResponse,
		options: SerializableMailOptions,
	) => Promise<void> | void;
}

/**
 * HTTP mail adapter for Plunk's transactional email API.
 */
export class PlunkAdapter extends MailAdapter {
	private readonly apiKey: string;
	private readonly baseUrl: string;
	private readonly fetchFn: typeof fetch;
	private readonly fromName?: string;
	private readonly subscribed?: boolean;
	private readonly afterSendCallback?: PlunkAdapterOptions["afterSendCallback"];

	constructor(options: PlunkAdapterOptions) {
		super();
		this.apiKey = options.apiKey;
		this.baseUrl = stripTrailingSlashes(options.baseUrl ?? PLUNK_API_BASE_URL);
		this.fetchFn = options.fetch ?? fetch;
		this.fromName = options.fromName;
		this.subscribed = options.subscribed;
		this.afterSendCallback = options.afterSendCallback;
	}

	async send(options: SerializableMailOptions): Promise<void> {
		assertPlunkSupportedOptions(options);

		const response = await this.fetchFn(`${this.baseUrl}/v1/send`, {
			method: "POST",
			headers: new Headers({
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			}),
			body: JSON.stringify(
				toPlunkPayload(options, {
					fromName: this.fromName,
					subscribed: this.subscribed,
				}),
			),
		});

		const body = await readResponseBody(response);
		const parsed = parseJsonObject<PlunkSendResponse>(body);
		if (!response.ok || parsed.success === false) {
			throw new Error(formatPlunkError(response, parsed, body));
		}

		if (this.afterSendCallback) {
			await this.afterSendCallback(parsed, options);
		}
	}
}

export function plunkAdapter(options: PlunkAdapterOptions): PlunkAdapter {
	return new PlunkAdapter(options);
}

function toPlunkPayload(
	options: SerializableMailOptions,
	config: Pick<PlunkAdapterOptions, "fromName" | "subscribed">,
) {
	const from = parseAddress(options.from);
	return {
		to: options.to,
		subject: options.subject,
		body: options.html || options.text,
		from,
		name: typeof from === "string" ? config.fromName : undefined,
		subscribed: config.subscribed,
		headers: options.headers,
		reply: options.replyTo,
		attachments: options.attachments?.map((attachment) => ({
			filename: attachment.filename,
			content: serializeAttachmentContent(attachment.content),
			contentType: attachment.contentType,
		})),
	};
}

function assertPlunkSupportedOptions(options: SerializableMailOptions): void {
	const unsupported = [
		options.cc ? "cc" : null,
		options.bcc ? "bcc" : null,
	].filter(Boolean);
	if (unsupported.length === 0) return;

	throw new Error(
		`PlunkAdapter does not support ${unsupported.join(", ")} because Plunk's transactional API does not document those fields.`,
	);
}

function parseAddress(
	value: string,
): string | { email: string; name?: string } {
	const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
	if (!match) return value;

	const name = match[1]!.trim().replace(/^["']|["']$/g, "");
	const email = match[2]!.trim();
	return name ? { name, email } : { email };
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

function formatPlunkError(
	response: Response,
	parsed: PlunkSendResponse,
	rawBody: string,
): string {
	const code = parsed.error?.code ? `[${parsed.error.code}] ` : "";
	const message = parsed.error?.message ?? rawBody;
	return `Plunk API error (${response.status} ${response.statusText}): ${code}${message}`;
}

function stripTrailingSlashes(value: string): string {
	return value.replace(/\/+$/, "");
}
