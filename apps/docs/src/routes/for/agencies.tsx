import { createFileRoute } from "@tanstack/react-router";

import {
	UseCasePage,
	type UseCaseData,
} from "@/components/landing/use-case-template";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const DATA: UseCaseData = {
	slug: "agencies",
	name: "Agencies & Studios",
	headline: (
		<>
			Stop managing clients.
			<br className="hidden sm:block" />
			<span className="text-[#b700ff]"> Start scaling your agency.</span>
		</>
	),
	description:
		"Build client websites in minutes, manage projects from one dashboard, and let AI handle the content work that burns your team's hours.",
	painPoints: [
		{
			icon: "ph:browsers",
			title: "Every client is a different stack",
			description:
				"WordPress here, Webflow there, Squarespace for that one client. Every project is a different login, different workflow.",
		},
		{
			icon: "ph:users-three",
			title: "Client management chaos",
			description:
				"Spreadsheets for project tracking, email for feedback, Slack for questions. Context scattered across a dozen tools.",
		},
		{
			icon: "ph:pencil-line",
			title: "Content creation doesn't scale",
			description:
				"Writing copy, blog posts, and social content for 10+ clients is a full-time job. You hired designers, not copywriters.",
		},
		{
			icon: "ph:repeat",
			title: "Rebuilding the same thing every time",
			description:
				"Every client project starts from scratch. No shared components, no templates, no way to reuse what you've already built.",
		},
	],
	solutions: [
		{
			icon: "ph:stack",
			title: "One platform, all clients",
			description:
				"Every client project runs on QUESTPIE. Same admin, same workflow, same deployment process. Train your team once.",
		},
		{
			icon: "ph:kanban",
			title: "Built-in project management",
			description:
				"Tasks, timelines, and client communication inside the same platform where you build. No more tool-hopping.",
		},
		{
			icon: "ph:robot",
			title: "AI content at scale",
			description:
				"Autopilot agents write blog posts, social content, and SEO copy for all your clients. Review, approve, publish.",
		},
		{
			icon: "ph:copy",
			title: "Templates and reusable blocks",
			description:
				"Build once, deploy everywhere. Create agency templates and component libraries that speed up every new project.",
		},
	],
	features: [
		{
			icon: "ph:paint-brush",
			title: "AI site builder",
			description:
				"Spin up client websites in minutes. Describe the brand and business — AI generates a complete site with content.",
		},
		{
			icon: "ph:folders",
			title: "Multi-project dashboard",
			description:
				"All client projects in one view. Switch between projects instantly. Shared team, shared billing.",
		},
		{
			icon: "ph:user-switch",
			title: "Client handoff",
			description:
				"Give clients access to their own admin panel. They manage content while you maintain the design and infrastructure.",
		},
		{
			icon: "ph:layout",
			title: "Component library",
			description:
				"Build reusable sections — hero blocks, pricing tables, testimonial grids. Drag into any client project.",
		},
		{
			icon: "ph:article",
			title: "AI content creation",
			description:
				"Blog posts, landing pages, product descriptions — AI drafts content for all your clients. You review before publish.",
		},
		{
			icon: "ph:globe",
			title: "Custom domains per client",
			description:
				"Each client gets their own domain with automatic SSL. DNS configuration handled by Cloud.",
		},
		{
			icon: "ph:git-branch",
			title: "Staging environments",
			description:
				"Preview changes before going live. Show clients exactly what they'll get before you deploy to production.",
		},
		{
			icon: "ph:chart-line-up",
			title: "Client reporting",
			description:
				"Traffic, engagement, and conversion analytics per client. Export reports or give clients dashboard access.",
		},
	],
	pillars: {
		framework: [
			"Flexible collections for any client's data model",
			"Custom admin panels per project",
			"REST API for headless frontends",
			"Hooks and extensions for client-specific logic",
		],
		cloud: [
			"Agency templates — spin up client sites fast",
			"Multi-project management from one account",
			"Per-client domains and SSL",
			"Staging and production environments",
		],
		autopilot: [
			"AI content creation across all client projects",
			"SEO optimization at scale",
			"Task and project management",
			"Automated reporting and analytics",
		],
	},
	faq: [
		{
			q: "Can my clients manage their own content?",
			a: "Yes. Each client gets access to their own admin panel where they can manage content, upload media, and publish pages. You control what they can access and edit. They never see other clients' projects.",
		},
		{
			q: "How do I manage multiple client projects?",
			a: "Cloud provides a multi-project dashboard. Switch between client projects instantly. Each project has its own domain, database, and admin panel — but they're all managed from your single agency account.",
		},
		{
			q: "Can I create reusable templates for my agency?",
			a: "Yes. Build template projects with pre-configured collections, admin layouts, and frontend components. When you start a new client project, clone a template and customize it. Save hours on every engagement.",
		},
		{
			q: "How does AI content creation work for agencies?",
			a: "Autopilot agents can draft blog posts, social content, and marketing copy for any client project. You configure the brand voice and tone per client. The AI produces drafts, your team reviews and approves, then it publishes on schedule.",
		},
		{
			q: "Is there white-label support?",
			a: "The admin panel is customizable — you can brand it with your agency's logo and colors, or the client's brand. The CMS itself has no visible QUESTPIE branding that would confuse your clients.",
		},
		{
			q: "How is pricing structured for agencies?",
			a: "Cloud pricing is per-project, not per-seat. The Pro plan ($49/mo) supports 10 projects — ideal for small agencies. The Scale plan offers unlimited projects with dedicated resources for larger agencies.",
		},
		{
			q: "Can I self-host client projects?",
			a: "Yes. QUESTPIE Framework is open source. You can self-host any or all client projects on your own infrastructure. Cloud is a convenience — use it for clients who want managed hosting, self-host for those who don't.",
		},
	],
};

export const Route = createFileRoute("/for/agencies")({
	component: () => <UseCasePage data={DATA} />,
	head: () => ({
		links: generateLinks({ url: "/for/agencies" }),
		meta: generateMeta({
			title:
				"QUESTPIE for Agencies — Build & manage client websites at scale",
			description:
				"Agency platform for managing multiple client projects. AI website builder, reusable templates, client handoff, and content automation from one dashboard.",
			url: "/for/agencies",
			keywords: [
				"agency website builder",
				"agency management platform",
				"client website management",
				"white label CMS",
				"multi-project CMS",
				"agency CMS platform",
				"client content management",
				"agency project management",
				"website builder for agencies",
				"manage client websites",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "WebPage",
					name: "QUESTPIE for Agencies",
					description:
						"Agency platform for building and managing multiple client websites with AI content automation.",
					url: `${siteConfig.url}/for/agencies`,
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
