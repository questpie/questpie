import { collection } from "#questpie/factories";

export const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).label("Title").required(),
		slug: f.text(255).label("Slug").required(),
		content: f.textarea().label("Content"),
		published: f.boolean().label("Published").default(false).required(),
	}))
	.title(({ f }) => f.title);
