import { createFileRoute } from "@tanstack/react-router";

const LLMS_TXT_CONTENT = `# QUESTPIE CMS

> A headless CMS that lives inside your codebase

QUESTPIE CMS is a type-safe, embeddable headless CMS built with TypeScript. It integrates directly into your application, providing a powerful admin interface and API without external dependencies.

## Documentation

- Full documentation: /llms-full.txt
- Individual pages: /docs/{path}.mdx

## Quick Links

- Getting Started: /docs/introduction/getting-started.mdx
- Collections: /docs/core-concepts/collections.mdx
- Fields: /docs/core-concepts/fields.mdx
- Hooks: /docs/core-concepts/hooks.mdx
- Authentication: /docs/guides/authentication.mdx

## Features

- Type-safe collections and fields using Drizzle ORM
- Built-in authentication with Better Auth
- File storage with Flydrive
- Background jobs with pg-boss
- Email templates with React Email
- Real-time subscriptions via SSE
- Framework adapters for Hono, Elysia, Next.js, and TanStack Start
`;

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: async () => {
				return new Response(LLMS_TXT_CONTENT, {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control":
							"public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
					},
				});
			},
		},
	},
});
