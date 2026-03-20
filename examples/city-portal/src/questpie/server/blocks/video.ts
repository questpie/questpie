import { block } from "#questpie/factories";

import { content } from "./_categories";

export const videoBlock = block("video")
	.admin(({ c }) => ({
		label: "Video Embed",
		icon: c.icon("ph:video"),
		category: content(c),
		order: 6,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title"),
		url: f
			.text()
			.label("Video URL")
			.description("YouTube or Vimeo URL")
			.required(),
		caption: f.text().label("Caption"),
	}));
