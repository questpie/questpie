import { S3Driver } from "flydrive/drivers/s3";
import type { S3DriverOptions } from "flydrive/drivers/s3/types";
import type { DriverContract } from "flydrive/types";

import type {
	QuestpieConfig,
	StorageDriverFactory,
} from "#questpie/server/config/types.js";

import { makeProxyUrlBuilder, type ProxyUrlOptions } from "./factory.js";

/**
 * Cloudflare R2 conventions that flydrive's raw `S3Driver` does not apply
 * automatically. Without these, the driver behaves like generic S3 and silently
 * misconfigures itself against R2:
 *
 *  - `region: "auto"` — R2 ignores region but `@aws-sdk/client-s3` rejects undefined.
 *  - `forcePathStyle: true` — R2 only supports path-style URLs.
 *  - `supportsACL: false` — R2 has no per-object ACL API; flydrive must skip it
 *    or every put/getVisibility call errors with "method not allowed".
 */
const R2_DEFAULTS = {
	region: "auto" as const,
	forcePathStyle: true as const,
	supportsACL: false as const,
};

/**
 * R2Driver options. Same shape as flydrive's `S3DriverOptions` minus the three
 * R2-required defaults that we apply unconditionally.
 *
 * If you need to override one of those defaults (e.g. you're pointing this at
 * a non-R2 S3-compatible service that does expose ACLs), use the raw flydrive
 * `S3Driver` directly with the `makeProxyUrlBuilder` utility instead.
 */
export type R2DriverOptions = Omit<
	S3DriverOptions,
	"region" | "forcePathStyle" | "supportsACL"
> &
	ProxyUrlOptions;

/**
 * Factory for a flydrive `S3Driver` pre-configured for Cloudflare R2.
 *
 * Returns a `StorageDriverFactory` so questpie can wire `app.url` / `secret`
 * into the urlBuilder at app boot. Pass it directly as `storage.driver`:
 *
 * ```ts
 * import { R2Driver } from "questpie/storage";
 *
 * runtimeConfig({
 *   storage: {
 *     driver: R2Driver({
 *       bucket: process.env.R2_BUCKET!,
 *       endpoint: process.env.R2_ENDPOINT!,
 *       credentials: {
 *         accessKeyId: process.env.R2_ACCESS_KEY_ID!,
 *         secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
 *       },
 *       visibility: "public",
 *       // optional: serve public files from your r2.dev or custom domain
 *       publicUrl: "https://cdn.example.com",
 *     }),
 *   },
 * });
 * ```
 *
 * Defaults applied:
 *  - `urlBuilder.generateURL` → questpie storage proxy (or `publicUrl/<key>` if set)
 *  - `urlBuilder.generateSignedURL` → questpie proxy + signed token (always)
 *  - R2-specific: `region: "auto"`, `forcePathStyle: true`, `supportsACL: false`
 */
export function R2Driver(options: R2DriverOptions): StorageDriverFactory {
	const { publicUrl, ...s3Options } = options;

	return (config: QuestpieConfig): DriverContract => {
		const proxy = makeProxyUrlBuilder(config, { publicUrl });

		// flydrive's S3 urlBuilder signature: (key, ...) — extras (bucket, client,
		// expiresIn) are ignored except for `expiresIn` on signed URLs.
		const proxyUrlBuilder: NonNullable<S3DriverOptions["urlBuilder"]> = {
			generateURL: (key: string) => proxy.generateURL(key),
			generateSignedURL: (
				key: string,
				_options: unknown,
				_client: unknown,
				expiresIn?: number | string,
			) => proxy.generateSignedURL(key, expiresIn),
		};

		return new S3Driver({
			...R2_DEFAULTS,
			...(s3Options as S3DriverOptions),
			urlBuilder: {
				...proxyUrlBuilder,
				...(s3Options.urlBuilder ?? {}),
			},
		} as S3DriverOptions);
	};
}
