/* The shell both error pages share.
 *
 * Not `HomeLayout`. That layout puts the site nav in normal document flow, so
 * the `justify-center` an error page needs dragged the nav into the middle of
 * the viewport with it. There is no sidebar and no page tree to render here.
 *
 * `.qp-mesh` is the canon's own host class. It paints the brand's background
 * through its own `::before`, and mesh.css carries a light and a dark
 * composition, so this works under both. Marketing gets the same atmosphere
 * from `.qp-mesh-page` in __root, which only covers marketing paths, and an
 * error can land anywhere.
 *
 * Canon tokens throughout, no `fd-` prefixes. Flipping a reader from light to
 * dark because they mistyped a URL would be worse than the layout bug this
 * replaces.
 */
import { Link } from "@tanstack/react-router";

import { Logo } from "@/components/Logo";

/** Where someone who landed here actually wants to go. */
const WAYS_OUT = [
	{
		label: "QUESTPIE v4",
		href: "/docs/v4",
		note: "Read the current product specification.",
	},
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
		<div className="qp-mesh flex min-h-screen items-center justify-center px-6 py-16 text-[var(--foreground)]">
			<main className="w-full max-w-2xl text-center">
				<Link
					aria-label="QUESTPIE home"
					className="inline-block opacity-90 transition-opacity hover:opacity-100"
					to="/"
				>
					<Logo className="mx-auto h-7 w-auto" />
				</Link>

				<p className="mt-14 font-mono text-sm tracking-[0.2em] text-[var(--primary-text)]">
					{status}
				</p>
				<h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
					{title}
				</h1>
				{children ? (
					<div className="mx-auto mt-5 max-w-md text-[var(--foreground-muted)]">
						{children}
					</div>
				) : null}
				{action ? <div className="mt-8">{action}</div> : null}

				<nav className="mx-auto mt-14 max-w-sm text-start">
					{WAYS_OUT.map((way) => (
						<Link
							className="group rounded-[var(--surface-radius,0.75rem)] border border-[var(--border-subtle)] bg-[var(--card)] p-4 no-underline transition-colors hover:border-[var(--primary)]"
							key={way.href}
							to={way.href}
						>
							<span className="block font-medium text-[var(--foreground)] group-hover:text-[var(--primary-text)]">
								{way.label}
							</span>
							<span className="mt-1 block text-sm text-[var(--foreground-muted)]">
								{way.note}
							</span>
						</Link>
					))}
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
