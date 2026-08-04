/* The lockup is inlined rather than loaded through `<img src>`.
 *
 * An SVG inside an `<img>` is an isolated document: no stylesheet from the page
 * reaches it, so the `@font-face` that carries Bricolage never applies and the
 * wordmark renders in whatever the system offers. Measured on the shipped file,
 * `QUESTPIE` at 800/26px advances 125.30px under the family name the asset
 * declares against 127.71px in the real face — a different typeface, silently.
 *
 * Embedding the font in the SVG would fix it too, but the latin subset is 40 KB,
 * roughly 53 KB once base64'd, on every page load. Inlining costs nothing: the
 * document has already loaded the face for its own text.
 *
 * One component replaces the two files the app used to swap between, because the
 * only difference between them was the wordmark colour, and that is a token.
 */
export function Logo({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			width="196"
			height="34"
			viewBox="0 0 196 34"
			fill="none"
			role="img"
			aria-label="QUESTPIE"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* the tiled mark — the container the brand reserves for chrome */}
			<rect width="34" height="34" rx="9.2" fill="var(--coral, #f26a45)" />
			<rect
				x="7.79"
				y="7.79"
				width="13.46"
				height="13.46"
				rx="3.4"
				fill="#ffffff"
				opacity="0.42"
			/>
			<rect
				x="14.52"
				y="14.52"
				width="11.69"
				height="11.69"
				rx="2.98"
				fill="#ffffff"
			/>

			{/* textLength pins the wordmark to 144 units, so the lockup keeps its
			    geometry even before the webfont resolves — only the letterforms
			    settle in late. */}
			<text
				x="46"
				y="25.5"
				fontFamily='var(--font-wordmark, "Bricolage Grotesque Variable"), system-ui, sans-serif'
				fontSize="26"
				fontWeight="800"
				letterSpacing="-0.52"
				textLength="144"
				lengthAdjust="spacingAndGlyphs"
				fill="var(--foreground, #1c1a17)"
			>
				QUESTPIE
			</text>
		</svg>
	);
}
