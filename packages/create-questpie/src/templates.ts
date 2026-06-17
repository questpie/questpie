export type Template = {
	id: string;
	label: string;
	hint: string;
	description: string;
};

export const templates: Template[] = [
	{
		id: "tanstack-start",
		label: "TanStack Start",
		hint: "recommended",
		description:
			"Full-stack React with TanStack Start, Vite, Tailwind CSS, and Nitro server",
	},
	{
		id: "hono",
		label: "Hono",
		hint: "headless api",
		description:
			"Headless REST API with Hono on Bun, OpenAPI/Scalar docs, and a typed client (no admin UI)",
	},
	{
		id: "elysia",
		label: "Elysia",
		hint: "headless api",
		description:
			"Headless REST API with Elysia on Bun, OpenAPI/Scalar docs, and a typed client (no admin UI)",
	},
	{
		id: "next",
		label: "Next.js",
		hint: "fullstack",
		description:
			"Full-stack React with Next.js App Router (Turbopack), admin UI, OpenAPI/Scalar docs, and a typed client",
	},
];

export function getTemplate(id: string): Template | undefined {
	return templates.find((t) => t.id === id);
}
