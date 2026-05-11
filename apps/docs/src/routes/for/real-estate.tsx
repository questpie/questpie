import { createFileRoute } from "@tanstack/react-router";

import {
	UseCasePage,
	type UseCaseData,
} from "@/components/landing/use-case-template";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const DATA: UseCaseData = {
	slug: "real-estate",
	name: "Real Estate",
	headline: (
		<>
			Listings, leads, and marketing
			<br className="hidden sm:block" />
			<span className="text-[#b700ff]"> in one place.</span>
		</>
	),
	description:
		"Property listing website, lead capture, automated follow-ups, and AI-generated descriptions — built for agents, brokerages, and property managers.",
	painPoints: [
		{
			icon: "ph:list-dashes",
			title: "Listing management is manual",
			description:
				"Copy-paste listings between your website, portals, and social media. One change means updating five systems.",
		},
		{
			icon: "ph:user-minus",
			title: "Leads slip through the cracks",
			description:
				"Inquiry from the website, email from Zillow, DM on Instagram. Without a system, follow-ups get missed.",
		},
		{
			icon: "ph:text-t",
			title: "Writing descriptions takes hours",
			description:
				"Every property needs a unique, compelling description. For a portfolio of 50+ listings, that's a full-time job.",
		},
		{
			icon: "ph:devices",
			title: "Your website looks like 2015",
			description:
				"MLS-provided templates are ugly and slow. Custom development costs $10k+ and takes months.",
		},
	],
	solutions: [
		{
			icon: "ph:database",
			title: "Unified listing management",
			description:
				"Manage all properties in one admin panel. Update once — your website, social posts, and exports update automatically.",
		},
		{
			icon: "ph:funnel",
			title: "Automated lead pipeline",
			description:
				"Every inquiry captured, categorized, and followed up automatically. No lead falls through the cracks.",
		},
		{
			icon: "ph:robot",
			title: "AI property descriptions",
			description:
				"Paste property details, upload photos. AI generates professional listing descriptions optimized for search.",
		},
		{
			icon: "ph:paint-brush",
			title: "Modern website in minutes",
			description:
				"AI builds a professional real estate website with property search, filtering, and lead capture. No development needed.",
		},
	],
	features: [
		{
			icon: "ph:house",
			title: "Property collections",
			description:
				"Bedrooms, bathrooms, price, location, features, status — flexible schema that matches how you think about listings.",
		},
		{
			icon: "ph:magnifying-glass",
			title: "Property search & filters",
			description:
				"Visitors filter by location, price range, property type, bedrooms. Fast, mobile-friendly search experience.",
		},
		{
			icon: "ph:images",
			title: "Photo galleries & tours",
			description:
				"High-res photo galleries with zoom, floorplans, and embedded virtual tours. Automatic image optimization.",
		},
		{
			icon: "ph:map-pin",
			title: "Interactive maps",
			description:
				"Properties plotted on a map with clustering. Neighborhood info, nearby amenities, commute times.",
		},
		{
			icon: "ph:envelope",
			title: "Lead capture forms",
			description:
				"Contact forms on every listing, inquiry popups, newsletter signup. All leads flow into your admin panel.",
		},
		{
			icon: "ph:clock",
			title: "Automated follow-ups",
			description:
				"New inquiry? Automatic thank-you email. No response in 2 days? Reminder. AI handles the drip sequence.",
		},
		{
			icon: "ph:text-aa",
			title: "AI listing descriptions",
			description:
				"Feed in property details — AI writes compelling, SEO-optimized descriptions. Batch-process your entire portfolio.",
		},
		{
			icon: "ph:chart-line-up",
			title: "Market analytics",
			description:
				"Track which listings get the most views, which lead sources convert, and where your marketing budget works.",
		},
	],
	pillars: {
		framework: [
			"Property and agent collections with custom fields",
			"Admin panel for listing management",
			"REST API for portal syndication",
			"Hooks for MLS and CRM integrations",
		],
		cloud: [
			"Real estate website templates",
			"AI website builder with property search",
			"Custom domain and SSL",
			"Managed hosting with CDN for fast photo loading",
		],
		autopilot: [
			"AI property description generator",
			"Automated lead nurture sequences",
			"Social media post generation from listings",
			"Market analytics and reporting",
		],
	},
	faq: [
		{
			q: "Can I import listings from MLS?",
			a: "QUESTPIE Framework exposes a REST API and supports custom hooks. You can set up MLS feed imports using RETS or Web API connections. Cloud will include pre-built MLS integrations for major markets.",
		},
		{
			q: "How does the AI write property descriptions?",
			a: "Provide basic property details (bedrooms, bathrooms, features, location) and photos. Autopilot generates professional descriptions highlighting key selling points. You review, edit if needed, and publish. Batch-process dozens of listings at once.",
		},
		{
			q: "Can I have agent profiles on the site?",
			a: "Yes. Create an agents collection with photos, bios, specializations, and contact info. Each listing links to its listing agent. Agent profile pages show their active listings and contact form.",
		},
		{
			q: "What about IDX integration?",
			a: "The flexible collection schema and REST API make it possible to build IDX-like functionality — property search, saved searches, and lead capture. Cloud will offer pre-configured IDX templates for major markets.",
		},
		{
			q: "Can I manage multiple offices?",
			a: "Yes. Multi-tenant support means each office can have its own listings, agents, and branding while sharing a unified admin and website. Manage everything from one dashboard.",
		},
		{
			q: "How does lead automation work?",
			a: "When someone submits an inquiry, Autopilot can send an instant thank-you email, notify the listing agent, and start a drip sequence. You configure the rules — AI handles execution. Review all leads in the admin panel.",
		},
		{
			q: "Is it mobile-friendly?",
			a: "Yes. All templates and AI-generated sites are responsive. Property search, photo galleries, maps, and contact forms work perfectly on phones and tablets. Critical for real estate — most buyers browse on mobile.",
		},
	],
};

export const Route = createFileRoute("/for/real-estate")({
	component: () => <UseCasePage data={DATA} />,
	head: () => ({
		links: generateLinks({ url: "/for/real-estate" }),
		meta: generateMeta({
			title:
				"QUESTPIE for Real Estate — Listings, leads & marketing platform",
			description:
				"Real estate platform with property listings, lead capture, automated follow-ups, and AI-generated descriptions. For agents, brokerages, and property managers.",
			url: "/for/real-estate",
			keywords: [
				"real estate website builder",
				"property listing management",
				"real estate CRM",
				"property management platform",
				"real estate lead generation",
				"IDX website builder",
				"realtor website platform",
				"property listing website",
				"real estate marketing automation",
				"brokerage website builder",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "WebPage",
					name: "QUESTPIE for Real Estate",
					description:
						"Real estate platform with listings, lead capture, follow-ups, and AI content for agents and brokerages.",
					url: `${siteConfig.url}/for/real-estate`,
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
