import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export default collection("assets")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		width: f
			.number()
			.label({ key: "defaults.assets.fields.width.label", fallback: "Width" })
			.description({
				key: "defaults.assets.fields.width.description",
				fallback: "Image width in pixels",
			}),
		height: f
			.number()
			.label({ key: "defaults.assets.fields.height.label", fallback: "Height" })
			.description({
				key: "defaults.assets.fields.height.description",
				fallback: "Image height in pixels",
			}),
		alt: f
			.text(500)
			.label({ key: "defaults.assets.fields.alt.label", fallback: "Alt Text" })
			.description({
				key: "defaults.assets.fields.alt.description",
				fallback: "Alternative text for screen readers",
			})
			.set("admin", {
				placeholder: {
					key: "defaults.assets.fields.alt.placeholder",
					fallback: "Describe the image for accessibility",
				},
			}),
		caption: f
			.textarea()
			.label({
				key: "defaults.assets.fields.caption.label",
				fallback: "Caption",
			})
			.description({
				key: "defaults.assets.fields.caption.description",
				fallback: "Optional caption shown with the asset",
			})
			.set("admin", {
				placeholder: {
					key: "defaults.assets.fields.caption.placeholder",
					fallback: "Add a caption...",
				},
			}),
	}))
	.upload({
		visibility: "public",
	})
	.hooks({
		afterDelete: async (ctx) => {
			const storage = (ctx as any).storage;
			const logger = (ctx as any).logger;
			const record = ctx.data as any;
			if (!storage || !record?.key) return;

			try {
				await storage.use().delete(record.key);
			} catch (error) {
				logger?.warn?.("Failed to delete asset file from storage", {
					key: record.key,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	})
	.title(({ f }) => f.filename);
