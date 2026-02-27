import { block } from "@questpie/admin/server";
import { sections } from "./_categories";

export const servicesBlock = block("services")
	.admin(({ c }) => ({
		label: { en: "Services", sk: "Služby" },
		icon: c.icon("ph:scissors"),
		category: sections(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		mode: f.select({
			label: { en: "Selection Mode", sk: "Režim výberu" },
			options: [
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
			],
			defaultValue: "auto",
		}),
		services: f.relation({
			to: "services",
			hasMany: true,
			label: { en: "Select Services", sk: "Vybrať služby" },
			meta: {
				admin: {
					hidden: ({ data }: { data: Record<string, unknown> }) =>
						data.mode !== "manual",
				},
			},
		}),
		showPrices: f.boolean({
			label: { en: "Show Prices", sk: "Zobraziť ceny" },
			defaultValue: true,
		}),
		showDuration: f.boolean({
			label: { en: "Show Duration", sk: "Zobraziť trvanie" },
			defaultValue: true,
		}),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
		limit: f.number({
			label: { en: "Limit", sk: "Limit" },
			defaultValue: 6,
			meta: {
				admin: {
					hidden: ({ data }: { data: Record<string, unknown> }) =>
						data.mode === "manual",
				},
			},
		}),
	}))
	.prefetch(async ({ values, ctx }) => {
		if (values.mode === "manual") {
			const ids = (values.services as string[]) || [];
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
			limit: values.limit || 6,
			with: { image: true },
		});
		return { services: res.docs };
	});
