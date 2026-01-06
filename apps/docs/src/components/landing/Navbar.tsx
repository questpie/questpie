import { Link } from "@tanstack/react-router";
import { Github, Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Navbar() {
	const [isScrolled, setIsScrolled] = useState(false);
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

	useEffect(() => {
		const handleScroll = () => {
			setIsScrolled(window.scrollY > 20);
		};
		window.addEventListener("scroll", handleScroll);
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	return (
		<header
			className={cn(
				"fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b border-transparent",
				isScrolled
					? "bg-background/60 backdrop-blur-xl border-border/50 py-3"
					: "bg-transparent py-5",
			)}
		>
			<div className="w-full max-w-7xl mx-auto px-4">
				<nav className="flex items-center justify-between">
					{/* Logo */}
					<Link to="/" className="flex items-center gap-2 group">
						{/* Symbol for mobile */}
						<img
							src="/symbol/Q-symbol-dark-pink.svg"
							alt="Questpie Symbol"
							className="h-8 w-auto sm:hidden dark:hidden"
						/>
						<img
							src="/symbol/Q-symbol-white-pink.svg"
							alt="Questpie Symbol"
							className="h-8 w-auto sm:hidden hidden dark:block"
						/>
						{/* Full logo for desktop */}
						<img
							src="/logo/Questpie-dark-pink.svg"
							alt="Questpie Logo"
							className="h-6 w-auto hidden sm:block dark:hidden"
						/>
						<img
							src="/logo/Questpie-white-pink.svg"
							alt="Questpie Logo"
							className="h-6 w-auto hidden sm:dark:block"
						/>
					</Link>

					{/* Desktop Nav */}
					<div className="hidden md:flex items-center gap-8">
						<Link
							to="/docs/$"
							className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
						>
							Documentation
						</Link>
						<a
							href="#features"
							className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
						>
							Features
						</a>
						<a
							href="#examples"
							className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
						>
							Examples
						</a>
						<div className="w-px h-4 bg-border" />
						<div className="flex items-center gap-2">
							<ThemeToggle />
							<a
								href="https://github.com/questpie/questpie-cms"
								target="_blank"
								rel="noreferrer"
								className="text-muted-foreground hover:text-foreground transition-colors"
							>
								<Github className="w-5 h-5" />
							</a>
							<Link
								to="/docs/$"
								className="inline-flex items-center justify-center h-9 px-4 text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all uppercase tracking-wider font-mono"
							>
								Get Started
							</Link>
						</div>
					</div>

					{/* Mobile Menu Toggle */}
					<button
						className="md:hidden p-2 text-muted-foreground hover:text-foreground"
						onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
					>
						{isMobileMenuOpen ? (
							<X className="w-6 h-6" />
						) : (
							<Menu className="w-6 h-6" />
						)}
					</button>
				</nav>

				{/* Mobile Nav */}
				{isMobileMenuOpen && (
					<div className="absolute top-full left-0 right-0 bg-background/95 backdrop-blur-xl border-b border-border p-4 md:hidden animate-in slide-in-from-top-2">
						<div className="flex flex-col gap-4">
							<Link
								to="/docs/$"
								className="text-sm font-medium text-muted-foreground hover:text-primary py-2"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								Documentation
							</Link>
							<a
								href="#features"
								className="text-sm font-medium text-muted-foreground hover:text-primary py-2"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								Features
							</a>
							<a
								href="#examples"
								className="text-sm font-medium text-muted-foreground hover:text-primary py-2"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								Examples
							</a>
							<div className="h-px bg-border my-2" />
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-4">
									<ThemeToggle />
									<a
										href="https://github.com/questpie/questpie-cms"
										target="_blank"
										rel="noreferrer"
										className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
									>
										<Github className="w-5 h-5" />
										<span className="text-sm">GitHub</span>
									</a>
								</div>
								<Link
									to="/docs/$"
									className="text-xs font-medium bg-primary/10 text-primary border border-primary/20 px-4 py-2 uppercase tracking-wider font-mono"
									onClick={() => setIsMobileMenuOpen(false)}
								>
									Get Started
								</Link>
							</div>
						</div>
					</div>
				)}
			</div>
		</header>
	);
}
