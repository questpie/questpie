import { createFileRoute } from '@tanstack/react-router';
import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

const server = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
});

export const Route = createFileRoute("/api/search")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const response = await server.GET(request);
				// Clone response to add ISR headers
				const headers = new Headers(response.headers);
				// Cache search results for 5 minutes, stale for 1 hour
				headers.set(
					"Cache-Control",
					"public, max-age=300, s-maxage=300, stale-while-revalidate=3600"
				);
				return new Response(response.body, {
					status: response.status,
					statusText: response.statusText,
					headers,
				});
			},
		},
	},
});
