import { Files } from "files-sdk";

import { assertValidStorageConfig } from "#questpie/server/config/cloud-env.js";
import type { QuestpieConfig } from "#questpie/server/config/types.js";

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
 */
export function getStorageLocation(config: QuestpieConfig): string {
	const location = config.storage?.location || DEFAULT_LOCATION;
	return resolveLocalPath(location);
}

export const createFilesStorage = async (
	config: QuestpieConfig,
): Promise<Files> => {
	const storage = config.storage;
	assertValidStorageConfig(storage);

	if (storage?.adapter) {
		return new Files({ adapter: storage.adapter });
	}

	const { fs } = await import("files-sdk/fs");
	const location = getStorageLocation(config);
	const expiration = config.storage?.signedUrlExpiration || 3600;
	const basePath = resolveBasePath(config);
	const appUrl = config.app.url;
	const prefix = `${appUrl}${basePath === "/" ? "" : basePath}/files`;

	return new Files({
		adapter: fs({
			root: location,
			urlBaseUrl: prefix,
			defaultUrlExpiresIn: expiration,
		}),
	});
};
