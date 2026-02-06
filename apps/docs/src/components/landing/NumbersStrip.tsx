export function NumbersStrip() {
	return (
		<section className="border-y border-border/30 bg-card/20">
			<div className="w-full max-w-7xl mx-auto px-4 py-10">
				<div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
					{[
						{ value: "22+", label: "Field Types" },
						{ value: "9", label: "Dashboard Widgets" },
						{ value: "3", label: "Framework Adapters" },
						{ value: "MIT", label: "Licensed" },
					].map((stat) => (
						<div key={stat.label}>
							<div className="text-3xl md:text-4xl font-bold text-primary leading-none">
								{stat.value}
							</div>
							<div className="text-sm text-muted-foreground mt-2">
								{stat.label}
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
