import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export function CallToAction() {
	return (
		<section className="py-24 border-t border-border/30 relative overflow-hidden">
			<div className="absolute top-1/2 left-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[180px] -translate-x-1/2 -translate-y-1/2" />

			<div className="w-full max-w-3xl mx-auto px-4 text-center relative z-10">
				<h2 className="text-3xl md:text-4xl font-bold mb-4">
					Ready to Build?
				</h2>
				<p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
					Define your first collection in 5 minutes. Get a REST API, admin UI, and type-safe client SDK — all from one TypeScript file.
				</p>

				<div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
					<Link
						to="/docs/$"
						className="group inline-flex items-center justify-center h-12 px-8 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
					>
						Get Started
						<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
					</Link>
					<a
						href="https://github.com/questpie/questpie-cms"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center justify-center h-12 px-8 text-sm font-medium border border-border hover:bg-muted transition-colors"
					>
						View on GitHub
					</a>
				</div>

				<div className="inline-flex items-center gap-3 px-4 py-2.5 bg-card border border-border font-mono text-sm text-muted-foreground">
					<span className="text-primary select-none">$</span>
					<span>bun add questpie @questpie/admin</span>
				</div>
			</div>
		</section>
	);
}
