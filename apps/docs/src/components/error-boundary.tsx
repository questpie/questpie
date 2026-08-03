/* The router had no error component at all, so an exception fell through to
 * TanStack's own overlay. That is a developer tool, not a page a reader should
 * ever be shown.
 */
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";

import { ErrorAction, ErrorPage } from "@/components/error-page";

export function ErrorBoundary({ error }: ErrorComponentProps) {
	const router = useRouter();

	return (
		<ErrorPage
			action={
				<ErrorAction onClick={() => router.invalidate()}>Try again</ErrorAction>
			}
			status="500"
			title="This page failed to load."
		>
			<p>
				The error is ours, not yours. Reloading sometimes clears it, and the
				links below always work.
			</p>
			{/* The message only in development. In production it can carry a query,
			    a path or a connection string, and the reader can do nothing with it
			    either way. */}
			{import.meta.env.DEV && error?.message ? (
				<pre className="mt-4 overflow-x-auto rounded-[var(--control-radius-inner,0.5rem)] bg-[var(--card)] p-4 text-xs text-[var(--foreground)]">
					{error.message}
				</pre>
			) : null}
		</ErrorPage>
	);
}
