/**
 * Stable OAuth resource indicator for QUESTPIE HTTP capabilities that are
 * mounted below a configurable adapter base path.
 *
 * Binding to the canonical application origin avoids import-time environment
 * drift and remains valid when an adapter chooses a non-default base path.
 * Individual capabilities still apply their own scope and RBAC gates.
 */
export function questpieApiAudienceForApp(app: {
	config: { app: { url: string } };
}): string {
	const url = new URL(app.config.app.url);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new TypeError("QUESTPIE API audience requires an HTTP(S) app URL");
	}
	return url.origin;
}
