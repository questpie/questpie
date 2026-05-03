/**
 * Admin Configuration
 *
 * Consolidates sidebar, dashboard, branding, and admin locale settings.
 */
import getRevenueStats from "@/questpie/server/routes/get-revenue-stats";
import { adminConfig, type WidgetFetchContext } from "@questpie/admin/server";

export default adminConfig({
	branding: {
		name: { en: "Barbershop Control", sk: "Riadenie barbershopu" },
		logo: { src: "/logo192.png" },
		tagline: { en: "Run your shop", sk: "Riaď svoj salón" },
		favicon: "/favicon.ico",
	},
	locale: {
		locales: ["en", "sk"],
		defaultLocale: "en",
	},
	sidebar: {
		sections: [
			{ id: "overview", title: { en: "Overview", sk: "Prehľad" } },
			{ id: "operations", title: { en: "Operations", sk: "Prevádzka" } },
			{ id: "content", title: { en: "Content", sk: "Obsah" } },
			{ id: "team", title: { en: "Team", sk: "Tím" } },
			{ id: "external", title: { en: "External", sk: "Externé" } },
			// Override admin module's "administration" section title for this project
			{
				id: "administration",
				title: { en: "Administration", sk: "Administrácia" },
			},
		],
		items: [
			// Overview
			{
				sectionId: "overview",
				type: "link",
				label: { en: "Dashboard", sk: "Dashboard" },
				href: "/admin",
				icon: { type: "icon", props: { name: "ph:house" } },
			},
			{
				sectionId: "overview",
				type: "global",
				global: "site_settings",
			},
			// Operations
			{
				sectionId: "operations",
				type: "collection",
				collection: "appointments",
			},
			{
				sectionId: "operations",
				type: "collection",
				collection: "reviews",
			},
			// Content
			{
				sectionId: "content",
				type: "collection",
				collection: "pages",
			},
			{
				sectionId: "content",
				type: "collection",
				collection: "blog_posts",
			},
			{
				sectionId: "content",
				type: "collection",
				collection: "services",
			},
			// Team
			{
				sectionId: "team",
				type: "collection",
				collection: "barbers",
			},
			// External
			{
				sectionId: "external",
				type: "link",
				label: { en: "Open Website", sk: "Otvoriť web" },
				href: "/",
				external: true,
				icon: { type: "icon", props: { name: "ph:arrow-square-out" } },
			},
		],
	},
	dashboard: {
		title: { en: "Barbershop Control", sk: "Riadenie barbershopu" },
		description: {
			en: "Live operations, content, and business performance overview",
			sk: "Prehľad prevádzky, obsahu a výkonu podniku v reálnom čase",
		},
		columns: 4,
		rowHeight: 144,
		gap: 4,
		realtime: false,
		actions: [
			{
				id: "new-appointment",
				href: "/admin/collections/appointments/create",
				label: { en: "New Appointment", sk: "Nová rezervácia" },
				icon: { type: "icon", props: { name: "ph:calendar-plus" } },
				variant: "primary",
			},
			{
				id: "add-barber",
				href: "/admin/collections/barbers/create",
				label: { en: "Add Barber", sk: "Pridať holiča" },
				icon: { type: "icon", props: { name: "ph:user-plus" } },
				variant: "outline",
			},
			{
				id: "edit-site-settings",
				href: "/admin/globals/site_settings",
				label: {
					en: "Edit Site Settings",
					sk: "Upraviť nastavenia webu",
				},
				icon: { type: "icon", props: { name: "ph:gear-six" } },
				variant: "outline",
			},
		],
		items: [
			{
				type: "section",
				id: "today",
				layout: "grid",
				columns: 4,
				items: [
					{
						id: "appointments-today",
						type: "stats",
						collection: "appointments",
						label: { en: "Today's Appointments", sk: "Dnešné rezervácie" },
						filter: {
							scheduledAt: {
								gte: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
								lt: new Date(
									new Date().setHours(23, 59, 59, 999),
								).toISOString(),
							},
						},
						span: 1,
						rowSpan: 1,
					},
					{
						id: "pending-appointments",
						type: "stats",
						collection: "appointments",
						label: { en: "Pending", sk: "Čakajúce" },
						filter: { status: "pending" },
						span: 1,
						rowSpan: 1,
					},
					{
						id: "active-barbers",
						type: "stats",
						collection: "barbers",
						label: { en: "Active Barbers", sk: "Aktívni holiči" },
						filter: { isActive: true },
						span: 1,
						rowSpan: 1,
					},
					{
						id: "published-pages",
						type: "stats",
						collection: "pages",
						label: { en: "Published Pages", sk: "Publikované stránky" },
						loader: async ({ collections }: WidgetFetchContext) => {
							const result = await collections.pages.find({
								stage: "published",
								limit: 1,
								columns: { id: true },
							});

							return { count: result.totalDocs };
						},
						span: 1,
						rowSpan: 1,
					},
				],
			},
			{
				type: "section",
				id: "business",
				label: { en: "Business", sk: "Biznis" },
				description: {
					en: "Revenue, targets, and appointment mix",
					sk: "Tržby, ciele a rozdelenie rezervácií",
				},
				layout: "grid",
				columns: 4,
				rowHeight: 156,
				items: [
					{
						id: "monthly-revenue",
						type: "value",
						span: 2,
						rowSpan: 1,
						refreshInterval: 1000 * 60 * 5,
						loader: async (ctx: WidgetFetchContext) => {
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
									...ctx,
									input: {
										startDate: currentStart,
										endDate: currentEnd,
										completedOnly: true,
									},
								}),
								getRevenueStats.handler({
									...ctx,
									input: {
										startDate: previousStart,
										endDate: previousEnd,
										completedOnly: true,
									},
								}),
							]);

							const change =
								previousStats.totalRevenue === 0
									? currentStats.totalRevenue > 0
										? 100
										: 0
									: Math.round(
											((currentStats.totalRevenue -
												previousStats.totalRevenue) /
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
						id: "revenue-goal",
						type: "progress",
						span: 1,
						rowSpan: 1,
						showPercentage: true,
						label: { en: "Monthly Goal", sk: "Mesačný cieľ" },
						loader: async (ctx: WidgetFetchContext) => {
							const now = new Date();
							const currentStart = new Date(
								now.getFullYear(),
								now.getMonth(),
								1,
							).toISOString();
							const stats = await getRevenueStats.handler({
								...ctx,
								input: {
									startDate: currentStart,
									endDate: now.toISOString(),
									completedOnly: true,
								},
							});
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
						rowSpan: 1,
					},
				],
			},
			{
				type: "tabs",
				id: "workflow-tabs",
				defaultTab: "appointments",
				tabs: [
					{
						id: "appointments",
						label: { en: "Appointments", sk: "Rezervácie" },
						icon: { type: "icon", props: { name: "ph:calendar" } },
						columns: 4,
						items: [
							{
								id: "recent-appointments",
								type: "recentItems",
								collection: "appointments",
								label: {
									en: "Recent Appointments",
									sk: "Posledné rezervácie",
								},
								limit: 6,
								dateField: "scheduledAt",
								span: 2,
								rowSpan: 2,
							},
							{
								id: "activity-stream",
								type: "timeline",
								label: { en: "Activity", sk: "Aktivita" },
								maxItems: 8,
								showTimestamps: true,
								timestampFormat: "relative",
								loader: async ({ collections }: WidgetFetchContext) => {
									const res = await collections.appointments.find({
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
								rowSpan: 2,
							},
						],
					},
					{
						id: "content",
						label: { en: "Content", sk: "Obsah" },
						icon: { type: "icon", props: { name: "ph:article" } },
						columns: 4,
						items: [
							{
								id: "published-posts",
								type: "stats",
								collection: "blog_posts",
								label: { en: "Published Posts", sk: "Publikované blogy" },
								filter: { status: "published" },
								span: 1,
								rowSpan: 1,
							},
							{
								id: "active-services",
								type: "stats",
								collection: "services",
								label: { en: "Active Services", sk: "Aktívne služby" },
								filter: { isActive: true },
								span: 1,
								rowSpan: 1,
							},
							{
								id: "recent-reviews",
								type: "table",
								collection: "reviews",
								label: { en: "Latest Reviews", sk: "Najnovšie recenzie" },
								columns: ["customerName", "rating", "isApproved"],
								limit: 6,
								sortBy: "createdAt",
								sortOrder: "desc",
								linkToDetail: true,
								span: 2,
								rowSpan: 2,
							},
						],
					},
				],
			},
			{
				type: "section",
				id: "shortcuts",
				label: { en: "Shortcuts", sk: "Skratky" },
				layout: "grid",
				columns: 4,
				items: [
					{
						id: "quick-actions",
						type: "quickActions",
						label: { en: "Quick Actions", sk: "Rýchle akcie" },
						layout: "grid",
						span: 2,
						rowSpan: 2,
						actions: [
							{
								label: {
									en: "Review Approvals",
									sk: "Skontrolovať recenzie",
								},
								icon: { type: "icon", props: { name: "ph:star" } },
								action: {
									type: "link",
									href: "/admin/collections/reviews",
								},
							},
							{
								label: { en: "Write Blog Post", sk: "Napísať blog" },
								icon: { type: "icon", props: { name: "ph:article" } },
								action: { type: "create", collection: "blog_posts" },
							},
							{
								label: { en: "Add Service", sk: "Pridať službu" },
								icon: { type: "icon", props: { name: "ph:scissors" } },
								action: { type: "create", collection: "services" },
							},
							{
								label: { en: "Open Website", sk: "Otvoriť web" },
								icon: {
									type: "icon",
									props: { name: "ph:arrow-square-out" },
								},
								action: { type: "link", href: "/", external: true },
							},
						],
					},
					{
						id: "upcoming-appointments-table",
						type: "table",
						collection: "appointments",
						label: {
							en: "Upcoming Appointments",
							sk: "Nadchádzajúce rezervácie",
						},
						columns: ["displayTitle", "status", "scheduledAt"],
						limit: 6,
						sortBy: "scheduledAt",
						sortOrder: "asc",
						linkToDetail: true,
						span: 2,
						rowSpan: 2,
					},
				],
			},
		],
	},
});
