import { Icon } from "@iconify/react";
import {
	type CSSProperties,
	type ElementType,
	type ReactNode,
	useEffect,
	useState,
} from "react";

import { cn } from "@/lib/utils";

/* ---------- Brand mark ---------- */
export function Mark({
	size = 22,
	accent = "var(--primary)",
	outline = "currentColor",
}: {
	size?: number;
	accent?: string;
	outline?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<title>QUESTPIE mark</title>
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

export function Wordmark({ size = 18 }: { size?: number }) {
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

/* ---------- Reveal on scroll ---------- */
type RevealProps = {
	children: ReactNode;
	delay?: number;
	as?: ElementType;
	style?: CSSProperties;
	className?: string;
};

export function Reveal({
	children,
	delay = 0,
	as,
	style,
	className,
}: RevealProps) {
	const Tag = (as ?? "div") as ElementType;
	return (
		<Tag
			data-reveal=""
			className={className}
			style={{ transitionDelay: `${delay}ms`, ...style }}
		>
			{children}
		</Tag>
	);
}

/** Mount-once hook that wires every [data-reveal] inside the page to an
 * IntersectionObserver. Call this once at the page root.
 *
 * Strategy: mark everything visible by default once mounted, then let the
 * observer add data-visible to anything that scrolls into view (no-op for
 * already-visible elements). The visible-by-default fallback guarantees
 * content never stays hidden if the observer misses an element. */
export function useRevealOnScroll() {
	useEffect(() => {
		const markVisibleIfInView = (el: Element) => {
			const r = el.getBoundingClientRect();
			if (r.top < window.innerHeight && r.bottom > 0) {
				el.setAttribute("data-visible", "");
			}
		};
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (e.isIntersecting) e.target.setAttribute("data-visible", "");
				}
			},
			{ threshold: 0 },
		);
		const observed = new WeakSet<Element>();
		const observe = (el: Element) => {
			if (observed.has(el)) return;
			observed.add(el);
			markVisibleIfInView(el);
			io.observe(el);
		};
		document.querySelectorAll("[data-reveal]").forEach(observe);

		const mo = new MutationObserver((mutations) => {
			for (const m of mutations) {
				for (const node of m.addedNodes) {
					if (!(node instanceof Element)) continue;
					if (node.hasAttribute?.("data-reveal")) observe(node);
					node.querySelectorAll?.("[data-reveal]").forEach(observe);
				}
			}
		});
		mo.observe(document.body, { childList: true, subtree: true });

		// Fallback: after 800ms, mark anything not yet visible. Guarantees
		// content shows even if the observer misses an element.
		const fallback = window.setTimeout(() => {
			document
				.querySelectorAll("[data-reveal]:not([data-visible])")
				.forEach((el) => el.setAttribute("data-visible", ""));
		}, 800);

		return () => {
			io.disconnect();
			mo.disconnect();
			clearTimeout(fallback);
		};
	}, []);
}

/* ---------- Eyebrow ---------- */
export function Eyebrow({
	children,
	dot = false,
	color = "var(--foreground-subtle)",
}: {
	children: ReactNode;
	dot?: boolean;
	color?: string;
}) {
	return (
		<span
			className="landing-eyebrow"
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
type Tone = "neutral" | "live" | "soon" | "beta";
export function StatusBadge({
	tone = "neutral",
	children,
}: {
	tone?: Tone;
	children: ReactNode;
}) {
	const tones: Record<Tone, { color: string; bg: string; border: string }> = {
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
	const t = tones[tone];
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
export type CodeToken = string | { t: string; c: string };
export type CodeLine = CodeToken[];

export function CodeBlock({
	filename,
	lines,
	copyable = true,
	maxHeight,
}: {
	filename?: string;
	lines: CodeLine[];
	copyable?: boolean;
	maxHeight?: number | string;
}) {
	const [copied, setCopied] = useState(false);
	const text = lines
		.map((row) => row.map((t) => (typeof t === "string" ? t : t.t)).join(""))
		.join("\n");
	return (
		<div
			className="landing-panel-low"
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
						className="landing-mono"
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
							<Icon
								icon={copied ? "ph:check" : "ph:copy"}
								width={12}
								height={12}
							/>
							{copied ? "Copied" : "Copy"}
						</button>
					)}
				</div>
			)}
			<pre
				className="landing-thin-scroll"
				style={{
					margin: 0,
					padding: "16px 18px",
					fontFamily: "var(--font-mono)",
					fontSize: 13,
					lineHeight: 1.75,
					color: "var(--foreground)",
					overflowX: "auto",
					overflowY: maxHeight ? "auto" : "visible",
					maxHeight,
					background: "var(--card)",
				}}
			>
				{lines.map((row, i) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: lines are stable
						key={i}
						style={{ display: "flex" }}
					>
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
									// biome-ignore lint/suspicious/noArrayIndexKey: tokens are stable
									<span key={j}>{t}</span>
								) : (
									// biome-ignore lint/suspicious/noArrayIndexKey: tokens are stable
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

/* ---------- Syntax helpers for CodeBlock ---------- */
export const STR = (s: string) => ({ t: s, c: "var(--syntax-string)" });
export const FN = (s: string) => ({ t: s, c: "var(--syntax-function)" });
export const KW = (s: string) => ({ t: s, c: "var(--syntax-keyword)" });
export const NUM = (s: string) => ({ t: s, c: "var(--syntax-number)" });
export const PUN = (s: string) => ({ t: s, c: "var(--syntax-punctuation)" });
export const CM = (s: string) => ({ t: s, c: "var(--syntax-comment)" });
export const TYP = (s: string) => ({ t: s, c: "var(--syntax-type)" });

/* ---------- Section wrapper ---------- */
export function Section({
	id,
	children,
	style,
	className,
	maxWidth = 1120,
	pad = "92px 24px",
}: {
	id?: string;
	children: ReactNode;
	style?: CSSProperties;
	className?: string;
	maxWidth?: number;
	pad?: string;
}) {
	return (
		<section id={id} className={className} style={{ padding: pad, ...style }}>
			<div style={{ maxWidth, margin: "0 auto" }}>{children}</div>
		</section>
	);
}

/* ---------- Section heading ---------- */
export function SectionHeading({
	eyebrow,
	eyebrowColor,
	title,
	lede,
	align = "left",
	titleSize,
}: {
	eyebrow?: string;
	eyebrowColor?: string;
	title: ReactNode;
	lede?: ReactNode;
	align?: "left" | "center";
	titleSize?: string;
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
					className="landing-balance"
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

/* ---------- Star-on-GitHub callout ---------- */
export function StarBanner({ accent = "var(--primary)" }: { accent?: string }) {
	return (
		<Section pad="0 24px 24px">
			<a
				href="https://github.com/questpie/questpie"
				target="_blank"
				rel="noreferrer"
				className="landing-star-banner"
				style={{
					display: "flex",
					alignItems: "center",
					gap: 16,
					padding: "12px 18px",
					border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
					background: `color-mix(in srgb, ${accent} 6%, var(--card))`,
					borderRadius: "var(--surface-radius)",
					color: "var(--foreground)",
					textDecoration: "none",
					transition:
						"background-color var(--motion-duration-base) var(--motion-ease-standard), border-color var(--motion-duration-base) var(--motion-ease-standard)",
					flexWrap: "wrap",
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = `color-mix(in srgb, ${accent} 10%, var(--card))`;
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = `color-mix(in srgb, ${accent} 6%, var(--card))`;
				}}
			>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						width: 32,
						height: 32,
						borderRadius: 8,
						background: `color-mix(in srgb, ${accent} 14%, transparent)`,
						color: accent,
						flexShrink: 0,
					}}
				>
					<Icon icon="ph:star-fill" width={16} height={16} />
				</span>
				<div style={{ flex: 1, minWidth: 200 }}>
					<div
						style={{
							fontSize: 14,
							fontWeight: 500,
							color: "var(--foreground)",
						}}
					>
						QUESTPIE is open source. Star us on GitHub.
					</div>
					<div
						style={{
							fontSize: 12.5,
							color: "var(--foreground-muted)",
							marginTop: 2,
						}}
					>
						The fastest way to support a small team building everything in
						public.
					</div>
				</div>
				<span
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 6,
						fontSize: 13,
						fontWeight: 500,
						color: accent,
					}}
				>
					<Icon icon="ph:github-logo" width={14} height={14} />
					questpie/questpie
					<Icon icon="ph:arrow-up-right" width={12} height={12} />
				</span>
			</a>
		</Section>
	);
}

/* ---------- Accent button style ---------- *
 * Inline style helper for the §4a depth recipe parameterised by a pillar
 * accent color (cloud blue, autopilot green). The shadcn Button default
 * variant always tints toward --primary, so accent buttons compose the
 * accent gradient + matching outer glow here. Apply as
 * `style={accentButtonStyle("var(--pillar-cloud)")}` alongside
 * `className={buttonVariants({ variant: "default" })}`. */
export function accentButtonStyle(accent: string): CSSProperties {
	return {
		backgroundColor: accent,
		backgroundImage: `linear-gradient(to bottom, color-mix(in srgb, ${accent} 100%, white 4%), ${accent})`,
		color: "#0a0a0a",
		fontWeight: 600,
		boxShadow: [
			"inset 0 1px 0 0 color-mix(in srgb, white 22%, transparent)",
			"inset 0 -1px 0 0 color-mix(in srgb, black 18%, transparent)",
			`0 1px 2px -1px color-mix(in srgb, ${accent} 60%, transparent)`,
			"0 2px 6px -2px rgba(0, 0, 0, 0.35)",
		].join(", "),
	};
}

/* ---------- Iconify icon helper ---------- *
 * Thin wrapper that mirrors the design's <Icon name size stroke> API
 * but routes to @iconify/react with the project's Phosphor set. */
export function LIcon({
	name,
	size = 16,
	className,
	style,
}: {
	name: string;
	size?: number;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<Icon
			icon={name.startsWith("ph:") ? name : `ph:${name}`}
			width={size}
			height={size}
			className={cn(className)}
			style={style}
			aria-hidden="true"
		/>
	);
}
