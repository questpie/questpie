import { DriveManager } from "flydrive";

import { createDiskDriver } from "#questpie/server/modules/core/integrated/storage/create-driver.js";
import { service } from "#questpie/server/services/define-service.js";

/**
 * Storage service — creates the DriveManager (flydrive) instance.
 *
 * Namespace: null (top-level in AppContext as `storage`).
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const storageDriverName = "appDefault";
		const fakeStorageId =
			globalThis.crypto?.randomUUID?.() ??
			`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

		return new DriveManager({
			default: storageDriverName,
			fakes: {
				location: `/tmp/questpie-fakes/${fakeStorageId}`,
				urlBuilder: {
					generateSignedURL(key, _filePath, _options) {
						return Promise.resolve(`http://fake-storage.local/${key}`);
					},
					generateURL(key, _filePath) {
						return Promise.resolve(`http://fake-storage.local/${key}`);
					},
				},
			},
			services: {
				[storageDriverName]: () => createDiskDriver(app.config),
			},
		});
	},
});
