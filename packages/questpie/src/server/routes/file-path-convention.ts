/**
 * File-path to route pattern convention.
 *
 * Converts file-system naming conventions to route matcher patterns:
 * - `[param]` → `:param` (parameterized segment)
 * - `[...slug]` → `*slug` (wildcard/catch-all)
 * - `admin/stats` → `admin/stats` (literal)
 * - `users/[id]/posts` → `users/:id/posts`
 * - `files/[...path]` → `files/*path`
 *
 * @module
 */

/**
 * Convert a file-based route key to a route matcher pattern.
 *
 * @param fileKey - Route key from file path (e.g., "users/[id]/posts")
 * @returns Route pattern for the matcher (e.g., "users/:id/posts")
 */
export function filePathToRoutePattern(fileKey: string): string {
	return fileKey
		.split("/")
		.map((segment) => {
			// Catch-all: [...slug] → *slug
			if (segment.startsWith("[...") && segment.endsWith("]")) {
				const name = segment.slice(4, -1);
				return `*${name}`;
			}
			// Parameterized: [id] → :id
			if (segment.startsWith("[") && segment.endsWith("]")) {
				const name = segment.slice(1, -1);
				return `:${name}`;
			}
			// Literal: as-is
			return segment;
		})
		.join("/");
}

/**
 * Convert a route matcher pattern back to a file-based route key (inverse of filePathToRoutePattern).
 *
 * @param pattern - Route pattern (e.g., "users/:id/posts")
 * @returns File-based route key (e.g., "users/[id]/posts")
 */
export function routePatternToFilePath(pattern: string): string {
	return pattern
		.split("/")
		.map((segment) => {
			// Wildcard: *slug → [...slug]
			if (segment.startsWith("*")) {
				const name = segment.slice(1);
				return `[...${name}]`;
			}
			// Parameterized: :id → [id]
			if (segment.startsWith(":")) {
				const name = segment.slice(1);
				return `[${name}]`;
			}
			// Literal: as-is
			return segment;
		})
		.join("/");
}
