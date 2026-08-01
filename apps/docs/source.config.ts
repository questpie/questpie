import { remarkMdxMermaid } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
	dir: "content/docs",
});

/* fumadocs defaults to github-light/github-dark, which put #D73A49, #F97583,
 * #032F62 and #24292E — a cool red/blue/purple ramp — inside a warm canon, on
 * every code block in the docs. Meanwhile the canon's own eight-role ladder was
 * defined, resolving, and consumed by nothing here.
 *
 * The colours below are `var(--syntax-*)` rather than literals. Shiki writes a
 * theme's foreground straight into the style attribute, so the custom property
 * survives to the browser and resolves there — which is why one set of settings
 * serves both themes: tokens/syntax.css declares the ladder twice and the class
 * on <html> picks. The light/dark split below is a formality shiki requires, not
 * two palettes.
 *
 * It has to be `themes`, plural. rehypeCodeDefaultOptions sets
 * `themes: {light: "github-light", dark: "github-dark"}`, so passing `theme`
 * alone leaves both keys present and shiki keeps GitHub — measured, that was the
 * first attempt and nothing changed.
 *
 * (shiki's `css-variables` theme would have been the obvious route; it was
 * removed after v1 and this repo is on v4.)
 *
 * Scopes are TextMate names, one role per line, so the mapping reads next to
 * tokens/syntax.css.
 */
const SYNTAX_SETTINGS = [
	{ settings: { foreground: "var(--foreground)" } },
	{
		scope: ["comment", "punctuation.definition.comment"],
		settings: { foreground: "var(--syntax-comment)" },
	},
	{
		scope: ["string", "constant.other.symbol", "meta.embedded.assembly"],
		settings: { foreground: "var(--syntax-string)" },
	},
	{
		scope: ["constant.numeric", "constant.language", "constant.character"],
		settings: { foreground: "var(--syntax-number)" },
	},
	{
		scope: ["keyword", "storage", "storage.type", "keyword.operator.new"],
		settings: { foreground: "var(--syntax-keyword)" },
	},
	{
		scope: [
			"entity.name.function",
			"support.function",
			"meta.function-call.generic",
		],
		settings: { foreground: "var(--syntax-fn)" },
	},
	{
		scope: [
			"entity.name.type",
			"entity.name.class",
			"support.type",
			"support.class",
		],
		settings: { foreground: "var(--syntax-type)" },
	},
	{
		scope: [
			"variable.other.property",
			"meta.object-literal.key",
			"support.type.property-name",
			"entity.name.tag",
		],
		settings: { foreground: "var(--syntax-prop)" },
	},
	{
		scope: ["punctuation", "meta.brace", "keyword.operator"],
		settings: { foreground: "var(--syntax-punct)" },
	},
];

function questpieSyntax(name: string, type: "dark" | "light") {
	return {
		name,
		type,
		bg: "var(--card)",
		fg: "var(--foreground)",
		colors: {
			"editor.background": "var(--card)",
			"editor.foreground": "var(--foreground)",
		},
		settings: SYNTAX_SETTINGS,
	};
}

export default defineConfig({
	mdxOptions: {
		rehypeCodeOptions: {
			themes: {
				dark: questpieSyntax("questpie-dark", "dark"),
				light: questpieSyntax("questpie-light", "light"),
			},
		},
		remarkPlugins: [remarkMdxMermaid],
	},
});
