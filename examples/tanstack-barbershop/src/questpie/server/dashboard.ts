/**
 * Dashboard — project-level dashboard contribution.
 * Merged with module contributions (audit adds timeline widget automatically).
 */
import getRevenueStats from "@/questpie/server/functions/get-revenue-stats";
import { dashboard } from "#questpie";

export default dashboard({
	title: { en: "Barbershop Control", sk: "Riadenie barbershopu" },
	description: {
		en: "Live operations, content, and business performance overview",
		sk: "Prehľad prevádzky, obsahu a výkonu podniku v reálnom čase",
	},
	columns: 4,
	realtime: false,
	actions: [
		{
			id: "new-appointment",
			href: "/admin/collections/appointments?create=true",
			label: { en: "New Appointment", sk: "Nová rezervácia" },
			icon: { type: "icon", props: { name: "ph:calendar-plus" } },
			variant: "primary",
		},
		{
			id: "add-barber",
			href: "/admin/collections/barbers?create=true",
			label: { en: "Add Barber", sk: "Pridať holiča" },
			icon: { type: "icon", props: { name: "ph:user-plus" } },
			variant: "outline",
		},
		{
			id: "edit-site-settings",
			href: "/admin/globals/siteSettings",
			label: {
				en: "Edit Site Settings",
				sk: "Upraviť nastavenia webu",
			},
			icon: { type: "icon", props: { name: "ph:gear-six" } },
			variant: "outline",
		},
	],
	sections: [
		{
			id: "today",
			label: { en: "Today", sk: "Dnes" },
			layout: "grid",
			columns: 4,
		},
		{
			id: "business",
			label: { en: "Business", sk: "Biznis" },
			layout: "grid",
			columns: 4,
		},
		{
			id: "operations",
			label: { en: "Operations", sk: "Prevádzka" },
			layout: "grid",
			columns: 4,
		},
	],
	items: [
		// Today section
		{
			sectionId: "today",
			id: "appointments-today",
			type: "stats",
			collection: "appointments",
			label: { en: "Today's Appointments", sk: "Dnešné rezervácie" },
			filter: {
				scheduledAt: {
					gte: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
					lt: new Date(new Date().setHours(23, 59, 59, 999)).toISOString(),
				},
			},
			span: 1,
		},
		{
			sectionId: "today",
			id: "pending-appointments",
			type: "stats",
			collection: "appointments",
			label: { en: "Pending", sk: "Čakajúce" },
			filter: { status: "pending" },
			span: 1,
		},
		{
			sectionId: "today",
			id: "active-barbers",
			type: "stats",
			collection: "barbers",
			label: { en: "Active Barbers", sk: "Aktívni holiči" },
			filter: { isActive: true },
			span: 1,
		},
		{
			sectionId: "today",
			id: "published-pages",
			type: "stats",
			collection: "pages",
			label: { en: "Published Pages", sk: "Publikované stránky" },
			filter: { isPublished: true },
			span: 1,
		},
		// Business section
		{
			sectionId: "business",
			id: "monthly-revenue",
			type: "value",
			span: 2,
			refreshInterval: 1000 * 60 * 5,
			loader: async ({ app }: any) => {
				const now = new Date();
				const currentStart = new Date(
					now.getFullYear(),
					now.getMonth(),
					1,
				).toISOString();
				const currentEnd = now.toISOString();
				const previousStart = new Date(
					now.getFullYear(),
					now.getMonth() - 1,
					1,
				).toISOString();
				const previousEnd = new Date(
					now.getFullYear(),
					now.getMonth(),
					0,
					23,
					59,
					59,
					999,
				).toISOString();

				const [currentStats, previousStats] = await Promise.all([
					getRevenueStats.handler({
						input: {
							startDate: currentStart,
							endDate: currentEnd,
							completedOnly: true,
						},
						app,
					} as any),
					getRevenueStats.handler({
						input: {
							startDate: previousStart,
							endDate: previousEnd,
							completedOnly: true,
						},
						app,
					} as any),
				]);

				const change =
					previousStats.totalRevenue === 0
						? currentStats.totalRevenue > 0
							? 100
							: 0
						: Math.round(
								((currentStats.totalRevenue - previousStats.totalRevenue) /
									previousStats.totalRevenue) *
									100,
							);

				const revenue = currentStats.totalRevenue / 100;

				return {
					value: revenue,
					formatted: `${revenue.toLocaleString()} €`,
					label: { en: "Monthly Revenue", sk: "Mesačné tržby" },
					subtitle: {
						en: `${currentStats.appointmentCount} completed appointments`,
						sk: `${currentStats.appointmentCount} dokončených rezervácií`,
					},
					trend: {
						value: `${change >= 0 ? "+" : ""}${change}%`,
					},
				};
			},
		},
		{
			sectionId: "business",
			id: "revenue-goal",
			type: "progress",
			span: 1,
			showPercentage: true,
			label: { en: "Monthly Goal", sk: "Mesačný cieľ" },
			loader: async ({ app }: any) => {
				const now = new Date();
				const currentStart = new Date(
					now.getFullYear(),
					now.getMonth(),
					1,
				).toISOString();
				const stats = await getRevenueStats.handler({
					input: {
						startDate: currentStart,
						endDate: now.toISOString(),
						completedOnly: true,
					},
					app,
				} as any);
				const target = 500000;

				return {
					current: stats.totalRevenue,
					target,
					label: `${(stats.totalRevenue / 100).toLocaleString()} € / ${(target / 100).toLocaleString()} €`,
					subtitle:
						stats.totalRevenue >= target
							? "Goal reached"
							: `${((target - stats.totalRevenue) / 100).toLocaleString()} € to go`,
				};
			},
		},
		{
			sectionId: "business",
			id: "appointments-by-status",
			type: "chart",
			collection: "appointments",
			field: "status",
			chartType: "pie",
			label: {
				en: "Appointments by Status",
				sk: "Rezervácie podľa stavu",
			},
			span: 1,
		},
		// Operations section
		{
			sectionId: "operations",
			id: "recent-appointments",
			type: "recentItems",
			collection: "appointments",
			label: { en: "Recent Appointments", sk: "Posledné rezervácie" },
			limit: 6,
			dateField: "scheduledAt",
			span: 2,
		},
		{
			sectionId: "operations",
			id: "activity-stream",
			type: "timeline",
			label: { en: "Activity", sk: "Aktivita" },
			maxItems: 8,
			showTimestamps: true,
			timestampFormat: "relative",
			loader: async ({ app }: any) => {
				const res = await app.api.collections.appointments.find({
					limit: 8,
					orderBy: { updatedAt: "desc" },
				});

				return res.docs.map((apt: any) => ({
					id: apt.id,
					title: apt.displayTitle || apt.id,
					description: `Status: ${apt.status}`,
					timestamp: apt.updatedAt || apt.createdAt,
					variant:
						apt.status === "completed"
							? "success"
							: apt.status === "cancelled" || apt.status === "no-show"
								? "error"
								: apt.status === "confirmed"
									? "info"
									: "warning",
					href: `/admin/collections/appointments/${apt.id}`,
				}));
			},
			span: 2,
		},
		// Note: audit timeline widget is auto-contributed by auditModule
	],
});
