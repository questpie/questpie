import { block } from "#questpie/factories";

import { dynamic } from "./_categories";

export const contactsListBlock = block("contacts-list")
	.admin(({ c }) => ({
		label: "Contacts List",
		icon: c.icon("ph:address-book"),
		category: dynamic(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title").default("Contact Us"),
		showAll: f.boolean().label("Show All Contacts").default(true),
		contactIds: f
			.json()
			.label("Specific Contacts")
			.description("Array of contact IDs (if not showing all)"),
	}))
	.prefetch(async ({ values, ctx }) => {
		if (!values.showAll) {
			const ids = (values.contactIds as string[]) || [];
			if (ids.length === 0) return { contacts: [] };
			const res = await ctx.collections.contacts.find({
				orderBy: { order: "asc" },
				where: { id: { in: ids } },
			});
			return { contacts: res.docs };
		}

		const res = await ctx.collections.contacts.find({
			orderBy: { order: "asc" },
		});
		return { contacts: res.docs };
	});
