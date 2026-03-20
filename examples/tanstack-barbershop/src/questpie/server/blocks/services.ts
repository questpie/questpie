import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const servicesBlock = block("services")
	.admin(({ c }) => ({
		label: { en: "Services", sk: "Služby" },
		icon: c.icon("ph:scissors"),
		category: sections(c),
		order: 2,
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
		services: f
			.relation("services")
			.multiple()
			.label({ en: "Select Services", sk: "Vybrať služby" })
			.admin({
				hidden: ({ data }: { data: Record<string, unknown> }) =>
					data.mode !== "manual",
			}),
		showPrices: f
			.boolean()
			.label({ en: "Show Prices", sk: "Zobraziť ceny" })
			.default(true),
		showDuration: f
			.boolean()
			.label({ en: "Show Duration", sk: "Zobraziť trvanie" })
			.default(true),
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
			.default(6)
			.admin({
				hidden: ({ data }: { data: Record<string, unknown> }) =>
					data.mode === "manual",
			}),
	}))
	.prefetch(async ({ values, ctx }) => {
		if (values.mode === "manual") {
			const ids = (values.services as unknown as string[]) || [];
			if (ids.length === 0) return { services: [] };
			const res = await ctx.collections.services.find({
				where: { id: { in: ids } },
				limit: ids.length,
				with: { image: true },
			});
			return { services: res.docs };
		}
		// Auto mode
		const res = await ctx.collections.services.find({
			limit: (values.limit as number) || 6,
			with: { image: true },
		});
		return { services: res.docs };
	});
