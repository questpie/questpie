import type { QueryClient } from "@tanstack/react-query";

/** Test-only server clock skew; never part of adapter identity or ordering. */
export function skewServerSnapshots(cache: QueryClient) {
	const seen = new WeakSet<object>();
	cache.getQueryCache().subscribe((event) => {
		if (
			event.type !== "updated" ||
			event.action.type !== "success" ||
			seen.has(event.query)
		)
			return;
		seen.add(event.query);
		cache.setQueryData(event.query.queryKey, event.query.state.data, {
			updatedAt: Date.now() + 60_000,
		});
	});
}

/** Public browser lifecycle only; no private Router bootstrap inspection. */
export function firstDocumentReady(setup: Promise<void>, onReady: () => void) {
	const loaded =
		document.readyState === "complete"
			? Promise.resolve()
			: new Promise<void>((resolve) =>
					window.addEventListener("load", () => resolve(), { once: true }),
				);
	return Promise.all([setup, loaded])
		.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
		.then(onReady);
}

export function report(phase: string, detail: object) {
	return fetch("/__report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ phase, ...detail }),
	});
}
