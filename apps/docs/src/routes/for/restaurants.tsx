import { createFileRoute } from "@tanstack/react-router";

import {
	UseCasePage,
	type UseCaseData,
} from "@/components/landing/use-case-template";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const DATA: UseCaseData = {
	slug: "restaurants",
	name: "Restaurants & Cafes",
	headline: (
		<>
			Your restaurant deserves more than
			<br className="hidden sm:block" />
			<span className="text-[#b700ff]"> a Facebook page.</span>
		</>
	),
	description:
		"Website, menu management, online ordering, reservations, and AI-powered marketing — one platform instead of five subscriptions.",
	painPoints: [
		{
			icon: "ph:link-break",
			title: "Scattered online presence",
			description:
				"Menu on one site, reservations on another, social media on a third. Customers can't find consistent info.",
		},
		{
			icon: "ph:pencil-slash",
			title: "Menu updates are painful",
			description:
				"Change a price or add a seasonal dish? Update it in three places and hope nothing breaks.",
		},
		{
			icon: "ph:clock-countdown",
			title: "No time for marketing",
			description:
				"You're running a kitchen, not a marketing agency. Social posts, SEO, and email campaigns fall through the cracks.",
		},
		{
			icon: "ph:currency-dollar",
			title: "Too many subscriptions",
			description:
				"Website builder + reservation system + ordering platform + email tool = hundreds per month for mediocre results.",
		},
	],
	solutions: [
		{
			icon: "ph:globe",
			title: "One website for everything",
			description:
				"Menu, reservations, ordering, contact — all on your domain. Built with AI in minutes, managed from one dashboard.",
		},
		{
			icon: "ph:pencil-simple",
			title: "Update once, publish everywhere",
			description:
				"Change your menu in the admin panel. Website, ordering system, and social posts update automatically.",
		},
		{
			icon: "ph:robot",
			title: "AI handles your marketing",
			description:
				"Autopilot agents write social posts, optimize your Google listing, and send email campaigns on autopilot.",
		},
		{
			icon: "ph:wallet",
			title: "Replace five tools with one",
			description:
				"Website, CMS, reservations, ordering, and marketing automation — all included. One bill, one login.",
		},
	],
	features: [
		{
			icon: "ph:fork-knife",
			title: "Menu management",
			description:
				"Categories, prices, dietary tags, seasonal items. Update once — your website reflects it instantly.",
		},
		{
			icon: "ph:calendar-check",
			title: "Online reservations",
			description:
				"Guests book tables directly on your site. Automatic confirmations, reminders, and capacity management.",
		},
		{
			icon: "ph:shopping-bag",
			title: "Online ordering",
			description:
				"Takeout and delivery ordering built into your website. No third-party commissions eating your margins.",
		},
		{
			icon: "ph:paint-brush",
			title: "AI website builder",
			description:
				"Describe what you want — AI builds your restaurant site with photos, menu, hours, and booking in minutes.",
		},
		{
			icon: "ph:megaphone",
			title: "Automated marketing",
			description:
				"AI writes social media posts, optimizes your SEO, and sends email campaigns. You approve, it publishes.",
		},
		{
			icon: "ph:image",
			title: "Photo gallery",
			description:
				"Showcase your dishes, ambiance, and events. Automatic image optimization and lazy loading.",
		},
		{
			icon: "ph:map-pin",
			title: "Location & hours",
			description:
				"Interactive map, business hours, holiday schedules. Structured data so Google shows it in search.",
		},
		{
			icon: "ph:chart-line-up",
			title: "Business analytics",
			description:
				"Track website visits, popular menu items, booking patterns, and marketing performance. Privacy-friendly.",
		},
	],
	pillars: {
		framework: [
			"Menu, reservation, and order collections",
			"Custom admin panel for your staff",
			"REST API for third-party integrations",
			"Multi-language support for tourist areas",
		],
		cloud: [
			"Restaurant-specific templates",
			"AI website builder — describe and customize",
			"Custom domain with SSL",
			"Managed hosting with backups",
		],
		autopilot: [
			"AI writes social media posts from your menu",
			"SEO optimization for local search",
			"Automated email campaigns",
			"Analytics and reporting dashboard",
		],
	},
	faq: [
		{
			q: "Can I manage my menu without technical knowledge?",
			a: "Yes. The admin panel is designed for restaurant staff, not developers. Add dishes, update prices, mark items as sold out, manage categories — all with a simple point-and-click interface.",
		},
		{
			q: "Does it handle online ordering and delivery?",
			a: "Yes. Customers can place orders directly on your website — no commissions to third-party platforms. You manage orders from the admin panel and can integrate with delivery services.",
		},
		{
			q: "Can I take reservations through my website?",
			a: "Yes. The reservation system is built in. Guests pick a date, time, and party size. You get automatic notifications, and guests get confirmation emails. Capacity management prevents overbooking.",
		},
		{
			q: "How does the AI marketing work?",
			a: "QUESTPIE Autopilot agents can draft social media posts featuring your dishes, write blog posts about your restaurant, optimize your Google Business listing for local search, and send promotional emails. You review and approve before anything goes live.",
		},
		{
			q: "Can I have multiple locations?",
			a: "Yes. Each location can have its own menu, hours, and booking system while sharing a unified brand and website. The admin panel lets you manage all locations from one dashboard.",
		},
		{
			q: "What about food photography?",
			a: "Upload your photos and the AI optimizes them for web — proper sizing, compression, and lazy loading. The gallery component handles layout automatically. We recommend professional food photography, but smartphone photos work too.",
		},
		{
			q: "Is there a free plan for small restaurants?",
			a: "QUESTPIE Framework is free and open source — you can self-host your restaurant website at no cost. QUESTPIE Cloud starts with a free tier for evaluation, with paid plans from $19/month that include hosting, AI builder, and managed Autopilot agents.",
		},
	],
};

export const Route = createFileRoute("/for/restaurants")({
	component: () => <UseCasePage data={DATA} />,
	head: () => ({
		links: generateLinks({ url: "/for/restaurants" }),
		meta: generateMeta({
			title:
				"QUESTPIE for Restaurants — Website, menu, ordering & marketing in one",
			description:
				"All-in-one restaurant platform. Menu management, online reservations, ordering, and AI-powered marketing. Replace five subscriptions with one.",
			url: "/for/restaurants",
			keywords: [
				"restaurant website builder",
				"restaurant management platform",
				"online menu management",
				"restaurant online ordering",
				"restaurant reservation system",
				"restaurant marketing automation",
				"restaurant CMS",
				"cafe website builder",
				"food business website",
				"restaurant SEO",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "WebPage",
					name: "QUESTPIE for Restaurants",
					description:
						"All-in-one restaurant platform with menu management, online ordering, reservations, and AI marketing.",
					url: `${siteConfig.url}/for/restaurants`,
					isPartOf: { "@id": `${siteConfig.url}/#website` },
					about: { "@id": `${siteConfig.url}/#software` },
				}),
			},
		],
	}),
	headers: () => ({
		"Cache-Control":
			"public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
	}),
	staleTime: 60 * 60_000,
	gcTime: 2 * 60 * 60_000,
});
