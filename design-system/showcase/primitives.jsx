/* primitives.jsx — shared design-system components */
const { useState, useEffect, useRef, createContext, useContext } = React;

/* ---------- ICON ---------- */
/* Lightweight icon set drawn inline so we don't pull a runtime. Each icon
   accepts size + stroke and inherits currentColor. */
const ICONS = {
	arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
	arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
	arrowUpRight: <path d="M7 17 17 7M9 7h8v8" />,
	check: <path d="M5 12.5 10 17l9-10" />,
	caretDown: <path d="m6 9 6 6 6-6" />,
	plus: <path d="M12 5v14M5 12h14" />,
	minus: <path d="M5 12h14" />,
	x: <path d="m6 6 12 12M18 6 6 18" />,
	github: (
		<path
			d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.04c-3.34.73-4.04-1.42-4.04-1.42-.55-1.4-1.34-1.77-1.34-1.77-1.1-.75.08-.74.08-.74 1.22.08 1.86 1.25 1.86 1.25 1.08 1.86 2.84 1.32 3.53 1.01.11-.79.42-1.32.77-1.62-2.67-.3-5.47-1.34-5.47-5.94 0-1.31.47-2.39 1.24-3.23-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.3-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.78.84 1.24 1.92 1.24 3.23 0 4.61-2.81 5.63-5.48 5.93.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z"
			fill="currentColor"
			stroke="none"
		/>
	),
	code: <path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 4l-4 16" />,
	cloud: (
		<path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.7 1.6A3.5 3.5 0 0 0 6 18h11Z" />
	),
	robot: (
		<>
			<rect x="4" y="8" width="16" height="12" rx="2" />
			<path d="M12 4v4M9 14h.01M15 14h.01M8 20v2M16 20v2" />
		</>
	),
	database: (
		<>
			<ellipse cx="12" cy="5" rx="8" ry="3" />
			<path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
		</>
	),
	layout: (
		<>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M3 9h18M9 21V9" />
		</>
	),
	shield: <path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3Z" />,
	flow: (
		<>
			<rect x="3" y="3" width="6" height="6" rx="1" />
			<rect x="15" y="15" width="6" height="6" rx="1" />
			<path d="M9 6h6a3 3 0 0 1 3 3v6" />
		</>
	),
	plug: <path d="M9 2v6m6-6v6M5 8h14v3a7 7 0 0 1-14 0V8Zm7 10v4" />,
	spark: (
		<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M18.4 5.6l-2.1 2.1m-8.6 8.6-2.1 2.1" />
	),
	rocket: (
		<path d="M14 4s4 0 6 2-2 6-2 6l-7 7-4-4 7-7s-2-4 0-4Zm-4 12-4 4m4-1-1 1m-4-4 1-1" />
	),
	globe: (
		<>
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
		</>
	),
	store: <path d="M4 8 5.5 3h13L20 8m-16 0v12h16V8M4 8h16M10 13h4v7h-4z" />,
	pencil: <path d="M3 21h4l11-11-4-4L3 17v4ZM14 6l4 4" />,
	search: (
		<>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-4-4" />
		</>
	),
	chart: <path d="M3 20h18M6 16v-4m4 4V8m4 8v-6m4 6V6" />,
	users: (
		<>
			<circle cx="9" cy="8" r="4" />
			<path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8m6 9a7 7 0 0 0-5-6.7" />
		</>
	),
	book: (
		<path d="M4 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H4V4Zm16 0h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H20V4Z" />
	),
	chat: <path d="M21 12a8 8 0 1 1-3.4-6.5L21 4l-1.5 3.4A8 8 0 0 1 21 12Z" />,
	branch: (
		<>
			<circle cx="6" cy="5" r="2" />
			<circle cx="6" cy="19" r="2" />
			<circle cx="18" cy="12" r="2" />
			<path d="M6 7v10M8 12h8" />
		</>
	),
	brackets: <path d="M7 4H4v16h3M17 4h3v16h-3" />,
	bolt: <path d="m13 2-8 12h6l-2 8 8-12h-6l2-8Z" />,
	lock: (
		<>
			<rect x="5" y="11" width="14" height="10" rx="2" />
			<path d="M8 11V8a4 4 0 0 1 8 0v3" />
		</>
	),
	open: (
		<>
			<rect x="5" y="11" width="14" height="10" rx="2" />
			<path d="M8 11V8a4 4 0 0 1 7.5-2" />
		</>
	),
	copy: (
		<>
			<rect x="8" y="8" width="13" height="13" rx="2" />
			<path d="M3 16V5a2 2 0 0 1 2-2h11" />
		</>
	),
	terminal: <path d="m4 8 4 4-4 4m6 0h10" />,
	sun: (
		<>
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
		</>
	),
	moon: <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />,
	menu: <path d="M4 7h16M4 12h16M4 17h16" />,
	zap: <path d="M13 2 4 14h7l-2 8 9-12h-7l2-8Z" />,
	star: (
		<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z" />
	),
	circle: <circle cx="12" cy="12" r="9" />,
	calendar: (
		<>
			<rect x="3" y="5" width="18" height="16" rx="2" />
			<path d="M8 3v4M16 3v4M3 11h18" />
		</>
	),
	folder: (
		<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
	),
};

function Icon({ name, size = 16, stroke = 1.5, className, style }) {
	const path = ICONS[name];
	if (!path) return null;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={stroke}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			style={style}
			aria-hidden="true"
		>
			{path}
		</svg>
	);
}

/* ---------- Brand Mark. Vector copy of public/symbol-dark.svg ---------- */
function Mark({
	size = 22,
	accent = "var(--primary)",
	outline = "currentColor",
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<path
				d="M22 10V2H2V22H10"
				stroke={outline}
				strokeWidth="2"
				strokeLinecap="square"
			/>
			<path d="M23 13H13V23H23V13Z" fill={accent} />
		</svg>
	);
}

function Wordmark({ size = 18 }) {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 8,
				color: "var(--foreground)",
				fontFamily: "var(--font-sans)",
				fontSize: size * 0.78,
				fontWeight: 600,
				letterSpacing: "0.01em",
			}}
		>
			<Mark size={size} />
			QUESTPIE
		</span>
	);
}

/* ---------- Reveal ---------- */
function Reveal({ children, delay = 0, as = "div", style }) {
	const Tag = as;
	return (
		<Tag data-reveal style={{ transitionDelay: `${delay}ms`, ...style }}>
			{children}
		</Tag>
	);
}

/* ---------- Eyebrow ---------- */
function Eyebrow({ children, dot, color = "var(--foreground-subtle)" }) {
	return (
		<span
			className="eyebrow"
			style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
		>
			{dot && (
				<span
					style={{
						width: 6,
						height: 6,
						borderRadius: 2,
						background: color,
						display: "inline-block",
					}}
				/>
			)}
			{children}
		</span>
	);
}

/* ---------- Status badge ---------- */
function StatusBadge({ tone = "neutral", children }) {
	const tones = {
		neutral: {
			color: "var(--foreground-muted)",
			bg: "var(--surface-mid)",
			border: "var(--border-subtle)",
		},
		live: {
			color: "var(--success)",
			bg: "color-mix(in srgb, var(--success) 12%, transparent)",
			border: "color-mix(in srgb, var(--success) 28%, transparent)",
		},
		soon: {
			color: "var(--info)",
			bg: "color-mix(in srgb, var(--info) 12%, transparent)",
			border: "color-mix(in srgb, var(--info) 28%, transparent)",
		},
		beta: {
			color: "var(--pillar-autopilot)",
			bg: "color-mix(in srgb, var(--pillar-autopilot) 12%, transparent)",
			border: "color-mix(in srgb, var(--pillar-autopilot) 28%, transparent)",
		},
	};
	const t = tones[tone] || tones.neutral;
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				height: 22,
				padding: "0 8px",
				borderRadius: 6,
				border: `1px solid ${t.border}`,
				background: t.bg,
				color: t.color,
				fontFamily: "var(--font-mono)",
				fontSize: 11,
				fontWeight: 500,
				letterSpacing: "0.02em",
				textTransform: "uppercase",
			}}
		>
			{tone === "live" && (
				<span
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: t.color,
						boxShadow: `0 0 0 3px color-mix(in srgb, ${t.color} 25%, transparent)`,
					}}
				/>
			)}
			{children}
		</span>
	);
}

/* ---------- Code block ---------- */
function CodeBlock({ filename, lang = "ts", lines, copyable = true }) {
	const [copied, setCopied] = useState(false);
	const text = lines
		.map((row) => row.map((t) => (typeof t === "string" ? t : t.t)).join(""))
		.join("\n");
	return (
		<div
			className="panel-low"
			style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}
		>
			{filename && (
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						padding: "10px 14px",
						borderBottom: "1px solid var(--border-subtle)",
						background: "var(--surface-low)",
					}}
				>
					<span
						className="mono"
						style={{ fontSize: 12, color: "var(--foreground-subtle)" }}
					>
						{filename}
					</span>
					{copyable && (
						<button
							type="button"
							onClick={() => {
								navigator.clipboard?.writeText(text);
								setCopied(true);
								setTimeout(() => setCopied(false), 1400);
							}}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								color: "var(--foreground-subtle)",
								fontFamily: "var(--font-mono)",
								fontSize: 11,
							}}
						>
							<Icon name={copied ? "check" : "copy"} size={12} />
							{copied ? "Copied" : "Copy"}
						</button>
					)}
				</div>
			)}
			<pre
				className="thin-scroll"
				style={{
					margin: 0,
					padding: "16px 18px",
					fontFamily: "var(--font-mono)",
					fontSize: 13,
					lineHeight: 1.75,
					color: "var(--foreground)",
					overflowX: "auto",
					background: "var(--card)",
				}}
			>
				{lines.map((row, i) => (
					<div key={i} style={{ display: "flex" }}>
						<span
							style={{
								userSelect: "none",
								width: 28,
								color: "var(--foreground-subtle)",
								opacity: 0.5,
								textAlign: "right",
								paddingRight: 14,
								flexShrink: 0,
							}}
						>
							{i + 1}
						</span>
						<span style={{ whiteSpace: "pre" }}>
							{row.map((t, j) =>
								typeof t === "string" ? (
									<span key={j}>{t}</span>
								) : (
									<span key={j} style={{ color: t.c }}>
										{t.t}
									</span>
								),
							)}
						</span>
					</div>
				))}
			</pre>
		</div>
	);
}

/* ---------- Section wrapper ---------- */
function Section({ id, children, style, maxWidth = 1120, pad = "92px 24px" }) {
	return (
		<section id={id} style={{ padding: pad, ...style }}>
			<div style={{ maxWidth, margin: "0 auto" }}>{children}</div>
		</section>
	);
}

/* ---------- Section heading ---------- */
function SectionHeading({
	eyebrow,
	eyebrowColor,
	title,
	lede,
	align = "left",
	titleSize,
}) {
	return (
		<div
			style={{
				textAlign: align,
				marginBottom: 40,
				maxWidth: align === "center" ? 640 : 720,
				marginInline: align === "center" ? "auto" : undefined,
			}}
		>
			{eyebrow && (
				<div style={{ marginBottom: 14 }}>
					<Eyebrow dot color={eyebrowColor}>
						{eyebrow}
					</Eyebrow>
				</div>
			)}
			<h2
				style={{
					fontSize: titleSize || "clamp(28px, 1.5rem + 1.6vw, 42px)",
					lineHeight: 1.1,
					margin: 0,
					color: "var(--foreground)",
				}}
			>
				{title}
			</h2>
			{lede && (
				<p
					className="balance"
					style={{
						marginTop: 16,
						color: "var(--foreground-muted)",
						fontSize: 16,
						lineHeight: 1.6,
						maxWidth: 580,
						marginInline: align === "center" ? "auto" : undefined,
						textWrap: "balance",
					}}
				>
					{lede}
				</p>
			)}
		</div>
	);
}

/* ---------- syntax-highlight helpers for CodeBlock ---------- */
const STR = (s) => ({ t: s, c: "var(--syntax-string)" });
const FN = (s) => ({ t: s, c: "var(--syntax-function)" });
const KW = (s) => ({ t: s, c: "var(--syntax-keyword)" });
const NUM = (s) => ({ t: s, c: "var(--syntax-number)" });
const PUN = (s) => ({ t: s, c: "var(--syntax-punctuation)" });
const CM = (s) => ({ t: s, c: "var(--syntax-comment)" });
const TYP = (s) => ({ t: s, c: "var(--syntax-type)" });

/* ---------- expose ---------- */
Object.assign(window, {
	Icon,
	Mark,
	Wordmark,
	Reveal,
	Eyebrow,
	StatusBadge,
	CodeBlock,
	Section,
	SectionHeading,
	STR,
	FN,
	KW,
	NUM,
	PUN,
	CM,
	TYP,
});
