/**
 * Header Component
 *
 * Displays the city header with logo, navigation, alert banner, and mobile menu.
 * Uses CSS variable-based branding (--primary injected per city in layout).
 */

import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import type { NavItem } from "@/questpie/server/globals";

interface HeaderProps {
	cityName: string;
	citySlug: string;
	logo?: string;
	navigation: NavItem[];
	alertEnabled?: boolean;
	alertMessage?: string;
	alertType?: "info" | "warning" | "emergency";
}

export function Header({
	cityName,
	citySlug,
	logo,
	navigation,
	alertEnabled,
	alertMessage,
	alertType = "info",
}: HeaderProps) {
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

	const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

	// Close on Escape key
	useEffect(() => {
		if (!mobileMenuOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeMobileMenu();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [mobileMenuOpen, closeMobileMenu]);

	// Prevent body scroll when mobile menu is open
	useEffect(() => {
		if (mobileMenuOpen) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [mobileMenuOpen]);

	const alertStyles = {
		info: "bg-blue-100 text-blue-900 border-blue-200",
		warning: "bg-amber-100 text-amber-900 border-amber-200",
		emergency: "bg-red-100 text-red-900 border-red-200",
	};

	function resolveHref(href: string) {
		return `/${citySlug}${href === "/" ? "" : href}`;
	}

	return (
		<header>
			{/* Alert Banner */}
			{alertEnabled && alertMessage && (
				<div
					className={`border-b px-4 py-2 text-center text-sm ${alertStyles[alertType]}`}
				>
					{alertMessage}
				</div>
			)}

			{/* Main Header */}
			<div className="border-b">
				<div className="container mx-auto px-4 py-4">
					<div className="flex items-center justify-between">
						{/* Logo */}
						<Link
							to="/$citySlug"
							params={{ citySlug }}
							className="flex items-center gap-3"
						>
							{logo ? (
								<img
									src={logo}
									alt={`${cityName} logo`}
									className="h-12 w-auto"
								/>
							) : (
								<div className="bg-primary text-primary-foreground flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold">
									{cityName.charAt(0)}
								</div>
							)}
							<div>
								<h1 className="text-xl font-bold">{cityName}</h1>
								<p className="text-muted-foreground text-sm">City Council</p>
							</div>
						</Link>

						{/* Desktop Navigation */}
						<nav className="hidden items-center gap-6 md:flex">
							{navigation.map((item) =>
								item.isExternal ? (
									<a
										key={item.href}
										href={item.href}
										target="_blank"
										rel="noopener noreferrer"
										className="hover:text-primary text-sm font-medium transition-colors"
									>
										{item.label}
									</a>
								) : (
									<Link
										key={item.href}
										to={resolveHref(item.href)}
										className="hover:text-primary text-sm font-medium transition-colors"
									>
										{item.label}
									</Link>
								),
							)}
						</nav>

						{/* Mobile Menu Button */}
						<button
							type="button"
							className="p-2 md:hidden"
							aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
							onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
						>
							{mobileMenuOpen ? (
								<svg
									className="h-6 w-6"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							) : (
								<svg
									className="h-6 w-6"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M4 6h16M4 12h16M4 18h16"
									/>
								</svg>
							)}
						</button>
					</div>
				</div>
			</div>

			{/* Mobile Menu Overlay */}
			{mobileMenuOpen && (
				<div
					className="fixed inset-0 z-40 bg-black/50 md:hidden"
					onClick={closeMobileMenu}
					onKeyDown={(e) => e.key === "Escape" && closeMobileMenu()}
				/>
			)}

			{/* Mobile Menu Panel */}
			<div
				className={`bg-background fixed top-0 right-0 z-50 h-full w-72 transform shadow-xl transition-transform duration-300 ease-in-out md:hidden ${
					mobileMenuOpen ? "translate-x-0" : "translate-x-full"
				}`}
			>
				<div className="flex items-center justify-between border-b p-4">
					<span className="font-semibold">{cityName}</span>
					<button
						type="button"
						className="p-2"
						aria-label="Close menu"
						onClick={closeMobileMenu}
					>
						<svg
							className="h-5 w-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>
				<nav className="space-y-1 p-4">
					{navigation.map((item) =>
						item.isExternal ? (
							<a
								key={item.href}
								href={item.href}
								target="_blank"
								rel="noopener noreferrer"
								className="hover:bg-muted block rounded-md px-3 py-2 text-sm font-medium transition-colors"
								onClick={closeMobileMenu}
							>
								{item.label}
							</a>
						) : (
							<Link
								key={item.href}
								to={resolveHref(item.href)}
								className="hover:bg-muted block rounded-md px-3 py-2 text-sm font-medium transition-colors"
								onClick={closeMobileMenu}
							>
								{item.label}
							</Link>
						),
					)}
				</nav>
			</div>
		</header>
	);
}
