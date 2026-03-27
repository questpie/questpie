import { tmpdir } from "node:os";
import { join } from "node:path";

import { DriveManager } from "flydrive";

import { service } from "#questpie/server/services/define-service.js";
import { createDiskDriver } from "#questpie/server/modules/core/integrated/storage/create-driver.js";

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

		return new DriveManager({
			default: storageDriverName,
			fakes: {
				location: new URL(
					join(tmpdir(), "fakes", crypto.randomUUID()),
					import.meta.url,
				),
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
