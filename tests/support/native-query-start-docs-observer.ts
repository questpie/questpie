// Read-only HTML observer, served ahead of the unchanged public client entry.
import type { GeneratedClientScope } from "#questpie/client";
let browserFailure = false;
window.addEventListener("error", () => {
	browserFailure = true;
});
window.addEventListener("unhandledrejection", () => {
	browserFailure = true;
});
const originalError = console.error;
console.error = (...args: unknown[]) => {
	browserFailure = true;
	originalError(...args);
};
type Page = Awaited<
	ReturnType<GeneratedClientScope["queries"]["tickets.detailPage"]>
>;
const time: Page["nodes"][number]["comments"][number]["createdAt"] = new Date(
	"2026-09-08T10:00:00.000Z",
);
async function until(predicate: () => boolean) {
	const deadline = performance.now() + 15_000;
	while (!predicate()) {
		if (performance.now() > deadline)
			throw new Error("Tutorial browser condition timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
async function observe() {
	const path = location.pathname;
	await until(() => document.readyState === "complete");
	if (path === "/pages") {
		await until(
			() =>
				document.querySelector("h1")?.textContent ===
				"Server-rendered support ticket",
		);
		await new Promise((resolve) => setTimeout(resolve, 500));
		if (!document.querySelector<HTMLButtonElement>("button")?.disabled)
			throw new Error("Finite root continuation was not exhausted");
	} else {
		await until(
			() => document.querySelector("h1")?.textContent === "Live support ticket",
		);
		if (
			document.querySelector("time")?.getAttribute("datetime") !==
			time.toISOString()
		)
			throw new Error("Hydrated/live Date decoding failed");
		if (path === "/test-cleanup") {
			document.querySelector<HTMLButtonElement>("#retire")!.click();
			await until(
				() =>
					document.querySelector("#retired")?.textContent === "Owner retired",
			);
			if (document.querySelector("h1"))
				throw new Error("Retirement retained the credential subtree");
		}
	}
	if (browserFailure)
		throw new Error("Tutorial reported a hydration or browser error");
	await fetch("/__report", {
		method: "POST",
		body: JSON.stringify({ ok: true, path }),
	});
}
void observe().catch(() =>
	fetch("/__report", {
		method: "POST",
		body: JSON.stringify({ ok: false, path: location.pathname }),
	}),
);
