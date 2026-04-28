/**
 * questpie/storage — public storage entry point.
 *
 * Bundles three things so consumers do not need to mix-and-match imports
 * from `flydrive` and `questpie`:
 *
 *  1. The `R2Driver` factory — wraps flydrive's `S3Driver` with Cloudflare R2
 *     conventions (region "auto", path-style, no ACL) AND defaults the
 *     urlBuilder to the questpie storage proxy.
 *
 *  2. The `makeProxyUrlBuilder` utility — for users who want to plug the
 *     questpie storage proxy into a raw flydrive driver themselves
 *     (S3, GCS, custom). See the storage docs for recipes.
 *
 *  3. Re-exports of flydrive's `S3Driver`, `FSDriver`, `GCSDriver` and their
 *     option types — so a single `from "questpie/storage"` import is enough
 *     to wire any supported backend.
 *
 *  4. Re-exports of the signed-URL helpers (`generateSignedUrlToken`,
 *     `verifySignedUrlToken`, `buildStorageFileUrl`) — useful when serving
 *     files from a custom route or generating short-lived URLs by hand.
 */

// questpie additions
export { R2Driver, type R2DriverOptions } from "#questpie/server/modules/core/integrated/storage/drivers/r2.js";
export {
	makeProxyUrlBuilder,
	type ProxyUrlOptions,
} from "#questpie/server/modules/core/integrated/storage/drivers/factory.js";
export type { StorageDriverFactory } from "#questpie/server/config/types.js";

// signed-URL helpers (also exported from the main `questpie` entry, kept here
// for discoverability when someone is already importing from `questpie/storage`)
export {
	type SignedUrlPayload,
	type StorageUrlConfig,
	buildStorageFileUrl,
	generateFileUrl,
	generateSignedUrlToken,
	verifySignedUrlToken,
} from "#questpie/server/modules/core/integrated/storage/signed-url.js";

// flydrive driver re-exports — single import surface
export { FSDriver } from "flydrive/drivers/fs";
export type { FSDriverOptions } from "flydrive/drivers/fs/types";
export { S3Driver } from "flydrive/drivers/s3";
export type { S3DriverOptions } from "flydrive/drivers/s3/types";
export { GCSDriver } from "flydrive/drivers/gcs";
export type { GCSDriverOptions } from "flydrive/drivers/gcs/types";
export type {
	DriverContract,
	ObjectMetaData,
	ObjectVisibility,
	SignedURLOptions,
	UploadSignedURLOptions,
	WriteOptions,
} from "flydrive/types";
