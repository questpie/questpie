import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const teamBlock = block("team")
	.admin(({ c }) => ({
		label: { en: "Team / Barbers", sk: "Tím / Holiči" },
		icon: c.icon("ph:users"),
		category: sections(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		subtitle: f
			.textarea()
			.label({ en: "Subtitle", sk: "Podnadpis" })
			.localized(),
		mode: f
			.select([
				{
					value: "auto",
					label: {
						en: "Automatic (by limit)",
						sk: "Automatický (podľa limitu)",
					},
				},
				{
					value: "manual",
					label: { en: "Manual selection", sk: "Manuálny výber" },
				},
			])
			.label({ en: "Selection Mode", sk: "Režim výberu" })
			.default("auto"),
		barbers: f
			.relation("barbers")
			.multiple()
			.label({ en: "Select Barbers", sk: "Vybrať holičov" })
			.admin({
				hidden: ({ data }: { data: Record<string, unknown> }) =>
					data.mode !== "manual",
			}),
		columns: f
			.select([
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			])
			.label({ en: "Columns", sk: "Stĺpce" })
			.default("3"),
		limit: f
			.number()
			.label({ en: "Limit", sk: "Limit" })
			.default(4)
			.admin({
				hidden: ({ data }: { data: Record<string, unknown> }) =>
					data.mode === "manual",
			}),
		showBio: f
			.boolean()
			.label({ en: "Show Bio", sk: "Zobraziť bio" })
			.default(false),
	}))
	.prefetch(async ({ values, ctx }) => {
		if (values.mode === "manual") {
			const ids = (values.barbers as unknown as string[]) || [];
			if (ids.length === 0) return { barbers: [] };
			const res = await ctx.collections.barbers.find({
				where: { id: { in: ids } },
				limit: ids.length,
				with: { avatar: true },
			});
			return { barbers: res.docs };
		}
		// Auto mode
		const res = await ctx.collections.barbers.find({
			limit: (values.limit as number) || 4,
			where: { isActive: true },
			with: { avatar: true },
		});
		return { barbers: res.docs };
	});
