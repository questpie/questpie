/* The TypeScript grammar from the kit's questpie-highlight.js, ported to return
 * React nodes instead of an HTML string.
 *
 * Why not the highlighter the docs already run: a five-line snippet on a landing
 * page does not justify loading a grammar engine, and tokens/syntax.css only has
 * eight roles, so the richer classification would be thrown away on the way in.
 * This tokenizer is deliberately shallow — right for real snippets, and it
 * degrades to plain text rather than crashing on the ones it does not follow.
 *
 * Rule order is load-bearing: the alternation is tried left to right, so a
 * keyword inside a string stays part of the string.
 */
import type { ReactNode } from "react";

const KEYWORDS =
	"import|from|export|default|const|let|var|function|return|await|async|new|class|extends|implements|interface|type|enum|namespace|declare|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|typeof|instanceof|keyof|in|of|as|satisfies|public|private|protected|readonly|static|abstract|get|set|yield|delete|void|null|undefined|true|false|this|super";

/* Every group below is non-capturing, so the outer alternation has exactly one
 * capture per rule and the match index maps straight onto ROLES. */
const RULES: [role: string, pattern: string][] = [
	["comment", "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/"],
	[
		"string",
		"`(?:\\\\[\\s\\S]|[^`\\\\])*`|\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*\"|'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'",
	],
	["keyword", `\\b(?:${KEYWORDS})\\b`],
	[
		"number",
		"\\b0[xX][\\da-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b",
	],
	["fn", "\\b[A-Za-z_$][\\w$]*(?=\\s*\\()"],
	["type", "\\b[A-Z][\\w$]*\\b"],
	["prop", "\\b[A-Za-z_$][\\w$]*(?=\\s*:)"],
	["punct", "[{}()\\[\\]<>.,;:=+\\-*/%!&|?~^]+"],
];

const ROLES = RULES.map(([role]) => role);
const PATTERN = RULES.map(([, source]) => `(${source})`).join("|");

function tokenize(code: string): ReactNode[] {
	const out: ReactNode[] = [];
	let cursor = 0;
	let key = 0;

	for (const match of code.matchAll(new RegExp(PATTERN, "g"))) {
		const at = match.index;
		if (at > cursor) out.push(code.slice(cursor, at));

		const role =
			ROLES[match.slice(1).findIndex((group) => group !== undefined)];
		out.push(
			<span className={`qp-tok-${role}`} key={key++}>
				{match[0]}
			</span>,
		);
		cursor = at + match[0].length;
	}

	if (cursor < code.length) out.push(code.slice(cursor));
	return out;
}

/** A code surface. `bare` drops the frame for a block sitting on an existing one. */
export function CodeSample({
	bare = false,
	code,
}: {
	bare?: boolean;
	code: string;
}) {
	return (
		<pre className={bare ? "qp-code bare" : "qp-code"} data-lang="ts">
			<code>{tokenize(code)}</code>
		</pre>
	);
}
