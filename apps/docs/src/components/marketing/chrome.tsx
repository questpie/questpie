/* The marketing header and footer.
 *
 * The kit renders these from one place (marketing.js) so the chrome cannot drift
 * between pages; the same reason applies here, with three routes sharing it.
 *
 * Every class name below is defined in styles/marketing.css, which nests the
 * whole kit grammar under `.qp-marketing`. The wrapper is load-bearing, not
 * decoration: bare names like .card, .row and .nav would otherwise collide with
 * fumadocs and the docs shell, which share this document.
 *
 * No theme toggle here, and that is deliberate. marketing.css: "Marketing is
 * dark-only — the site is one continuous atmosphere. The product (admin,
 * Autopilot) keeps both themes; that is where people work all day." __root.tsx
 * forces it, so a light preference stored by the docs cannot leak in.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import questpiePackage from "../../../../../packages/questpie/package.json";

const GITHUB_URL = "https://github.com/questpie/questpie";
const EARLY_ACCESS = "/autopilot#cta";

export type MarketingPage = "home" | "autopilot" | "framework" | "docs";

const LINKS: { id: MarketingPage; label: string; href: string }[] = [
	{ id: "autopilot", label: "Autopilot", href: "/autopilot" },
	{ id: "framework", label: "Framework", href: "/framework" },
	{ id: "docs", label: "Docs", href: "/docs" },
];

/** The routes that carry the mesh, the grain and the forced dark theme. */
const MARKETING_PATHS = new Set(["/", "/framework", "/autopilot"]);

export function isMarketingPath(pathname: string): boolean {
	return MARKETING_PATHS.has(pathname.replace(/(.)\/$/, "$1"));
}

function Lockup({ fontSize, size }: { fontSize: number; size: number }) {
	return (
		<Link className="lockup" to="/">
			{/* The bare mark carries no <text>, so an <img> is safe: nothing in it
			    depends on a font the page stylesheet cannot reach. alt is empty
			    because the wordmark beside it already names the link. */}
			<img
				alt=""
				height={size}
				src="/brand/questpie-mark-bare.svg"
				width={size}
			/>
			<span style={{ fontSize }}>Questpie</span>
		</Link>
	);
}

/* Two bars and an X, drawn rather than imported: the kit ships no icon set, and
 * one 6-line shape is cheaper than reaching for the app's iconify runtime. */
function ToggleIcon({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="16"
			stroke="currentColor"
			strokeLinecap="round"
			strokeWidth="1.6"
			viewBox="0 0 16 16"
			width="16"
		>
			{open ? (
				<>
					<line x1="3.5" x2="12.5" y1="3.5" y2="12.5" />
					<line x1="12.5" x2="3.5" y1="3.5" y2="12.5" />
				</>
			) : (
				<>
					<line x1="2.5" x2="13.5" y1="5.5" y2="5.5" />
					<line x1="2.5" x2="13.5" y1="10.5" y2="10.5" />
				</>
			)}
		</svg>
	);
}

function MarketingNav({ page }: { page: MarketingPage }) {
	const [scrolled, setScrolled] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 4);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		if (!menuOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenuOpen(false);
		};
		/* CSS hides the panel above the breakpoint, so a rotate or a resize would
		   otherwise leave it open and invisible, and the toggle out of step. */
		const onResize = () => {
			if (window.innerWidth > 832) setMenuOpen(false);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", onResize);
		};
	}, [menuOpen]);

	return (
		<header className="nav" data-scrolled={String(scrolled)}>
			<div className="wrap nav-inner">
				<Lockup fontSize={22} size={28} />
				<nav className="nav-links">
					{LINKS.map((link) => (
						<a
							aria-current={link.id === page ? "page" : undefined}
							href={link.href}
							key={link.id}
						>
							{link.label}
						</a>
					))}
				</nav>
				<div className="nav-actions">
					<a
						className="btn g"
						href={GITHUB_URL}
						rel="noreferrer"
						target="_blank"
					>
						GitHub
					</a>
					<a className="btn p" href={EARLY_ACCESS}>
						Get early access
					</a>
					<button
						aria-controls="marketing-nav-menu"
						aria-expanded={menuOpen}
						aria-label={menuOpen ? "Close menu" : "Open menu"}
						className="nav-toggle"
						onClick={() => setMenuOpen((open) => !open)}
						type="button"
					>
						<ToggleIcon open={menuOpen} />
					</button>
				</div>
			</div>

			<div
				className="nav-menu"
				data-open={String(menuOpen)}
				id="marketing-nav-menu"
			>
				{LINKS.map((link) => (
					<a
						aria-current={link.id === page ? "page" : undefined}
						href={link.href}
						key={link.id}
						onClick={() => setMenuOpen(false)}
					>
						{link.label}
					</a>
				))}
				<a
					href={GITHUB_URL}
					onClick={() => setMenuOpen(false)}
					rel="noreferrer"
					target="_blank"
				>
					GitHub
				</a>
			</div>
		</header>
	);
}

function MarketingFooter() {
	return (
		<footer className="site-footer">
			<div className="wrap">
				<Lockup fontSize={17} size={22} />
				<span>Open source. Self-hosted. MIT.</span>
				<nav>
					{LINKS.map((link) => (
						<a href={link.href} key={link.id}>
							{link.label}
						</a>
					))}
					<a href={GITHUB_URL} rel="noreferrer" target="_blank">
						GitHub
					</a>
				</nav>
				<span className="qp-eyebrow">
					v{questpiePackage.version} · © {new Date().getFullYear()}
				</span>
			</div>
		</footer>
	);
}

export function MarketingChrome({
	children,
	page,
}: {
	children: React.ReactNode;
	page: MarketingPage;
}) {
	return (
		<div className="qp-marketing">
			<MarketingNav page={page} />
			<main>{children}</main>
			<hr className="rule" />
			<MarketingFooter />
		</div>
	);
}
