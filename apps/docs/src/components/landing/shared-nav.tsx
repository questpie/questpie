import { Link } from "@tanstack/react-router";
import { type MouseEvent as ReactMouseEvent, useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LIcon, Wordmark } from "./primitives";
import { ThemeToggle as LandingThemeToggle } from "./theme-toggle";

const USE_CASE_LINKS = [
	{
		label: "Restaurants & cafés",
		href: "/#uc-restaurants",
		icon: "storefront",
	},
	{ label: "E-commerce & retail", href: "/#uc-ecommerce", icon: "storefront" },
	{ label: "Agencies & studios", href: "/#uc-agencies", icon: "users" },
	{ label: "Real estate", href: "/#uc-realestate", icon: "globe" },
	{ label: "Portfolios", href: "/#uc-portfolios", icon: "pencil" },
];

export type NavKey =
	| "framework"
	| "cloud"
	| "autopilot"
	| "use-cases"
	| "availability"
	| "docs";

type NavItemDef = {
	key: NavKey;
	label: string;
	href: string;
	dropdown?: typeof USE_CASE_LINKS;
};

const NAV_ITEMS: NavItemDef[] = [
	{ key: "framework", label: "Framework", href: "/#framework" },
	{ key: "cloud", label: "Cloud", href: "/cloud" },
	{ key: "autopilot", label: "Autopilot", href: "/autopilot" },
	{
		key: "use-cases",
		label: "Use cases",
		href: "/#use-cases",
		dropdown: USE_CASE_LINKS,
	},
	{ key: "availability", label: "Availability", href: "/#availability" },
	{ key: "docs", label: "Docs", href: "/docs" },
];

function isCurrentPath(href: string): boolean {
	if (typeof window === "undefined") return false;
	try {
		const url = new URL(href, window.location.href);
		return url.pathname === window.location.pathname;
	} catch {
		return false;
	}
}

export function smoothScrollNavigate(
	href: string,
	e?: ReactMouseEvent<HTMLAnchorElement>,
) {
	if (!isCurrentPath(href)) return;
	const url = new URL(href, window.location.href);
	if (!url.hash) return;
	e?.preventDefault();
	const el = document.getElementById(url.hash.slice(1));
	if (el) {
		const top = el.getBoundingClientRect().top + window.scrollY - 70;
		window.scrollTo({ top, behavior: "smooth" });
		history.pushState(null, "", url.hash);
	}
}

export function SharedNav({ activeKey }: { activeKey?: NavKey }) {
	const [scrolled, setScrolled] = useState(false);
	const [mobileOpen, setMobileOpen] = useState(false);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 4);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	return (
		<header
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				width: "100%",
				zIndex: 50,
				height: 56,
				backdropFilter: scrolled ? "blur(14px) saturate(1.05)" : "none",
				WebkitBackdropFilter: scrolled ? "blur(14px) saturate(1.05)" : "none",
				background: scrolled
					? "color-mix(in srgb, var(--background) 78%, transparent)"
					: "transparent",
				borderBottom: scrolled
					? "1px solid var(--border-subtle)"
					: "1px solid transparent",
				transition:
					"background-color var(--motion-duration-base) var(--motion-ease-standard), border-color var(--motion-duration-base) var(--motion-ease-standard)",
			}}
		>
			<div
				style={{
					maxWidth: 1120,
					width: "100%",
					margin: "0 auto",
					height: "100%",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "0 24px",
					gap: 24,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 28,
						minWidth: 0,
					}}
				>
					<Link
						to="/"
						style={{
							display: "inline-flex",
							alignItems: "center",
							flexShrink: 0,
						}}
					>
						<Wordmark size={20} />
					</Link>

					<div
						className="landing-nav-links"
						style={{
							display: "flex",
							alignItems: "center",
							gap: 2,
							color: "var(--foreground-muted)",
							fontSize: 14,
						}}
					>
						{NAV_ITEMS.map((item) => (
							<NavItem
								key={item.key}
								item={item}
								active={activeKey === item.key}
							/>
						))}
					</div>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexShrink: 0,
					}}
				>
					<a
						className={cn(
							buttonVariants({ variant: "ghost", size: "sm" }),
							"landing-hide-md gap-1.5",
						)}
						href="https://github.com/questpie/questpie"
						target="_blank"
						rel="noreferrer"
						data-icon="inline-end"
					>
						<LIcon name="github-logo" size={14} />
						<span>Star on GitHub</span>
						<LIcon name="star" size={11} />
					</a>
					<LandingThemeToggle />
					<a
						className={cn(
							buttonVariants({ variant: "default", size: "sm" }),
							"landing-hide-sm",
						)}
						href="/docs/getting-started/tanstack-start"
						data-icon="inline-end"
					>
						Build with QUESTPIE
						<LIcon name="arrow-right" size={13} />
					</a>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={() => setMobileOpen((v) => !v)}
						className="landing-show-sm"
						aria-label="Toggle navigation"
						style={{ display: "none" }}
					>
						<LIcon name={mobileOpen ? "x" : "list"} size={16} />
					</Button>
				</div>
			</div>

			{mobileOpen && (
				<div
					style={{
						position: "absolute",
						inset: "100% 0 auto 0",
						background: "var(--background)",
						borderBottom: "1px solid var(--border-subtle)",
						padding: "12px 24px 16px",
						display: "flex",
						flexDirection: "column",
						gap: 2,
					}}
				>
					{NAV_ITEMS.map((item) => (
						<a
							key={item.key}
							href={item.href}
							onClick={(e) => {
								setMobileOpen(false);
								smoothScrollNavigate(item.href, e);
							}}
							style={{
								padding: "10px 12px",
								color:
									activeKey === item.key
										? "var(--foreground)"
										: "var(--foreground-muted)",
								fontSize: 14,
								fontWeight: activeKey === item.key ? 500 : 400,
								borderRadius: "var(--control-radius-inner)",
							}}
						>
							{item.label}
						</a>
					))}
				</div>
			)}

			<style>{`
				@media (max-width: 980px) {
					.landing-nav-links { display: none !important; }
					.landing-show-sm { display: inline-flex !important; }
				}
				@media (max-width: 720px) {
					.landing-hide-md { display: none !important; }
					.landing-hide-sm { display: none !important; }
				}
			`}</style>
		</header>
	);
}

function NavItem({ item, active }: { item: NavItemDef; active?: boolean }) {
	if (item.dropdown) {
		return (
			<div className="landing-nav-dropdown" style={{ position: "relative" }}>
				<button
					type="button"
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 4,
						padding: "8px 10px",
						color: active ? "var(--foreground)" : "var(--foreground-muted)",
						borderRadius: "var(--control-radius-inner)",
						fontSize: 14,
						fontWeight: active ? 500 : 400,
						transition:
							"color var(--motion-duration-base) var(--motion-ease-standard)",
					}}
				>
					{item.label}
					<LIcon name="caret-down" size={10} />
				</button>
				<div
					className="landing-dropdown-panel"
					style={{
						position: "absolute",
						top: "100%",
						left: 0,
						paddingTop: 8,
						opacity: 0,
						pointerEvents: "none",
						transition:
							"opacity var(--motion-duration-base) var(--motion-ease-standard)",
					}}
				>
					<div
						style={{
							minWidth: 240,
							background: "var(--popover)",
							border: "1px solid var(--border-subtle)",
							borderRadius: "var(--floating-radius)",
							boxShadow: "var(--floating-shadow)",
							padding: 6,
							display: "flex",
							flexDirection: "column",
							gap: 2,
						}}
					>
						{item.dropdown.map((d) => (
							<a
								key={d.label}
								href={d.href}
								onClick={(e) => smoothScrollNavigate(d.href, e)}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 10,
									padding: "8px 10px",
									borderRadius: "var(--control-radius-inner)",
									color: "var(--foreground)",
									fontSize: 13,
									transition:
										"background-color var(--motion-duration-base) var(--motion-ease-standard)",
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.background = "var(--surface-mid)";
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.background = "transparent";
								}}
							>
								<LIcon
									name={d.icon}
									size={14}
									style={{ color: "var(--foreground-subtle)" }}
								/>
								{d.label}
							</a>
						))}
					</div>
				</div>
				<style>{`
					.landing-nav-dropdown:hover .landing-dropdown-panel { opacity: 1; pointer-events: auto; }
					.landing-nav-dropdown:hover > button { color: var(--foreground); }
				`}</style>
			</div>
		);
	}
	return (
		<a
			href={item.href}
			onClick={(e) => smoothScrollNavigate(item.href, e)}
			style={{
				position: "relative",
				padding: "8px 10px",
				color: active ? "var(--foreground)" : "var(--foreground-muted)",
				fontWeight: active ? 500 : 400,
				borderRadius: "var(--control-radius-inner)",
				fontSize: 14,
				transition:
					"color var(--motion-duration-base) var(--motion-ease-standard)",
			}}
			onMouseEnter={(e) => {
				if (!active) e.currentTarget.style.color = "var(--foreground)";
			}}
			onMouseLeave={(e) => {
				if (!active) e.currentTarget.style.color = "var(--foreground-muted)";
			}}
		>
			{item.label}
			{active && (
				<span
					aria-hidden="true"
					style={{
						position: "absolute",
						left: 10,
						right: 10,
						bottom: 2,
						height: 2,
						background: "var(--primary)",
						borderRadius: 1,
					}}
				/>
			)}
		</a>
	);
}
