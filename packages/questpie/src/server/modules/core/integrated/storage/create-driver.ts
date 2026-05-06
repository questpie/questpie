import type { DriverContract } from "flydrive/types";

import type { QuestpieConfig } from "#questpie/server/config/types.js";

import { buildStorageFileUrl, generateSignedUrlToken } from "./signed-url.js";

const DEFAULT_BASE_PATH = "/";

const resolveBasePath = (config: QuestpieConfig) =>
	config.storage?.basePath || DEFAULT_BASE_PATH;
const DEFAULT_LOCATION = "./uploads";

const isAbsolutePath = (path: string): boolean =>
	path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);

const resolveLocalPath = (location: string): string => {
	if (isAbsolutePath(location)) return location;

	const cwd =
		typeof process !== "undefined" && typeof process.cwd === "function"
			? process.cwd()
			: ".";
	const normalizedLocation = location.replace(/^[.][\\/]/, "");

	return `${cwd.replace(/[\\/]+$/g, "")}/${normalizedLocation}`;
};

/**
 * Get the resolved storage location path.
 * Returns null if using custom driver (cloud storage).
 */
export function getStorageLocation(config: QuestpieConfig): string | null {
	if (config.storage?.driver) {
		return null; // Custom driver, no local path
	}
	const location = config.storage?.location || DEFAULT_LOCATION;
	return resolveLocalPath(location);
}

class LazyFSDriver implements DriverContract {
	private driver: Promise<DriverContract> | null = null;

	constructor(private readonly config: QuestpieConfig) {}

	private async use(): Promise<DriverContract> {
		this.driver ??= this.create();
		return this.driver;
	}

	private async create(): Promise<DriverContract> {
		const { FSDriver } = await import("flydrive/drivers/fs");
		const location = getStorageLocation(this.config)!;
		const secret = this.config.secret || "questpie-default-secret";
		const expiration = this.config.storage?.signedUrlExpiration || 3600;
		const basePath = resolveBasePath(this.config);
		const appUrl = this.config.app.url;

		return new FSDriver({
			location,
			visibility: "public",
			urlBuilder: {
				async generateURL(key) {
					return buildStorageFileUrl(appUrl, basePath, key);
				},
				async generateSignedURL(key, _filePath, options) {
					const tokenExpiration = options?.expiresIn
						? Math.floor(
								(typeof options.expiresIn === "string"
									? parseInt(options.expiresIn, 10)
									: options.expiresIn) / 1000,
							)
						: expiration;

					const token = await generateSignedUrlToken(
						key,
						secret,
						tokenExpiration,
					);
					return buildStorageFileUrl(appUrl, basePath, key, token);
				},
			},
		});
	}

	async exists(...args: Parameters<DriverContract["exists"]>) {
		return (await this.use()).exists(...args);
	}

	async get(...args: Parameters<DriverContract["get"]>) {
		return (await this.use()).get(...args);
	}

	async getStream(...args: Parameters<DriverContract["getStream"]>) {
		return (await this.use()).getStream(...args);
	}

	async getBytes(...args: Parameters<DriverContract["getBytes"]>) {
		return (await this.use()).getBytes(...args);
	}

	async getMetaData(...args: Parameters<DriverContract["getMetaData"]>) {
		return (await this.use()).getMetaData(...args);
	}

	async getVisibility(...args: Parameters<DriverContract["getVisibility"]>) {
		return (await this.use()).getVisibility(...args);
	}

	async getUrl(...args: Parameters<DriverContract["getUrl"]>) {
		return (await this.use()).getUrl(...args);
	}

	async getSignedUrl(...args: Parameters<DriverContract["getSignedUrl"]>) {
		return (await this.use()).getSignedUrl(...args);
	}

	async getSignedUploadUrl(
		...args: Parameters<DriverContract["getSignedUploadUrl"]>
	) {
		return (await this.use()).getSignedUploadUrl(...args);
	}

	async setVisibility(...args: Parameters<DriverContract["setVisibility"]>) {
		return (await this.use()).setVisibility(...args);
	}

	async put(...args: Parameters<DriverContract["put"]>) {
		return (await this.use()).put(...args);
	}

	async putStream(...args: Parameters<DriverContract["putStream"]>) {
		return (await this.use()).putStream(...args);
	}

	async copy(...args: Parameters<DriverContract["copy"]>) {
		return (await this.use()).copy(...args);
	}

	async move(...args: Parameters<DriverContract["move"]>) {
		return (await this.use()).move(...args);
	}

	async delete(...args: Parameters<DriverContract["delete"]>) {
		return (await this.use()).delete(...args);
	}

	async deleteAll(...args: Parameters<DriverContract["deleteAll"]>) {
		return (await this.use()).deleteAll(...args);
	}

	async listAll(...args: Parameters<DriverContract["listAll"]>) {
		return (await this.use()).listAll(...args);
	}
}

/**
 * Creates the storage driver.
 * - Custom `driver` → use it (cloud)
 * - Otherwise → FSDriver with `location` (local)
 */
export const createDiskDriver = (config: QuestpieConfig): DriverContract => {
	if (config.storage?.driver) {
		return config.storage.driver;
	}

	return new LazyFSDriver(config);
};
