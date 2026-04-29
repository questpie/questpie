import { adminConfig } from "../../../augmentation.js";

/**
 * Default admin config from the admin module.
 * Defines an "administration" section with users and assets.
 * Other modules (audit, etc.) can add items to this section via sectionId.
 */
export default adminConfig({
	sidebar: {
		sections: [
			{
				id: "administration",
				title: { key: "defaults.sidebar.administration" },
			},
		],
		items: [
			{
				sectionId: "administration",
				type: "collection",
				collection: "user",
				icon: { type: "icon", props: { name: "ph:users" } },
			},
			{
				sectionId: "administration",
				type: "collection",
				collection: "assets",
				icon: { type: "icon", props: { name: "ph:image" } },
			},
		],
	},
});
