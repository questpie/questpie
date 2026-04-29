import type { DbConfig, StorageConfig } from "#questpie/server/config/types.js";

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

// ============================================================================
// Detection helpers
// ============================================================================

/**
 * Check if any QUESTPIE Cloud environment variable is set.
 * Useful for logging / conditional behavior.
 */
export function isQuestpieCloud(): boolean {
	return Boolean(
		process.env[CLOUD_ENV.DB] ||
		process.env[CLOUD_ENV.APP_URL] ||
		process.env[CLOUD_ENV.STORAGE_ENDPOINT],
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
		process.env[CLOUD_ENV.APP_URL] ||
		process.env[FALLBACK_ENV.APP_URL] ||
		DEFAULT_APP_URL
	);
}

/**
 * Resolve database config.
 * Priority: explicit → QUESTPIE_DB → DATABASE_URL → throws
 */
export function resolveDbConfig(explicit?: DbConfig): DbConfig {
	if (explicit) return explicit;

	const url =
		process.env[CLOUD_ENV.DB] || process.env[FALLBACK_ENV.DB] || undefined;

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
		process.env[CLOUD_ENV.SECRET] ||
		process.env[FALLBACK_ENV.SECRET] ||
		undefined
	);
}

/**
 * Resolve storage config.
 * Priority: explicit → auto-detect from QUESTPIE_STORAGE_* → undefined (framework default)
 *
 * When QUESTPIE_STORAGE_* env vars are present, a lazy S3 driver is created.
 * The actual S3Driver import happens on first storage operation (requires
 * `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` to be installed).
 */
export function resolveStorageConfig(
	explicit?: StorageConfig,
): StorageConfig | undefined {
	if (explicit) return explicit;

	const endpoint = process.env[CLOUD_ENV.STORAGE_ENDPOINT];
	if (!endpoint) return undefined;

	const bucket = process.env[CLOUD_ENV.STORAGE_BUCKET];
	const region = process.env[CLOUD_ENV.STORAGE_REGION] ?? "auto";
	const accessKey = process.env[CLOUD_ENV.STORAGE_ACCESS_KEY];
	const secretKey = process.env[CLOUD_ENV.STORAGE_SECRET_KEY];

	if (!bucket || !accessKey || !secretKey) {
		console.warn(
			"[questpie] QUESTPIE_STORAGE_ENDPOINT is set but missing required env vars: " +
				"QUESTPIE_STORAGE_BUCKET, QUESTPIE_STORAGE_ACCESS_KEY, QUESTPIE_STORAGE_SECRET_KEY. " +
				"Falling back to local storage.",
		);
		return undefined;
	}

	return {
		driver: createLazyS3Driver({
			endpoint,
			bucket,
			region,
			accessKey,
			secretKey,
		}),
	};
}

// ============================================================================
// Lazy S3 driver — defers dynamic import until first storage operation
// ============================================================================

interface S3DriverOptions {
	endpoint: string;
	bucket: string;
	region: string;
	accessKey: string;
	secretKey: string;
}

/**
 * Creates a DriverContract proxy that lazily loads `flydrive/drivers/s3`
 * via dynamic import on first method call.
 *
 * All DriverContract methods are async, so the lazy init is transparent.
 * The S3Driver import requires `@aws-sdk/client-s3` to be installed.
 */
function createLazyS3Driver(options: S3DriverOptions) {
	type DriverContract = import("flydrive/types").DriverContract;

	let driver: DriverContract | undefined;
	let initPromise: Promise<DriverContract> | undefined;

	const ensureDriver = (): Promise<DriverContract> => {
		if (driver) return Promise.resolve(driver);
		if (!initPromise) {
			initPromise = import("flydrive/drivers/s3")
				.then(({ S3Driver }) => {
					driver = new S3Driver({
						credentials: {
							accessKeyId: options.accessKey,
							secretAccessKey: options.secretKey,
						},
						region: options.region,
						bucket: options.bucket,
						endpoint: options.endpoint,
						forcePathStyle: true,
					});
					return driver;
				})
				.catch((err) => {
					throw new Error(
						"[questpie] QUESTPIE_STORAGE_* env vars detected but S3 driver could not be loaded. " +
							"Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner as dependencies.\n" +
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
			return async (...args: unknown[]) => {
				const d = await ensureDriver();
				const fn = (d as unknown as Record<string, unknown>)[prop as string];
				if (typeof fn === "function") {
					return fn.apply(d, args);
				}
				return fn;
			};
		},
	};

	return new Proxy({}, handler) as DriverContract;
}
