import type { QuestpieConfig } from "#questpie/server/config/types.js";

import {
	buildStorageFileUrl,
	generateSignedUrlToken,
} from "../signed-url.js";

const DEFAULT_BASE_PATH = "/";
const DEFAULT_SECRET = "questpie-default-secret";
const DEFAULT_EXPIRATION_SECONDS = 3600;

/**
 * Options shared by every wrapper driver in `questpie/storage`.
 */
export interface ProxyUrlOptions {
	/**
	 * Optional public/CDN base URL for serving public files directly,
	 * bypassing the storage proxy.
	 *
	 * When set, `generateURL(key)` returns `${publicUrl}/${key}`.
	 * Use for:
	 *  - Cloudflare R2 with `*.r2.dev` or a custom domain on a public bucket
	 *  - S3/CloudFront distributions
	 *  - GCS with public bucket + DNS
	 *
	 * Signed URLs (private files) ALWAYS go through the questpie proxy
	 * regardless of this setting, so visibility-aware access control
	 * stays in effect.
	 */
	publicUrl?: string;
}

/**
 * Builds a pair of `(key) => string` resolvers that produce questpie proxy URLs
 * for both public and private (signed) access, using the resolved app config.
 *
 * Each driver wires these into its native urlBuilder shape — flydrive passes
 * different extra arguments per driver (`filePath` for FS, `bucket`/`client`
 * for S3, `bucket`/`storage` for GCS), but only `key` matters for the proxy.
 */
export function makeProxyUrlBuilder(
	config: QuestpieConfig,
	options: ProxyUrlOptions = {},
): {
	generateURL: (key: string) => Promise<string>;
	generateSignedURL: (key: string, expiresIn?: number | string) => Promise<string>;
} {
	const baseUrl = config.app.url;
	const basePath = config.storage?.basePath || DEFAULT_BASE_PATH;
	const secret = config.secret || DEFAULT_SECRET;
	const defaultExpiration =
		config.storage?.signedUrlExpiration || DEFAULT_EXPIRATION_SECONDS;
	const publicUrl = options.publicUrl?.replace(/\/$/, "");

	return {
		async generateURL(key) {
			if (publicUrl) {
				return `${publicUrl}/${key}`;
			}
			return buildStorageFileUrl(baseUrl, basePath, key);
		},
		async generateSignedURL(key, expiresIn) {
			const seconds = resolveExpirationSeconds(expiresIn, defaultExpiration);
			const token = await generateSignedUrlToken(key, secret, seconds);
			return buildStorageFileUrl(baseUrl, basePath, key, token);
		},
	};
}

/**
 * flydrive accepts `expiresIn` as either a number of milliseconds or a string
 * (parsed as ms by flydrive itself). Our token API takes seconds, so we
 * normalise here. Falls back to the configured default when nothing is
 * provided or parsing fails.
 */
function resolveExpirationSeconds(
	expiresIn: number | string | undefined,
	fallbackSeconds: number,
): number {
	if (expiresIn === undefined) return fallbackSeconds;

	const ms =
		typeof expiresIn === "string"
			? Number.parseInt(expiresIn, 10)
			: expiresIn;

	if (!Number.isFinite(ms) || ms <= 0) return fallbackSeconds;

	const seconds = Math.floor(ms / 1000);
	return seconds > 0 ? seconds : fallbackSeconds;
}
