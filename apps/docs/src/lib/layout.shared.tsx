import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "@/components/Logo";

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			url: "/",
			/* Sized down. The asset's intrinsic 196x34 filled roughly seventy
			   percent of the sidebar, which made the wordmark the loudest thing
			   on a screen whose job is the page tree. */
			title: <Logo className="h-6 w-auto" />,
			transparentMode: "always",
		},
		searchToggle: {
			components: {},
		},
		links: [
			{
				text: "Examples",
				url: "https://github.com/questpie/questpie/tree/main/examples",
				external: true,
			},
			{
				text: "GitHub",
				url: "https://github.com/questpie/questpie",
				external: true,
			},
		],
	};
}
