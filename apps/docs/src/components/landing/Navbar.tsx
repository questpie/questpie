import { GithubLogo, List, X } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

const navItems = [
	{ label: "Docs", href: "/docs/$", type: "internal" as const },
	{
		label: "Examples",
		href: "https://github.com/questpie/questpie/tree/main/examples",
		type: "external" as const,
	},
	{
		label: "Guides",
		href: "/docs/$",
		type: "internal" as const,
		params: { _splat: "guides" },
	},
];

export function Navbar() {
	const [isScrolled, setIsScrolled] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

	useEffect(() => {
		const handleScroll = () => {
			setIsScrolled(window.scrollY > 8);
		};
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-50 border-b border-transparent transition-all duration-300",
				isScrolled
					? "bg-background/70 backdrop-blur-xl border-border/60 py-3"
					: "bg-transparent py-5",
			)}
		>
			<div className="mx-auto w-full max-w-7xl px-4">
				<nav className="flex items-center justify-between">
					<Link to="/" className="group flex items-center gap-2">
						<img
							src="/symbol/Q-symbol-dark-pink.svg"
							alt="QUESTPIE"
							className="block h-8 w-auto dark:hidden sm:hidden"
						/>
						<img
							src="/symbol/Q-symbol-white-pink.svg"
							alt="QUESTPIE"
							className="hidden h-8 w-auto dark:block dark:sm:hidden"
						/>
						<img
							src="/logo/Questpie-dark-pink.svg"
							alt="QUESTPIE"
							className="hidden h-6 w-auto dark:hidden sm:block"
						/>
						<img
							src="/logo/Questpie-white-pink.svg"
							alt="QUESTPIE"
							className="hidden h-6 w-auto dark:sm:block"
						/>
					</Link>

					<div className="hidden items-center gap-7 md:flex">
						{navItems.map((item) =>
							item.type === "internal" ? (
								<Link
									key={item.label}
									to={item.href}
									params={item.params as never}
									className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
								>
									{item.label}
								</Link>
							) : (
								<a
									key={item.label}
									href={item.href}
									target="_blank"
									rel="noreferrer"
									className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
								>
									{item.label}
								</a>
							),
						)}

						<a
							href="https://github.com/questpie/questpie"
							target="_blank"
							rel="noreferrer"
							aria-label="QUESTPIE on GitHub"
							className="text-muted-foreground transition-colors hover:text-foreground"
						>
							<GithubLogo className="h-5 w-5" aria-hidden="true" />
						</a>
						<ThemeToggle />
						<Link
							to="/docs/$"
							params={{ _splat: "getting-started/quickstart" }}
							className="inline-flex h-9 items-center justify-center border border-primary/30 bg-primary/10 px-4 font-mono text-[11px] font-medium uppercase tracking-wider text-primary transition-all hover:bg-primary/20"
						>
							Build Platform
						</Link>
					</div>

					<button
						type="button"
						className="p-2 text-muted-foreground transition-colors hover:text-foreground md:hidden"
						onClick={() => setIsMobileMenuOpen((v) => !v)}
						aria-label="Toggle navigation"
					>
						{isMobileMenuOpen ? (
							<X className="h-6 w-6" aria-hidden="true" />
						) : (
							<List className="h-6 w-6" aria-hidden="true" />
						)}
					</button>
				</nav>

				{isMobileMenuOpen && (
					<div className="animate-in slide-in-from-top-2 absolute left-0 right-0 top-full border-b border-border bg-background/95 p-4 backdrop-blur-xl duration-300 md:hidden">
						<div className="flex flex-col gap-4">
							<Link
								to="/docs/$"
								className="py-1 text-sm font-medium text-muted-foreground"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								Docs
							</Link>
							<Link
								to="/docs/$"
								params={{ _splat: "guides" }}
								className="py-1 text-sm font-medium text-muted-foreground"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								Guides
							</Link>
							<a
								href="https://github.com/questpie/questpie/tree/main/examples"
								target="_blank"
								rel="noreferrer"
								className="py-1 text-sm font-medium text-muted-foreground"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								Examples
							</a>
							<div className="my-1 h-px bg-border" />
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-4">
									<ThemeToggle />
									<a
										href="https://github.com/questpie/questpie"
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-2 text-sm text-muted-foreground"
									>
										<GithubLogo className="h-5 w-5" aria-hidden="true" />
										GitHub
									</a>
								</div>
								<Link
									to="/docs/$"
									params={{ _splat: "getting-started/quickstart" }}
									className="inline-flex h-8 items-center justify-center border border-primary/30 bg-primary/10 px-3 font-mono text-[11px] uppercase tracking-wider text-primary"
									onClick={() => setIsMobileMenuOpen(false)}
								>
									Build
								</Link>
							</div>
						</div>
					</div>
				)}
			</div>
		</header>
	);
}
