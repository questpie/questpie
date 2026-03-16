import type { SidebarContribution } from "../../augmentation.js";

/**
 * Sidebar contribution from the audit module.
 * Adds audit log to the "administration" section defined by the admin module.
 */
const sidebarContribution: SidebarContribution = {
	items: [
		{
			sectionId: "administration",
			type: "collection",
			collection: "admin_audit_log",
			icon: { type: "icon", props: { name: "ph:clipboard-text" } },
		},
	],
};

export default sidebarContribution;
