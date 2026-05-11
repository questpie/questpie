import { createFileRoute } from "@tanstack/react-router";

import {
	UseCasePage,
	type UseCaseData,
} from "@/components/landing/use-case-template";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const DATA: UseCaseData = {
	slug: "ecommerce",
	name: "E-commerce & Retail",
	headline: (
		<>
			Your online store,
			<br className="hidden sm:block" />
			<span className="text-[#b700ff]"> without the platform tax.</span>
		</>
	),
	description:
		"Product catalog, storefront, inventory management, and AI-powered product descriptions — all on infrastructure you own.",
	painPoints: [
		{
			icon: "ph:percent",
			title: "Platform fees eat your margins",
			description:
				"Transaction fees, app fees, theme fees. Your e-commerce platform takes a cut of every sale on top of monthly costs.",
		},
		{
			icon: "ph:lock-key",
			title: "Locked into one ecosystem",
			description:
				"Want to change platforms? Good luck migrating products, customers, and order history. Vendor lock-in by design.",
		},
		{
			icon: "ph:text-aa",
			title: "Product content is a bottleneck",
			description:
				"Writing descriptions, optimizing SEO, creating variant images — for hundreds of products, it never ends.",
		},
		{
			icon: "ph:plugs",
			title: "Plugin sprawl",
			description:
				"Reviews, SEO, email, analytics, inventory — every feature is a paid plugin. Your store is a stack of third-party code.",
		},
	],
	solutions: [
		{
			icon: "ph:receipt",
			title: "Zero platform fees",
			description:
				"Open-source foundation. No transaction fees, no per-sale cuts. Your revenue stays yours. Pay only for hosting.",
		},
		{
			icon: "ph:lock-open",
			title: "Own your data, always",
			description:
				"Products, customers, orders — stored in your database. Export anytime. Self-host or use Cloud. No lock-in.",
		},
		{
			icon: "ph:robot",
			title: "AI writes your product content",
			description:
				"Autopilot generates product descriptions, SEO titles, meta tags, and alt text. Bulk-process hundreds of products.",
		},
		{
			icon: "ph:cube",
			title: "Everything built in",
			description:
				"Products, categories, variants, inventory, media, SEO — all native. No plugins to install, update, or debug.",
		},
	],
	features: [
		{
			icon: "ph:package",
			title: "Product catalog",
			description:
				"Products with variants, categories, tags, pricing, and inventory. Flexible schema — add any field your business needs.",
		},
		{
			icon: "ph:storefront",
			title: "AI storefront builder",
			description:
				"Describe your brand and products. AI builds a storefront with product grids, filtering, and checkout flow.",
		},
		{
			icon: "ph:archive",
			title: "Inventory management",
			description:
				"Track stock levels, set low-stock alerts, manage warehouse locations. Automatic updates on orders.",
		},
		{
			icon: "ph:magnifying-glass",
			title: "SEO optimization",
			description:
				"AI generates meta titles, descriptions, structured data, and alt text. Automatic sitemap and schema.org markup.",
		},
		{
			icon: "ph:images",
			title: "Product media",
			description:
				"Upload product photos with automatic optimization, resizing, and CDN delivery. Gallery views with zoom.",
		},
		{
			icon: "ph:tag",
			title: "Flexible pricing",
			description:
				"Regular prices, sale prices, tiered pricing, bulk discounts. Multi-currency support for international stores.",
		},
		{
			icon: "ph:envelope",
			title: "Email automation",
			description:
				"Abandoned cart recovery, order confirmations, shipping updates, and promotional campaigns — all automated.",
		},
		{
			icon: "ph:chart-bar",
			title: "Sales analytics",
			description:
				"Revenue, conversion rates, top products, customer behavior. Privacy-friendly analytics, no third-party scripts.",
		},
	],
	pillars: {
		framework: [
			"Product, category, and order collections",
			"Custom admin panel for store management",
			"REST API for headless storefronts",
			"Hooks for payment and shipping integrations",
		],
		cloud: [
			"E-commerce templates ready to customize",
			"AI storefront builder — describe your brand",
			"Managed hosting with CDN and SSL",
			"One-click deploy, zero-downtime updates",
		],
		autopilot: [
			"AI product description generator",
			"Bulk SEO optimization for all products",
			"Automated email campaigns",
			"Sales analytics and inventory alerts",
		],
	},
	faq: [
		{
			q: "How is this different from Shopify or WooCommerce?",
			a: "QUESTPIE is open source with no transaction fees. You own your data and infrastructure. Unlike Shopify, there's no per-sale cut. Unlike WooCommerce, everything is built in — no plugin dependency chains. And AI handles content creation that would take you hours.",
		},
		{
			q: "Can I handle payments?",
			a: "QUESTPIE Framework provides hooks and API endpoints for integrating with payment providers like Stripe, PayPal, or local gateways. Cloud will include pre-configured payment integrations. The payment logic is yours — we don't take a cut.",
		},
		{
			q: "How many products can I manage?",
			a: "There's no artificial product limit. QUESTPIE uses PostgreSQL, which handles millions of records. The admin panel includes filtering, search, and bulk operations for managing large catalogs.",
		},
		{
			q: "Can the AI write product descriptions?",
			a: "Yes. Autopilot agents can generate product descriptions, SEO titles, meta descriptions, and alt text from basic product information and photos. You can process products individually or in bulk, then review and approve before publishing.",
		},
		{
			q: "What about multi-language stores?",
			a: "QUESTPIE Framework has built-in localization. Create product descriptions, categories, and page content in any number of languages. The admin panel supports content translation workflows.",
		},
		{
			q: "Can I migrate from my current platform?",
			a: "Yes. Products, categories, and customer data can be imported via CSV or API. The flexible collection schema means you can match your existing data structure without losing information.",
		},
		{
			q: "Is there a free option?",
			a: "QUESTPIE Framework is free and open source — self-host your store at no cost. Cloud starts with a free tier for evaluation, with paid plans from $19/month including hosting, AI builder, and managed Autopilot.",
		},
	],
};

export const Route = createFileRoute("/for/ecommerce")({
	component: () => <UseCasePage data={DATA} />,
	head: () => ({
		links: generateLinks({ url: "/for/ecommerce" }),
		meta: generateMeta({
			title:
				"QUESTPIE for E-commerce — Online store without platform fees",
			description:
				"Open-source e-commerce platform. Product catalog, AI-powered descriptions, inventory management, and zero transaction fees. Own your store.",
			url: "/for/ecommerce",
			keywords: [
				"ecommerce platform",
				"online store builder",
				"open source ecommerce",
				"product catalog management",
				"ecommerce without transaction fees",
				"AI product descriptions",
				"ecommerce CMS",
				"shopify alternative",
				"self hosted ecommerce",
				"headless ecommerce",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "WebPage",
					name: "QUESTPIE for E-commerce",
					description:
						"Open-source e-commerce platform with product catalog, AI content, and zero platform fees.",
					url: `${siteConfig.url}/for/ecommerce`,
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
