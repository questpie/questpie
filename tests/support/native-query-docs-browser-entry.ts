// Copied next to the extracted public tutorial; no implementation instrumentation.
import { mountSupportTicket } from "./web/support-screen";

const id = "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131";
const host = document.querySelector<HTMLElement>("main")!;
let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
	assertions++;
	if (!condition) throw new Error(message);
}
async function until(predicate: () => boolean, label: string) {
	const deadline = performance.now() + 8_000;
	while (!predicate()) {
		if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
async function control(command: string) {
	const response = await fetch("/__control", {
		method: "POST",
		body: JSON.stringify({ command }),
		headers: { "content-type": "application/json" },
	});
	check(response.ok, `Control rejected ${command}`);
}
async function submit(summary: string) {
	const input = host.querySelector<HTMLInputElement>('input[name="summary"]');
	check(input !== null, "Native form input missing");
	input.value = summary;
	host.querySelector("form")!.requestSubmit();
	await until(
		() => host.textContent!.includes(`Saving “${summary}”`),
		"pending intent",
	);
	check(
		host.querySelector("button")!.disabled,
		"Pending command must disable submit",
	);
}
let cleanup: (() => Promise<void>) | undefined;
let unexpectedBrowserError = false;
window.addEventListener("error", () => {
	unexpectedBrowserError = true;
});
window.addEventListener("unhandledrejection", () => {
	unexpectedBrowserError = true;
});
try {
	cleanup = mountSupportTicket(host, { tenantId: id }, id);
	await until(
		() => host.textContent!.includes("Loading ticket…"),
		"loading state",
	);
	check(host.querySelector("h1") === null, "Pending Query exposed a result");
	await control("initial");
	await until(
		() => host.querySelector("h1")?.textContent === "Original support ticket",
		"initial authorized ticket",
	);
	check(host.querySelectorAll("li").length === 1, "Selected comment missing");
	check(
		host.querySelector("li")!.textContent!.includes("Visible comment"),
		"Comment body lost",
	);
	check(
		host
			.querySelector("li")!
			.textContent!.includes(
				new Date("2026-09-08T10:00:00.000Z").toLocaleString(),
			),
		"Timestamp did not decode as a Date",
	);
	await submit("Renamed support ticket");
	check(
		host.querySelector("h1")!.textContent === "Original support ticket",
		"Pending intent replaced authorized data",
	);
	await control("commit");
	await until(
		() =>
			host.querySelector("h1")?.textContent === "Renamed support ticket" &&
			!host.textContent!.includes("Saving “"),
		"committed replacement",
	);
	check(
		host.querySelectorAll("li").length === 1,
		"Replacement lost inverse child result",
	);
	await submit("Rejected intent");
	await control("reject");
	await until(
		() => host.textContent!.includes("This ticket is no longer available."),
		"declared error narrowing",
	);
	check(
		host.querySelector("h1")!.textContent === "Renamed support ticket",
		"Declared failure rolled back authorized data",
	);
	check(!host.textContent!.includes("Saving “"), "Rejected intent retained");
	await submit("Unknown outcome");
	await control("unknown");
	await until(
		() => host.textContent!.includes("The rename could not be confirmed."),
		"unknown error branch",
	);
	check(!host.textContent!.includes("Saving “"), "Unknown intent retained");
	await submit("Hidden intent");
	await control("hide");
	await until(
		() => host.textContent === "Ticket unavailable.",
		"base disappearance hides all copies",
	);
	check(host.querySelector("h1") === null, "Unauthorized heading retained");
	check(
		!host.textContent!.includes("Hidden intent"),
		"Pending intent survived hidden base",
	);
	await control("commit");
	await control("visible");
	await until(() => host.querySelector("h1") !== null, "fresh authorized base");
	await submit("Retired intent");
	await control("deny");
	await until(
		() => host.textContent === "Ticket unavailable.",
		"terminal failure clears base",
	);
	const closing = cleanup();
	check(
		cleanup() === closing,
		"Repeated cleanup did not share the in-flight Promise",
	);
	await closing;
	cleanup = undefined;
	check(host.textContent === "", "Cleanup retained private DOM");
	await control("commit");
	await control("next-credential");
	cleanup = mountSupportTicket(host, { tenantId: id }, id);
	await until(
		() => host.querySelector("h1")?.textContent === "Next credential ticket",
		"fresh owner for equal Context",
	);
	check(
		!host.textContent!.includes("Retired intent"),
		"Late retired result leaked into next owner",
	);
	check(
		!host.textContent!.includes("Saving “"),
		"Old Mutation state leaked into next owner",
	);
	await cleanup();
	cleanup = undefined;
	check(host.textContent === "", "Final cleanup retained DOM");
	check(!unexpectedBrowserError, "Unexpected browser or React error");
	await fetch("/__report", {
		method: "POST",
		body: JSON.stringify({ ok: true, assertions }),
	});
} catch (error) {
	await fetch("/__report", {
		method: "POST",
		body: JSON.stringify({
			ok: false,
			error: error instanceof Error ? error.message : "Unknown browser failure",
			assertions,
		}),
	});
} finally {
	await cleanup?.();
}
