import { Link } from "@tanstack/react-router";
import { Github } from "lucide-react";

export function Footer() {
	return (
		<footer className="border-t border-border bg-card/20 py-16">
			<div className="w-full max-w-7xl mx-auto px-4">
				<div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
					<div className="space-y-4">
						<h4 className="font-mono text-xs uppercase tracking-widest text-foreground font-bold">
							Product
						</h4>
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li>
								<Link
									to="/docs/$"
									className="hover:text-primary transition-colors"
								>
									Documentation
								</Link>
							</li>
							<li>
								<a
									href="/#features"
									className="hover:text-primary transition-colors"
								>
									Features
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie-cms/discussions"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Roadmap
								</a>
							</li>
						</ul>
					</div>
					<div className="space-y-4">
						<h4 className="font-mono text-xs uppercase tracking-widest text-foreground font-bold">
							Resources
						</h4>
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li>
								<a
									href="https://github.com/questpie/questpie-cms/tree/main/examples"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Examples
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie-cms/releases"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Changelog
								</a>
							</li>
							<li>
								<Link
									to="/docs/$"
									className="hover:text-primary transition-colors"
								>
									Getting Started
								</Link>
							</li>
						</ul>
					</div>
					<div className="space-y-4">
						<h4 className="font-mono text-xs uppercase tracking-widest text-foreground font-bold">
							Native Libraries
						</h4>
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li>
								<a
									href="https://orm.drizzle.team/"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Drizzle ORM
								</a>
							</li>
							<li>
								<a
									href="https://www.better-auth.com/"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Better Auth
								</a>
							</li>
							<li>
								<a
									href="https://github.com/timgit/pg-boss"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									pg-boss
								</a>
							</li>
							<li>
								<a
									href="https://flydrive.dev/"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Flydrive
								</a>
							</li>
						</ul>
					</div>
					<div className="space-y-4">
						<h4 className="font-mono text-xs uppercase tracking-widest text-foreground font-bold">
							Community
						</h4>
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li>
								<a
									href="https://github.com/questpie/questpie-cms"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									GitHub
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie-cms/discussions"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Discussions
								</a>
							</li>
							<li>
								<a
									href="https://github.com/questpie/questpie-cms/issues"
									target="_blank"
									rel="noopener noreferrer"
									className="hover:text-primary transition-colors"
								>
									Issues
								</a>
							</li>
						</ul>
					</div>
				</div>

				<div className="flex flex-col gap-6 pt-8 border-t border-border/50">
					<div className="flex flex-col md:flex-row justify-between items-center gap-4">
						<div className="flex flex-col items-center md:items-start gap-2">
							<p className="text-xs text-muted-foreground">
								© {new Date().getFullYear()} QUESTPIE s.r.o. Released under MIT
								License.
							</p>
							<p className="text-xs text-muted-foreground flex items-center gap-1.5">
								Made with <span className="text-red-500 animate-pulse">♥</span>{" "}
								in Slovakia <span className="inline-block">🇸🇰</span>
							</p>
						</div>
						<div className="flex items-center gap-4">
							<a
								href="https://github.com/questpie/questpie-cms"
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-foreground transition-colors"
							>
								<Github className="h-4 w-4" />
							</a>
						</div>
					</div>
				</div>
			</div>
		</footer>
	);
}
