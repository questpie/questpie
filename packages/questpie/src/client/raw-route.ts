import type { GetAuthHeaders } from "./auth.js";

/** Execute a raw route without adding the JSON wire contract. */
export async function callRawRoute(
	fetcher: typeof fetch,
	url: string,
	method: string,
	options: Omit<RequestInit, "method">,
	defaultHeaders: Record<string, string>,
	getAuthHeaders?: GetAuthHeaders,
): Promise<Response> {
	const headers = new Headers(defaultHeaders);
	for (const source of [options.headers, await getAuthHeaders?.()]) {
		new Headers(source).forEach((value, key) => headers.set(key, value));
	}

	return fetcher(url, {
		...options,
		method,
		headers,
		credentials: options.credentials ?? "include",
	});
}
