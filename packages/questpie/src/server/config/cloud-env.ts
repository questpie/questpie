import type { Adapter } from "files-sdk";

import type { DbConfig, StorageConfig } from "#questpie/server/config/types.js";
import { getEnv } from "#questpie/server/utils/env.js";

// ============================================================================
// Cloud environment variable names
// ============================================================================

/** QUESTPIE Cloud environment variable names, auto-injected at deploy time. */
export const CLOUD_ENV = {
	/** Database connection URL. */
	DB: "QUESTPIE_DB",
	/** Application URL (public-facing). */
	APP_URL: "QUESTPIE_APP_URL",
	/** Signing secret for tokens, cookies, signed URLs. */
	SECRET: "QUESTPIE_SECRET",
	/** S3-compatible storage endpoint. */
	STORAGE_ENDPOINT: "QUESTPIE_STORAGE_ENDPOINT",
	/** S3 bucket name. */
	STORAGE_BUCKET: "QUESTPIE_STORAGE_BUCKET",
	/** S3 region. */
	STORAGE_REGION: "QUESTPIE_STORAGE_REGION",
	/** S3 access key ID. */
	STORAGE_ACCESS_KEY: "QUESTPIE_STORAGE_ACCESS_KEY",
	/** S3 secret access key. */
	STORAGE_SECRET_KEY: "QUESTPIE_STORAGE_SECRET_KEY",
} as const;

/** Standard (non-Cloud) fallback env var names. */
const FALLBACK_ENV = {
	DB: "DATABASE_URL",
	APP_URL: "APP_URL",
	SECRET: "BETTER_AUTH_SECRET",
} as const;

const DEFAULT_APP_URL = "http://localhost:3000";

const STORAGE_CONFIG_KEYS = new Set([
	"adapter",
	"basePath",
	"defaultVisibility",
	"driver",
	"files",
	"location",
	"signedUrlExpiration",
]);

const STORAGE_CONFIG_LEGACY_KEYS = new Set(["driver", "files"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertValidStorageConfig(
	storage: unknown,
): asserts storage is StorageConfig {
	if (storage === undefined) return;

	if (!isRecord(storage)) {
		throw new Error(
			"[questpie] Invalid storage config. Use `storage: { adapter }` or local storage options.",
		);
	}

	const legacyKeys = Object.keys(storage).filter((key) =>
		STORAGE_CONFIG_LEGACY_KEYS.has(key),
	);
	if (legacyKeys.length > 0) {
		throw new Error(
			`[questpie] Unsupported storage config key(s): ${legacyKeys.join(", ")}. Use ` +
				"`storage: { adapter }` for Files SDK adapters or local storage options.",
		);
	}

	const unknownKeys = Object.keys(storage).filter(
		(key) => !STORAGE_CONFIG_KEYS.has(key),
	);
	if (unknownKeys.length > 0) {
		throw new Error(
			`[questpie] Unknown storage config key(s): ${unknownKeys.join(", ")}. Use ` +
				"`storage: { adapter }` for Files SDK adapters or local storage options.",
		);
	}

	if ("adapter" in storage && storage.adapter === undefined) {
		throw new Error(
			"[questpie] Invalid storage config. `adapter` must be a Files SDK adapter.",
		);
	}

	if ("adapter" in storage && "location" in storage) {
		throw new Error(
			"[questpie] Invalid storage config. `adapter` and `location` cannot be configured together.",
		);
	}
}

// ============================================================================
// Detection helpers
// ============================================================================

/**
 * Check if any QUESTPIE Cloud environment variable is set.
 * Useful for logging / conditional behavior.
 */
export function isQuestpieCloud(): boolean {
	return Boolean(
		getEnv(CLOUD_ENV.DB) ||
		getEnv(CLOUD_ENV.APP_URL) ||
		getEnv(CLOUD_ENV.STORAGE_ENDPOINT),
	);
}

// ============================================================================
// Individual resolvers (QUESTPIE_* → standard fallback → default)
// ============================================================================

/**
 * Resolve application URL.
 * Priority: explicit → QUESTPIE_APP_URL → APP_URL → "http://localhost:3000"
 */
export function resolveAppUrl(explicit?: string): string {
	return (
		explicit ||
		getEnv(CLOUD_ENV.APP_URL) ||
		getEnv(FALLBACK_ENV.APP_URL) ||
		DEFAULT_APP_URL
	);
}

/**
 * Resolve database config.
 * Priority: explicit → QUESTPIE_DB → DATABASE_URL → throws
 */
export function resolveDbConfig(explicit?: DbConfig): DbConfig {
	if (explicit) return explicit;

	const url = getEnv(CLOUD_ENV.DB) || getEnv(FALLBACK_ENV.DB) || undefined;

	if (!url) {
		throw new Error(
			"[questpie] No database URL configured. " +
				"Provide `db` in runtimeConfig(), or set the QUESTPIE_DB or DATABASE_URL environment variable.",
		);
	}

	return { url };
}

/**
 * Resolve signing secret.
 * Priority: explicit → QUESTPIE_SECRET → BETTER_AUTH_SECRET → undefined
 */
export function resolveSecret(explicit?: string): string | undefined {
	return (
		explicit ||
		getEnv(CLOUD_ENV.SECRET) ||
		getEnv(FALLBACK_ENV.SECRET) ||
		undefined
	);
}

/**
 * Resolve storage config.
 * Priority: explicit → auto-detect from QUESTPIE_STORAGE_* → undefined (framework default)
 *
 * When QUESTPIE_STORAGE_* env vars are present, a lazy Files SDK S3 adapter is created.
 * The actual S3 adapter import happens on first storage operation (requires
 * `@aws-sdk/client-s3`, `@aws-sdk/lib-storage`,
 * `@aws-sdk/s3-presigned-post`, and `@aws-sdk/s3-request-presigner` to be
 * installed).
 */
export function resolveStorageConfig(
	explicit?: unknown,
): StorageConfig | undefined {
	if (explicit !== undefined) {
		assertValidStorageConfig(explicit);
		return explicit;
	}

	const endpoint = getEnv(CLOUD_ENV.STORAGE_ENDPOINT);
	if (!endpoint) return undefined;

	const bucket = getEnv(CLOUD_ENV.STORAGE_BUCKET);
	const region = getEnv(CLOUD_ENV.STORAGE_REGION) ?? "auto";
	const accessKey = getEnv(CLOUD_ENV.STORAGE_ACCESS_KEY);
	const secretKey = getEnv(CLOUD_ENV.STORAGE_SECRET_KEY);

	if (!bucket || !accessKey || !secretKey) {
		console.warn(
			"[questpie] QUESTPIE_STORAGE_ENDPOINT is set but missing required env vars: " +
				"QUESTPIE_STORAGE_BUCKET, QUESTPIE_STORAGE_ACCESS_KEY, QUESTPIE_STORAGE_SECRET_KEY. " +
				"Falling back to local storage.",
		);
		return undefined;
	}

	return {
		adapter: createLazyS3StorageAdapter({
			endpoint,
			bucket,
			region,
			accessKey,
			secretKey,
		}),
	};
}

// ============================================================================
// Lazy S3 adapter — defers dynamic import until first storage operation
// ============================================================================

interface S3StorageOptions {
	endpoint: string;
	bucket: string;
	region: string;
	accessKey: string;
	secretKey: string;
}

const S3_ADAPTER_METHODS = new Set([
	"upload",
	"download",
	"head",
	"exists",
	"delete",
	"deleteMany",
	"copy",
	"list",
	"url",
	"signedUploadUrl",
]);

const S3_ADAPTER_PROPERTIES = new Map<PropertyKey, unknown>([
	["reportsUploadProgress", true],
	["supportsRange", true],
]);

/**
 * Creates a Files SDK adapter proxy that lazily loads `files-sdk/s3`
 * via dynamic import on first method call.
 *
 * All adapter methods are async, so the lazy init is transparent.
 * The S3 adapter import requires the AWS SDK peer dependencies to be installed.
 */
function createLazyS3StorageAdapter(options: S3StorageOptions): Adapter {
	let adapter: Adapter | undefined;
	let initPromise: Promise<Adapter> | undefined;

	const ensureAdapter = (): Promise<Adapter> => {
		if (adapter) return Promise.resolve(adapter);
		if (!initPromise) {
			initPromise = import("files-sdk/s3")
				.then(({ s3 }) => {
					adapter = s3({
						credentials: {
							accessKeyId: options.accessKey,
							secretAccessKey: options.secretKey,
						},
						region: options.region,
						bucket: options.bucket,
						endpoint: options.endpoint,
						forcePathStyle: true,
					});
					return adapter;
				})
				.catch((err) => {
					throw new Error(
						"[questpie] QUESTPIE_STORAGE_* env vars detected but Files SDK S3 adapter could not be loaded. " +
							"Install @aws-sdk/client-s3, @aws-sdk/lib-storage, @aws-sdk/s3-presigned-post, and @aws-sdk/s3-request-presigner as dependencies.\n" +
							`Cause: ${err instanceof Error ? err.message : String(err)}`,
					);
				});
		}
		return initPromise;
	};

	const handler: ProxyHandler<object> = {
		get(_, prop) {
			// Prevent the proxy from being treated as a thenable
			if (prop === "then" || typeof prop === "symbol") {
				return undefined;
			}
			if (adapter) {
				return Reflect.get(adapter, prop);
			}
			if (prop === "name") return "s3";
			if (prop === "raw") return undefined;
			if (S3_ADAPTER_PROPERTIES.has(prop)) {
				return S3_ADAPTER_PROPERTIES.get(prop);
			}
			if (!S3_ADAPTER_METHODS.has(prop as string)) {
				return undefined;
			}
			return async (...args: unknown[]) => {
				const d = await ensureAdapter();
				const fn = (d as unknown as Record<string, unknown>)[prop as string];
				if (typeof fn === "function") {
					return fn.apply(d, args);
				}
				return fn;
			};
		},
		has(_, prop) {
			if (adapter) {
				return prop in adapter;
			}
			return (
				prop === "name" ||
				prop === "raw" ||
				S3_ADAPTER_PROPERTIES.has(prop) ||
				S3_ADAPTER_METHODS.has(prop as string)
			);
		},
	};

	return new Proxy({}, handler) as Adapter;
}
