import { CrdtAuthorizationRejectedError } from "./authorization.js";

export function canonicalizeCrdtBrowserOrigin(input: {
	origin: string | null;
	appUrl: string;
	allowedOrigins?: readonly string[];
}): string {
	const allowed = new Set<string>();
	allowed.add(configuredAppOrigin(input.appUrl));
	for (const candidate of input.allowedOrigins ?? []) {
		allowed.add(configuredAllowedOrigin(candidate));
	}

	const origin = requestOrigin(input.origin);
	if (!allowed.has(origin)) {
		throw new CrdtAuthorizationRejectedError();
	}
	return origin;
}

function configuredAppOrigin(value: string): string {
	try {
		const url = new URL(value);
		assertHttpOriginUrl(url);
		return url.origin;
	} catch {
		throw new TypeError("QUESTPIE app URL must have a valid HTTP(S) origin");
	}
}

function configuredAllowedOrigin(value: string): string {
	try {
		return strictOrigin(value);
	} catch {
		throw new TypeError("CRDT allowed origin must be an HTTP(S) origin");
	}
}

function requestOrigin(value: string | null): string {
	try {
		if (value === null || value === "null") throw new Error();
		return strictOrigin(value);
	} catch {
		throw new CrdtAuthorizationRejectedError();
	}
}

function strictOrigin(value: string): string {
	if (
		value.trim() !== value ||
		!/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\\]+$/.test(value)
	) {
		throw new Error();
	}
	const url = new URL(value);
	assertHttpOriginUrl(url);
	if (url.hostname.endsWith(".")) throw new Error();
	return url.origin;
}

function assertHttpOriginUrl(url: URL): void {
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username !== "" ||
		url.password !== "" ||
		url.origin === "null"
	) {
		throw new Error();
	}
}
