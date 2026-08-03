/* The shell both error pages share.
 *
 * Not `HomeLayout`. That layout puts the site nav in normal document flow, so
 * the `justify-center` the old 404 needed to centre its text dragged the nav
 * into the middle of the viewport with it. An error page has no sidebar and no
 * page tree to render, so it does not need a docs layout at all.
 *
 * Canon tokens throughout, no `fd-` prefixes, because this renders under both
 * themes. Marketing forces dark and the docs carry both, and an error can land
 * on either. Flipping a reader from light to dark because they mistyped a URL
 * would be worse than the layout bug this replaces.
 */
import { Link } from "@tanstack/react-router";

import { Logo } from "@/components/Logo";

/** Where someone who landed here actually wants to go. */
const WAYS_OUT = [
	{
		label: "Documentation",
		href: "/docs",
		note: "Every group, from Learn on.",
	},
	{
		label: "Framework",
		href: "/framework",
		note: "One schema, the rest derived.",
	},
	{ label: "Autopilot", href: "/autopilot", note: "Agents on the team." },
];

export function ErrorPage({
	status,
	title,
	children,
	action,
}: {
	status: string;
	title: string;
	children?: React.ReactNode;
	action?: React.ReactNode;
}) {
	return (
		<div className="flex min-h-screen flex-col bg-[var(--background)] px-6 py-8 text-[var(--foreground)]">
			<Link aria-label="QUESTPIE home" className="w-fit" to="/">
				<Logo className="h-7 w-auto" />
			</Link>

			<main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-16">
				<p className="font-mono text-sm tracking-widest text-[var(--primary-text)]">
					{status}
				</p>
				<h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
				{children ? (
					<div className="mt-4 text-[var(--foreground-muted)]">{children}</div>
				) : null}
				{action ? <div className="mt-8">{action}</div> : null}

				<nav className="mt-12 border-t border-[var(--border-subtle)] pt-6">
					<ul className="flex flex-col gap-4">
						{WAYS_OUT.map((way) => (
							<li key={way.href}>
								<Link
									className="group flex items-baseline gap-3 no-underline"
									to={way.href}
								>
									<span className="font-medium text-[var(--primary-text)] group-hover:underline">
										{way.label}
									</span>
									<span className="text-sm text-[var(--foreground-muted)]">
										{way.note}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</nav>
			</main>
		</div>
	);
}

/** The one button either page needs. Coral fill, white type, AA at this size. */
export function ErrorAction({
	children,
	onClick,
}: {
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			className="rounded-[var(--control-radius-inner,0.5rem)] bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
			onClick={onClick}
			type="button"
		>
			{children}
		</button>
	);
}
