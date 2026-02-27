/**
 * Blog Service
 *
 * A singleton service that provides blog-related utilities.
 * Injected into AppContext as `blog` — available in all hooks, functions, and jobs.
 *
 * Usage in hooks (context-first — no `import { app }`):
 *   .hooks({ beforeChange: async ({ data, blog }) => {
 *     data.readingTime = blog.computeReadingTime(data.content);
 *   }})
 */
import { service } from "questpie";

// ── BlogService ──────────────────────────────────────────────────────────────

export class BlogService {
	/** Average reading speed in words per minute. */
	private readonly wordsPerMinute: number;

	constructor(wordsPerMinute = 200) {
		this.wordsPerMinute = wordsPerMinute;
	}

	/**
	 * Compute estimated reading time in minutes from plain or HTML content.
	 * Returns at least 1 minute.
	 */
	computeReadingTime(content: string): number {
		// Strip HTML tags if present
		const text = content.replace(/<[^>]*>/g, " ");
		const wordCount = text
			.trim()
			.split(/\s+/)
			.filter((w) => w.length > 0).length;
		return Math.max(1, Math.ceil(wordCount / this.wordsPerMinute));
	}

	/**
	 * Generate a URL-friendly slug from a title.
	 * "My First Post!" → "my-first-post"
	 */
	generateSlug(title: string): string {
		return title
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-");
	}

	/**
	 * Extract a plain-text excerpt from content (strips HTML, truncates).
	 */
	extractExcerpt(content: string, maxLength = 160): string {
		const text = content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
		if (text.length <= maxLength) return text;
		return `${text.slice(0, maxLength - 3).trimEnd()}...`;
	}
}

// ── Service definition ───────────────────────────────────────────────────────

export default service({
	lifecycle: "singleton",
	create: () => new BlogService(),
});
