/**
 * Admin-configured Assets Collection
 *
 * Extends the starter assets collection with admin UI configuration:
 * - Admin panel metadata (label, icon, group)
 * - List view with file preview, metadata columns
 * - Form view with file info sidebar, dimensions, and metadata sections
 *
 * @see account.ts for explanation of the collection().merge().set() pattern.
 * stateKey mapping: admin=".admin()", adminList=".list()", adminForm=".form()"
 */

import { starterModule } from "questpie";
import { collection } from "../factories";

const adminAssetsCollection = collection("assets")
	.merge(starterModule.collections.assets)
	.admin(({ c }: any) => ({
		label: { key: "defaults.assets.label" },
		icon: c.icon("ph:image"),
		description: { key: "defaults.assets.description" },
		group: "administration",
	}))
	.list(({ v, f, a }: any) =>
		v.collectionTable({
			// Note: filename, mimeType, size, createdAt are upload fields (added by .upload())
			// so we use string literals instead of f.* proxy
			columns: ["preview", "filename", "mimeType", "size"],
			searchable: ["filename", f.alt],
			defaultSort: { field: "createdAt", direction: "desc" },
			actions: {
				header: { primary: [], secondary: [] },
				row: [a.delete],
				bulk: [a.deleteMany],
			},
		}),
	)
	.form(({ v, f }: any) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [
					{
						type: "section",
						label: { key: "defaults.assets.sections.fileInfo" },
						// Note: filename, mimeType, size, visibility are upload fields
						fields: ["preview", "filename", "mimeType", "size", "visibility"],
					},
				],
			},
			fields: [
				{
					type: "section",
					label: { key: "defaults.assets.sections.dimensions" },
					layout: "grid",
					columns: 2,
					fields: [f.width, f.height],
				},
				{
					type: "section",
					label: { key: "defaults.assets.sections.metadata" },
					fields: [f.alt, f.caption],
				},
			],
		}),
	);

export default adminAssetsCollection;
