/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- Code blocks scroll horizontally and need keyboard access. */
/* The grammars from the kit's questpie-highlight.js, ported to return React nodes
 * instead of an HTML string.
 *
 * Why not the highlighter the docs already run: a five-line snippet on a landing
 * page does not justify loading a grammar engine, and tokens/syntax.css only has
 * eight roles, so the richer classification would be thrown away on the way in.
 * These tokenizers are deliberately shallow — right for real snippets, and they
 * degrade to plain text rather than crashing on the ones they do not follow.
 *
 * Rule order is load-bearing: the alternation is tried left to right, so a
 * keyword inside a string stays part of the string.
 */
import type { ReactNode } from "react";

type Lang = "bash" | "ts";

const KEYWORDS_TS =
	"import|from|export|default|const|let|var|function|return|await|async|new|class|extends|implements|interface|type|enum|namespace|declare|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|typeof|instanceof|keyof|in|of|as|satisfies|public|private|protected|readonly|static|abstract|get|set|yield|delete|void|null|undefined|true|false|this|super";
const KEYWORDS_BASH =
	"if|then|else|elif|fi|for|in|do|done|while|case|esac|function|return|export|local|source|cd|echo|set|unset";

/* Every group below is non-capturing, so each alternation has exactly one capture
 * per rule and the match index maps straight onto the role list. */
const GRAMMARS: Record<Lang, [role: string, pattern: string][]> = {
	bash: [
		["comment", "#[^\\n]*"],
		["string", "\"(?:\\\\[\\s\\S]|[^\"\\\\])*\"|'(?:[^'])*'"],
		["keyword", `\\b(?:${KEYWORDS_BASH})\\b`],
		["fn", "(?:^|\\n)\\s*[a-z][\\w.-]*"],
		["number", "\\b\\d+\\b"],
		["prop", "--?[A-Za-z][\\w-]*"],
		["punct", "[|&;<>(){}$=]+"],
	],
	ts: [
		["comment", "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/"],
		[
			"string",
			"`(?:\\\\[\\s\\S]|[^`\\\\])*`|\"(?:\\\\[\\s\\S]|[^\"\\\\\\n])*\"|'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'",
		],
		["keyword", `\\b(?:${KEYWORDS_TS})\\b`],
		[
			"number",
			"\\b0[xX][\\da-fA-F_]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b",
		],
		["fn", "\\b[A-Za-z_$][\\w$]*(?=\\s*\\()"],
		["type", "\\b[A-Z][\\w$]*\\b"],
		["prop", "\\b[A-Za-z_$][\\w$]*(?=\\s*:)"],
		["punct", "[{}()\\[\\]<>.,;:=+\\-*/%!&|?~^]+"],
	],
};

const COMPILED = new Map<Lang, { pattern: string; roles: string[] }>();

function grammarFor(lang: Lang) {
	let compiled = COMPILED.get(lang);
	if (!compiled) {
		const rules = GRAMMARS[lang];
		compiled = {
			pattern: rules.map(([, source]) => `(${source})`).join("|"),
			roles: rules.map(([role]) => role),
		};
		COMPILED.set(lang, compiled);
	}
	return compiled;
}

function tokenize(line: string, lang: Lang): ReactNode[] {
	const { pattern, roles } = grammarFor(lang);
	const out: ReactNode[] = [];
	let cursor = 0;
	let key = 0;

	for (const match of line.matchAll(new RegExp(pattern, "g"))) {
		const at = match.index;
		if (at > cursor) out.push(line.slice(cursor, at));

		const role =
			roles[match.slice(1).findIndex((group) => group !== undefined)];
		/* The bash "fn" rule swallows the indent ahead of the command — keep that
		 * outside the span, or the colour runs into the left margin. */
		const raw = match[0];
		const lead = /^\s*/.exec(raw)?.[0] ?? "";
		if (lead) out.push(lead);
		out.push(
			<span className={`qp-tok-${role}`} key={key++}>
				{raw.slice(lead.length)}
			</span>,
		);
		cursor = at + raw.length;
	}

	if (cursor < line.length) out.push(line.slice(cursor));
	return out;
}

/** "2,3" → highlight · "+4" → added · "-5" → removed */
function parseMarks(spec: string): Record<string, string> {
	const table: Record<string, string> = {};
	for (const part of spec.split(/[,\s]+/).filter(Boolean)) {
		if (part.startsWith("+")) table[part.slice(1)] = "add";
		else if (part.startsWith("-")) table[part.slice(1)] = "del";
		else table[part] = "on";
	}
	return table;
}

/**
 * A code surface. `bare` drops the frame for a block sitting on an existing one;
 * `numbers` turns on the gutter counter in syntax.css.
 *
 * Every line is wrapped in .qp-line, the way the kit's enhance() does it, so a
 * line can be marked without re-rendering the block. The wrappers carry no
 * separator between them: .qp-line is display:block inside a <pre>, so a newline
 * would render a second, empty line every time.
 */
export function CodeSample({
	bare = false,
	code,
	lang = "ts",
	mark = "",
	numbers = false,
}: {
	bare?: boolean;
	code: string;
	lang?: Lang;
	mark?: string;
	numbers?: boolean;
}) {
	const marks = parseMarks(mark);

	return (
		<pre
			aria-label="Code sample"
			className={bare ? "qp-code bare" : "qp-code"}
			data-lang={lang}
			data-numbers={numbers ? "" : undefined}
			role="region"
			tabIndex={0}
		>
			<code>
				{code.split("\n").map((line, index) => (
					<span
						className="qp-line"
						data-mark={marks[String(index + 1)]}
						key={index}
					>
						{line ? tokenize(line, lang) : "​"}
					</span>
				))}
			</code>
		</pre>
	);
}
