import { resolve } from "node:path";
import { FSDriver } from "flydrive/drivers/fs";
import type { DriverContract } from "flydrive/types";
import type { QuestpieConfig } from "#questpie/server/config/types.js";
import { buildStorageFileUrl, generateSignedUrlToken } from "./signed-url.js";

const DEFAULT_BASE_PATH = "/";

const resolveBasePath = (config: QuestpieConfig) =>
  config.storage?.basePath || DEFAULT_BASE_PATH;
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
 * - Custom `driver` → use it (cloud)
 * - Otherwise → FSDriver with `location` (local)
 */
export const createDiskDriver = (config: QuestpieConfig): DriverContract => {
  if (config.storage?.driver) {
    return config.storage.driver;
  }

  const location = getStorageLocation(config)!;
  const secret = config.secret || "questpie-default-secret";
  const expiration = config.storage?.signedUrlExpiration || 3600;

  const basePath = resolveBasePath(config);

  return new FSDriver({
    location,
    visibility: "public",
    urlBuilder: {
      async generateURL(key) {
        return buildStorageFileUrl(config.app.url, basePath, key);
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
        return buildStorageFileUrl(config.app.url, basePath, key, token);
      },
    },
  });
};
