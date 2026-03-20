import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const announcementBannerBlock = block("announcement-banner")
	.admin(({ c }) => ({
		label: "Announcement Banner",
		icon: c.icon("ph:bell"),
		category: sections(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		count: f.number().label("Number to Show").default(3),
		showExpired: f.boolean().label("Show Expired").default(false),
	}))
	.prefetch(async ({ values, ctx }) => {
		const where: any = {};
		if (!values.showExpired) {
			where.validTo = { gte: new Date().toISOString() };
		}

		const res = await ctx.collections.announcements.find({
			limit: (values.count as number) || 3,
			where,
			orderBy: { isPinned: "desc", validFrom: "desc" },
		});
		return { announcements: res.docs };
	});
