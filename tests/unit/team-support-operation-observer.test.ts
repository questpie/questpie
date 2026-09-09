import { expect, test } from "bun:test";

import { createOperationObserver } from "../../fixtures/team-support-desk/tracer/browser/tracer/operation-observer";

test("the browser tracer observes only its armed UI request without consuming the application response", async () => {
	const original = Response.json({
		result: { job: { runId: "accepted-run" } },
	});
	const observer = createOperationObserver(
		async () => original,
		"https://desk.test",
	);
	let delivered: Response | undefined;
	try {
		const captured = await observer.capture(
			"mutation/ticket.addComment",
			async () => {
				await observer.fetch(
					"https://other.test/_questpie/mutation/ticket.addComment",
					{ method: "POST" },
				);
				delivered = await observer.fetch(
					"https://desk.test/_questpie/mutation/ticket.addComment",
					{ method: "POST" },
				);
			},
		);
		expect(delivered).toBe(original);
		expect(captured.response).not.toBe(original);
		expect(captured.effectKey).toBeNull();
		expect(await captured.response.json()).toEqual(await original.json());
	} finally {
		observer.dispose();
	}
});

test("a timed-out or disposed observation cannot remain armed", async () => {
	const observer = createOperationObserver(
		async () => Response.json({ result: "ok" }),
		"https://desk.test",
	);
	await expect(
		observer.capture("mutation/ticket.close", () => {}, 10),
	).rejects.toThrow("UI operation was not observed");
	const captured = await observer.capture(
		"action/notification.sendTicketSummary",
		() =>
			observer.fetch(
				"https://desk.test/_questpie/action/notification.sendTicketSummary",
				{ method: "POST", headers: { "Effect-Key": "browser%3Asummary%3A1" } },
			),
	);
	expect(captured.effectKey).toBe("browser:summary:1");
	const pending = observer.capture("mutation/ticket.close", () => {});
	observer.dispose();
	await expect(pending).rejects.toThrow("Observer disposed");
	await expect(
		observer.capture("mutation/ticket.close", () => {}),
	).rejects.toThrow("Observer disposed");
});

test("an observation failure does not replace the application's successful transport", async () => {
	const response = Response.json({ result: "ok" });
	Object.defineProperty(response, "clone", {
		value() {
			throw new Error("Observation clone failed");
		},
	});
	const observer = createOperationObserver(
		async () => response,
		"https://desk.test",
	);
	let delivered: Response | undefined;
	await expect(
		observer.capture("mutation/ticket.close", async () => {
			delivered = await observer.fetch(
				"https://desk.test/_questpie/mutation/ticket.close",
				{ method: "POST" },
			);
		}),
	).rejects.toThrow("Observation clone failed");
	expect(delivered).toBe(response);
	observer.dispose();
});
