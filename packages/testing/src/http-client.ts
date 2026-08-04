import { createRedactor } from "./redact.js";

const DEFAULT_MAX_BODY_CHARS = 2_048;

export interface HttpClientOptions {
	/** Origin the client resolves paths against, for example a harness base URL. */
	baseUrl: string;
	/** Exact values replaced in rendered errors. Cookie values are added as they arrive. */
	secrets?: readonly string[];
	/** Bound on the body length carried into a rendered error. */
	maxBodyChars?: number;
}

export interface HttpRequestInit extends Omit<RequestInit, "body"> {
	body?: BodyInit;
	/** Serialized as the body with a JSON content type. Rejected together with `body`. */
	json?: unknown;
}

export interface HttpUploadFile {
	content: string | Uint8Array | Blob;
	filename: string;
	type?: string;
}

export interface HttpUploadInit {
	fields?: Readonly<Record<string, string>>;
	files?: Readonly<Record<string, HttpUploadFile>>;
	method?: string;
	headers?: HeadersInit;
}

export interface HttpResponse {
	readonly status: number;
	readonly headers: Headers;
	/** Body exactly as it arrived, before any parsing. */
	readonly body: string;
	/** Parses the body as JSON. Throws `HttpJsonError` when it is not JSON. */
	json<T = unknown>(): T;
}

export interface HttpCookieJar {
	get(name: string): string | undefined;
	/** The `Cookie` header the next request would send, empty when there is none. */
	header(): string;
	clear(): void;
}

export interface HttpClient {
	readonly baseUrl: string;
	readonly cookies: HttpCookieJar;
	request(path: string, init?: HttpRequestInit): Promise<HttpResponse>;
	/** Multipart request. Building the `FormData` is the fiddly part, so it is done here. */
	upload(path: string, init?: HttpUploadInit): Promise<HttpResponse>;
	/** Registers a value to replace in rendered errors. */
	addSecret(value: string): void;
	/** Replaces every registered secret and cookie value. */
	redact(value: string): string;
}

/**
 * A body that was asked for as JSON and is not JSON. It keeps the status and
 * the raw body, because the useful part of a failure is usually the HTML error
 * page the proxy returned, not the parse error.
 */
export class HttpJsonError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string,
	) {
		super(
			`Response with status ${status} is not JSON. Body: ${body || "(empty)"}`,
		);
		this.name = "HttpJsonError";
	}
}

/**
 * A transport for scenario tests: it carries cookies and shapes requests.
 *
 * It is deliberately not an auth DSL. Who logs in, with which credentials and
 * against which route belongs to the application, so a domain flow is written
 * by driving this client rather than by configuring it.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
	const baseUrl = validateBaseUrl(options.baseUrl);
	const maxBodyChars = positive(
		options.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS,
		"maxBodyChars",
	);
	const secrets = new Set((options.secrets ?? []).filter(Boolean));
	const jar = new Map<string, string>();

	const redact = (value: string): string =>
		createRedactor([...secrets, ...jar.values()])(value);

	const send = async (
		path: string,
		requestInit: RequestInit,
	): Promise<HttpResponse> => {
		const headers = new Headers(requestInit.headers);
		const cookie = cookieHeader(jar);
		if (cookie) headers.set("cookie", cookie);

		const response = await fetch(new URL(path, baseUrl), {
			...requestInit,
			headers,
			// The caller inspects the redirect. A login that answers 302 with a
			// session cookie is the flow under test, not a hop to follow.
			redirect: "manual",
		});
		absorbCookies(jar, response.headers);

		const body = await response.text();
		return {
			status: response.status,
			headers: response.headers,
			body,
			json<T>(): T {
				try {
					return JSON.parse(body) as T;
				} catch {
					throw new HttpJsonError(
						response.status,
						redact(body.slice(0, maxBodyChars)),
					);
				}
			},
		};
	};

	return {
		baseUrl,
		cookies: {
			get: (name) => jar.get(name),
			header: () => cookieHeader(jar),
			clear: () => jar.clear(),
		},
		request(path, init = {}) {
			const { json, body, ...rest } = init;
			if (json !== undefined && body !== undefined) {
				throw new TypeError("Pass either json or body, not both");
			}
			if (json === undefined) return send(path, { ...rest, body });

			const headers = new Headers(rest.headers);
			if (!headers.has("content-type")) {
				headers.set("content-type", "application/json");
			}
			return send(path, {
				...rest,
				headers,
				body: JSON.stringify(json),
			});
		},
		upload(path, init = {}) {
			const form = new FormData();
			for (const [name, value] of Object.entries(init.fields ?? {})) {
				form.append(name, value);
			}
			for (const [name, file] of Object.entries(init.files ?? {})) {
				form.append(name, toBlob(file), file.filename);
			}
			// Content-Type is left unset on purpose. fetch writes it from the
			// FormData together with the multipart boundary, and a hand-written
			// one has no boundary and cannot be parsed.
			return send(path, {
				method: init.method ?? "POST",
				headers: init.headers,
				body: form,
			});
		},
		addSecret(value) {
			if (value) secrets.add(value);
		},
		redact,
	};
}

function validateBaseUrl(value: string): string {
	if (!value) throw new TypeError("baseUrl is required");
	try {
		return new URL(value).toString();
	} catch {
		throw new TypeError(`baseUrl must be an absolute URL, received "${value}"`);
	}
}

function positive(value: number, name: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(`${name} must be a positive number`);
	}
	return value;
}

function toBlob(file: HttpUploadFile): Blob {
	if (file.content instanceof Blob) return file.content;
	const type = file.type ?? "application/octet-stream";
	return new Blob([file.content as BlobPart], { type });
}

function cookieHeader(jar: ReadonlyMap<string, string>): string {
	return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function absorbCookies(jar: Map<string, string>, headers: Headers): void {
	// One response can set several cookies, and a login usually does: a session
	// and a tenant. getSetCookie keeps them apart; reading the header as one
	// string would join them on the comma inside an Expires date.
	for (const header of headers.getSetCookie()) {
		const [pair, ...attributes] = header.split(";");
		const separator = pair.indexOf("=");
		if (separator <= 0) continue;

		const name = pair.slice(0, separator).trim();
		const value = pair.slice(separator + 1).trim();
		if (isExpired(attributes)) jar.delete(name);
		else jar.set(name, value);
	}
}

function isExpired(attributes: readonly string[]): boolean {
	for (const attribute of attributes) {
		const separator = attribute.indexOf("=");
		if (separator <= 0) continue;
		const name = attribute.slice(0, separator).trim().toLowerCase();
		const value = attribute.slice(separator + 1).trim();

		if (name === "max-age") return Number(value) <= 0;
		if (name === "expires") {
			const at = Date.parse(value);
			if (!Number.isNaN(at) && at <= Date.now()) return true;
		}
	}
	return false;
}
