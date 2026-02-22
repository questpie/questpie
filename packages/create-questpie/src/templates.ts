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
	// Future templates:
	// { id: "hono", label: "Hono", hint: "api-only", description: "Lightweight API server with Hono" },
	// { id: "elysia", label: "Elysia", hint: "bun-native", description: "Bun-native API server with Elysia" },
	// { id: "next", label: "Next.js", hint: "react", description: "React with Next.js App Router" },
];

export function getTemplate(id: string): Template | undefined {
	return templates.find((t) => t.id === id);
}
