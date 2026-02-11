/**
 * Header Component
 *
 * Displays the city header with logo, navigation, and alert banner.
 */

import { Link } from "@tanstack/react-router";
import type { NavItem } from "@/questpie/server/globals";

interface HeaderProps {
	cityName: string;
	logo?: string;
	navigation: NavItem[];
	primaryColour?: string;
	alertEnabled?: boolean;
	alertMessage?: string;
	alertType?: "info" | "warning" | "emergency";
}

export function Header({
	cityName,
	logo,
	navigation,
	primaryColour,
	alertEnabled,
	alertMessage,
	alertType = "info",
}: HeaderProps) {
	const alertStyles = {
		info: "bg-blue-100 text-blue-900 border-blue-200",
		warning: "bg-amber-100 text-amber-900 border-amber-200",
		emergency: "bg-red-100 text-red-900 border-red-200",
	};

	return (
		<header>
			{/* Alert Banner */}
			{alertEnabled && alertMessage && (
				<div
					className={`px-4 py-2 text-center text-sm border-b ${alertStyles[alertType]}`}
				>
					{alertMessage}
				</div>
			)}

			{/* Main Header */}
			<div
				className="border-b"
				style={
					primaryColour ? { borderColor: `${primaryColour}20` } : undefined
				}
			>
				<div className="container mx-auto px-4 py-4">
					<div className="flex items-center justify-between">
						{/* Logo */}
						<Link to="." className="flex items-center gap-3">
							{logo ? (
								<img
									src={logo}
									alt={`${cityName} logo`}
									className="h-12 w-auto"
								/>
							) : (
								<div
									className="h-12 w-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
									style={{ backgroundColor: primaryColour || "#1e40af" }}
								>
									{cityName.charAt(0)}
								</div>
							)}
							<div>
								<h1 className="text-xl font-bold">{cityName}</h1>
								<p className="text-sm text-muted-foreground">City Council</p>
							</div>
						</Link>

						{/* Navigation */}
						<nav className="hidden md:flex items-center gap-6">
							{navigation.map((item) => (
								<Link
									key={item.href}
									to={item.href}
									className="text-sm font-medium hover:text-primary transition-colors"
								>
									{item.label}
								</Link>
							))}
						</nav>

						{/* Mobile Menu Button */}
						<button
							type="button"
							className="md:hidden p-2"
							aria-label="Open navigation menu"
							title="Open navigation menu"
						>
							<svg
								className="w-6 h-6"
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
						</button>
					</div>
				</div>
			</div>
		</header>
	);
}
