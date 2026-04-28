import { resolve } from "node:path";

import { FSDriver } from "flydrive/drivers/fs";
import type { DriverContract } from "flydrive/types";

import type { QuestpieConfig } from "#questpie/server/config/types.js";

import { makeProxyUrlBuilder } from "./drivers/factory.js";

const DEFAULT_LOCATION = "./uploads";

/**
 * Get the resolved storage location path.
 * Returns null if using custom driver (cloud storage).
 */
export function getStorageLocation(config: QuestpieConfig): string | null {
	if (config.storage?.driver) {
		return null; // Custom driver, no local path
	}
	const location = config.storage?.location || DEFAULT_LOCATION;
	return resolve(process.cwd(), location);
}

/**
 * Creates the storage driver.
 * - Custom `driver` (DriverContract or factory) → use it (cloud)
 * - Otherwise → FSDriver with `location` (local)
 */
export const createDiskDriver = (config: QuestpieConfig): DriverContract => {
	if (config.storage?.driver) {
		return typeof config.storage.driver === "function"
			? config.storage.driver(config)
			: config.storage.driver;
	}

	const location = getStorageLocation(config)!;
	const proxy = makeProxyUrlBuilder(config);

	return new FSDriver({
		location,
		visibility: "public",
		urlBuilder: {
			generateURL: (key) => proxy.generateURL(key),
			generateSignedURL: (key, _filePath, options) =>
				proxy.generateSignedURL(key, options?.expiresIn),
		},
	});
};
