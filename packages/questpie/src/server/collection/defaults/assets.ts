import { coreBuilder as q } from "./core-builder.js";

/**
 * Default assets collection with file upload support.
 *
 * Uses `.upload()` which automatically:
 * - Adds upload fields (key, filename, mimeType, size, visibility)
 * - Extends output type with { url: string } for typed URL access
 * - Adds afterRead hook for URL generation based on visibility
 * - Enables upload() and uploadMany() CRUD methods
 * - Registers HTTP routes: POST /assets/upload, GET /assets/files/:key
 *
 * Additional fields for image metadata are included.
 */
export const assetsCollection = q
	.collection("assets")
	.options({
		timestamps: true,
	})
	.fields((f) => ({
		// Image dimensions (optional)
		width: f.number(),
		height: f.number(),

		// Descriptive metadata
		alt: f.text({ maxLength: 500 }),
		caption: f.textarea(),
	}))
	// Enable file upload with public visibility by default
	.upload({
		visibility: "public",
	})
	.hooks({
		afterDelete: async ({ data, app }) => {
			const cms = app as any;
			const record = data as any;
			if (!cms?.storage || !record?.key) return;

			try {
				await cms.storage.use().delete(record.key);
			} catch (error) {
				cms.logger?.warn?.("Failed to delete asset file from storage", {
					key: record.key,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	})
	.title(({ f }) => f.filename);
