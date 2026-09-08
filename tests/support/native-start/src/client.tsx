import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

function reportError() {
	void fetch("/__report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ phase: "browser-error" }),
	});
}
window.addEventListener("error", reportError);
window.addEventListener("unhandledrejection", reportError);
startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
		{ onRecoverableError: reportError },
	);
});
