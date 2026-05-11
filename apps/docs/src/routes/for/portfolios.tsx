import { createFileRoute } from "@tanstack/react-router";

import {
	UseCasePage,
	type UseCaseData,
} from "@/components/landing/use-case-template";
import { generateLinks, generateMeta, siteConfig } from "@/lib/seo";

const DATA: UseCaseData = {
	slug: "portfolios",
	name: "Portfolios & Freelancers",
	headline: (
		<>
			Your work deserves better than
			<br className="hidden sm:block" />
			<span className="text-[#b700ff]"> a Behance page.</span>
		</>
	),
	description:
		"Portfolio website, case studies, client management, and AI that writes your project descriptions — so you can focus on the work itself.",
	painPoints: [
		{
			icon: "ph:eye-slash",
			title: "Your best work is buried",
			description:
				"Portfolio on Behance, resume on LinkedIn, work samples in a Google Drive link. No single place shows who you are.",
		},
		{
			icon: "ph:pencil-slash",
			title: "Case studies never get written",
			description:
				"You know you should document your projects. But writing case studies takes time you'd rather spend on actual work.",
		},
		{
			icon: "ph:calculator",
			title: "Business admin eats your creative time",
			description:
				"Proposals, invoices, project tracking, client emails — the non-billable work that comes with freelancing.",
		},
		{
			icon: "ph:layout",
			title: "Template sites all look the same",
			description:
				"Squarespace portfolios are recognizable from a mile away. Your unique work deserves a unique presentation.",
		},
	],
	solutions: [
		{
			icon: "ph:globe",
			title: "One site, your whole identity",
			description:
				"Portfolio, blog, about, contact, testimonials — all on your domain. Professional, fast, and uniquely yours.",
		},
		{
			icon: "ph:robot",
			title: "AI writes your case studies",
			description:
				"Upload project images and brief notes. Autopilot generates polished case studies with context, process, and results.",
		},
		{
			icon: "ph:briefcase",
			title: "Built-in business tools",
			description:
				"Client list, project tracking, and task management inside the same platform as your portfolio. One login for everything.",
		},
		{
			icon: "ph:paint-brush",
			title: "Truly custom design",
			description:
				"AI builds your site from your creative direction. Not a template with your content poured in — a site that matches your aesthetic.",
		},
	],
	features: [
		{
			icon: "ph:images",
			title: "Project showcase",
			description:
				"Beautiful galleries with categories, filtering, and zoom. Showcase images, videos, embeds, and interactive work.",
		},
		{
			icon: "ph:article",
			title: "Case study builder",
			description:
				"Rich content blocks for process, results, testimonials, and metrics. AI generates drafts from your project notes.",
		},
		{
			icon: "ph:pen-nib",
			title: "Blog & writing",
			description:
				"Share your process, thoughts, and expertise. Built-in rich text editor with code blocks, images, and embeds.",
		},
		{
			icon: "ph:star",
			title: "Testimonials",
			description:
				"Collect and display client testimonials. Request quotes via email, approve and publish from the admin panel.",
		},
		{
			icon: "ph:envelope",
			title: "Contact & inquiries",
			description:
				"Professional contact form with auto-response. All inquiries organized in your admin panel with status tracking.",
		},
		{
			icon: "ph:briefcase",
			title: "Client management",
			description:
				"Track clients, projects, and deliverables. Simple project management built for solo and small-team workflows.",
		},
		{
			icon: "ph:magnifying-glass",
			title: "SEO for creatives",
			description:
				"AI optimizes your project pages for search. Get found for your skills and specializations, not just your name.",
		},
		{
			icon: "ph:devices",
			title: "Responsive by default",
			description:
				"Every layout adapts to mobile, tablet, and desktop. Your portfolio looks professional on any device.",
		},
	],
	pillars: {
		framework: [
			"Project, client, and testimonial collections",
			"Rich text editor for case studies and blog",
			"Media management for portfolio assets",
			"Custom fields for any project metadata",
		],
		cloud: [
			"Portfolio templates for different creative disciplines",
			"AI site builder — describe your aesthetic",
			"Custom domain with SSL",
			"Fast CDN hosting for image-heavy portfolios",
		],
		autopilot: [
			"AI case study generation from project notes",
			"Blog post drafting and SEO optimization",
			"Social media content from your projects",
			"Inquiry management and auto-responses",
		],
	},
	faq: [
		{
			q: "Can I customize the design to match my style?",
			a: "Yes. The AI website builder takes your creative direction — colors, typography, layout preferences — and generates a site that matches your aesthetic. You can also build from scratch with full control over every element.",
		},
		{
			q: "How does AI case study generation work?",
			a: "Upload project images and write brief notes about the project — client, goals, process, results. Autopilot generates a polished case study with structured sections, compelling narrative, and proper formatting. You edit and publish when it's ready.",
		},
		{
			q: "Can I password-protect certain projects?",
			a: "Yes. Mark projects as private or password-protected. Share a unique link with clients or prospective employers. The admin panel lets you control access per project.",
		},
		{
			q: "Does it work for video/motion portfolios?",
			a: "Yes. Embed videos from Vimeo, YouTube, or host directly. The media system handles video alongside images. Create mixed-media project pages with galleries, videos, and text.",
		},
		{
			q: "Can I have a blog alongside my portfolio?",
			a: "Yes. The blog is built in — same admin panel, same design system. Write about your process, share industry insights, or document side projects. AI can help draft posts from your notes.",
		},
		{
			q: "What about custom domains?",
			a: "Cloud supports custom domains with automatic SSL. Use yourname.com for your portfolio. DNS configuration is handled automatically.",
		},
		{
			q: "Is it free for personal portfolios?",
			a: "QUESTPIE Framework is free and open source — self-host your portfolio at zero cost. Cloud has a free tier for evaluation, with paid plans from $19/month that include hosting, AI builder, and managed Autopilot.",
		},
	],
};

export const Route = createFileRoute("/for/portfolios")({
	component: () => <UseCasePage data={DATA} />,
	head: () => ({
		links: generateLinks({ url: "/for/portfolios" }),
		meta: generateMeta({
			title:
				"QUESTPIE for Portfolios — Creative portfolio & freelancer platform",
			description:
				"Portfolio platform for designers, developers, and creatives. AI case study generator, project showcase, blog, and client management in one place.",
			url: "/for/portfolios",
			keywords: [
				"portfolio website builder",
				"freelancer website platform",
				"creative portfolio CMS",
				"designer portfolio builder",
				"case study generator",
				"freelancer portfolio website",
				"photographer portfolio platform",
				"developer portfolio builder",
				"portfolio with blog",
				"creative professional website",
			],
		}),
		scripts: [
			{
				type: "application/ld+json",
				children: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "WebPage",
					name: "QUESTPIE for Portfolios",
					description:
						"Portfolio platform for creatives with AI case study generation, project showcase, and client management.",
					url: `${siteConfig.url}/for/portfolios`,
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
