import { LIcon, Wordmark } from "./primitives";
import { smoothScrollNavigate } from "./shared-nav";

const FOOTER_USE_CASES: Array<[string, string]> = [
	["Restaurants & cafés", "/#uc-restaurants"],
	["E-commerce & retail", "/#uc-ecommerce"],
	["Agencies & studios", "/#uc-agencies"],
	["Real estate", "/#uc-realestate"],
	["Portfolios", "/#uc-portfolios"],
];

export function SharedFooter() {
	const cols: Array<{ title: string; items: Array<[string, string]> }> = [
		{
			title: "Product",
			items: [
				["Framework", "/#framework"],
				["Cloud", "/cloud"],
				["Autopilot", "/autopilot"],
				["Pricing", "/#pricing"],
				["Changelog", "#"],
			],
		},
		{ title: "Use cases", items: FOOTER_USE_CASES },
		{
			title: "Resources",
			items: [
				["Documentation", "/docs"],
				["Examples", "https://github.com/questpie/questpie/tree/main/examples"],
				["Templates", "#"],
				["MCP reference", "#"],
				["RFCs", "#"],
			],
		},
		{
			title: "Company",
			items: [
				["GitHub", "https://github.com/questpie/questpie"],
				["Blog", "#"],
				["Brand kit", "#"],
				["Status", "#"],
				["Contact", "#contact"],
			],
		},
	];
	return (
		<footer
			style={{
				borderTop: "1px solid var(--border-subtle)",
				padding: "56px 24px 32px",
				background: "var(--surface)",
			}}
		>
			<div style={{ maxWidth: 1120, margin: "0 auto" }}>
				<div
					className="landing-footer-grid"
					style={{
						display: "grid",
						gridTemplateColumns:
							"minmax(0, 1.2fr) repeat(4, minmax(0, 1fr))",
						gap: 28,
						marginBottom: 36,
					}}
				>
					<div>
						<Wordmark size={22} />
						<p
							className="landing-balance"
							style={{
								marginTop: 14,
								fontSize: 13,
								color: "var(--foreground-muted)",
								lineHeight: 1.6,
								maxWidth: 260,
							}}
						>
							One open-source platform for your site, your operations and your
							infrastructure. Self-host free, or let Cloud run it for you.
						</p>
						<div style={{ marginTop: 18, display: "flex", gap: 8 }}>
							<a
								className="landing-btn landing-btn-secondary landing-btn-sm"
								href="https://github.com/questpie/questpie"
								target="_blank"
								rel="noreferrer"
								style={{ gap: 6 }}
							>
								<LIcon name="github-logo" size={13} />
								Star on GitHub
								<LIcon name="star" size={11} />
							</a>
							<a
								className="landing-btn landing-btn-ghost landing-btn-sm"
								href="#"
							>
								<LIcon name="chat-circle" size={13} />
								Discord
							</a>
						</div>
					</div>

					{cols.map((c) => (
						<div key={c.title}>
							<div className="landing-eyebrow" style={{ marginBottom: 12 }}>
								{c.title}
							</div>
							<ul
								style={{
									listStyle: "none",
									padding: 0,
									margin: 0,
									display: "flex",
									flexDirection: "column",
									gap: 8,
								}}
							>
								{c.items.map(([label, href]) => (
									<li key={label}>
										<a
											href={href}
											onClick={(e) => smoothScrollNavigate(href, e)}
											style={{
												fontSize: 13,
												color: "var(--foreground-muted)",
												transition:
													"color var(--motion-duration-base) var(--motion-ease-standard)",
											}}
											onMouseEnter={(e) => {
												e.currentTarget.style.color = "var(--foreground)";
											}}
											onMouseLeave={(e) => {
												e.currentTarget.style.color =
													"var(--foreground-muted)";
											}}
										>
											{label}
										</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>

				<div
					style={{
						borderTop: "1px solid var(--border-subtle)",
						paddingTop: 18,
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						flexWrap: "wrap",
						gap: 12,
						fontSize: 12,
						color: "var(--foreground-subtle)",
					}}
				>
					<span className="landing-mono">
						© 2026 QUESTPIE · MIT · Made in Bratislava
					</span>
					<span style={{ display: "inline-flex", gap: 14 }}>
						<a href="#" style={{ color: "inherit" }}>
							Privacy
						</a>
						<a href="#" style={{ color: "inherit" }}>
							Terms
						</a>
						<a href="#" style={{ color: "inherit" }}>
							Security
						</a>
						<a href="#" style={{ color: "inherit" }}>
							Status
						</a>
					</span>
				</div>
			</div>

			<style>{`
				@media (max-width: 880px) { .landing-footer-grid { grid-template-columns: 1fr 1fr !important; } }
				@media (max-width: 540px) { .landing-footer-grid { grid-template-columns: 1fr !important; } }
			`}</style>
		</footer>
	);
}
