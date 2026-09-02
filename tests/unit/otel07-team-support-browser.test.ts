import { expect, test } from "bun:test";

import { runFirefoxJourney } from "../../fixtures/team-support-desk/tracer/browser/tracer/journey";

test("reports the exact Job accepted by the browser Mutation", async () => {
	const reports: Array<Readonly<Record<string, unknown>>> = [];
	const originalDocument = globalThis.document;
	const originalFetch = globalThis.fetch;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: {
			querySelector: () => ({
				textContent: "Live ticket view is current. browser comment",
			}),
		},
	});
	globalThis.fetch = async (_input, init) => {
		reports.push(
			JSON.parse(String(init?.body)) as Readonly<Record<string, unknown>>,
		);
		return new Response(null, { status: 204 });
	};
	const ticket = Object.freeze({
		id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7131",
		reference: "SUP-7131",
		status: "open",
		teamId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7121",
		updatedAt: new Date("2026-09-01T12:00:01.000Z"),
	});
	try {
		await runFirefoxJourney({
			commentBody: "browser comment",
			desk: {
				actions: {
					"notification.sendTicketSummary": async () => ({
						effectId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7191",
						providerReceipt: "receiver:1",
						ticketReference: ticket.reference,
					}),
				},
				mutations: {
					"ticket.addComment": async () => ({
						comment: {},
						job: {
							resource: "job:ticket.slaFollowUp",
							runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7181",
						},
					}),
					"ticket.close": async () => ticket,
					"ticket.create": async () => {
						throw Object.freeze({ code: "INVALID_TICKET", status: 422 });
					},
					"ticket.reopen": async () => ticket,
				},
			} as never,
			executeTicketOperation: async (_label, operation) => operation(),
			loadFilteredQueue: async () => undefined,
			reference: ticket.reference,
			role: "agent",
			searchTicket: async () =>
				Object.freeze({
					...ticket,
					updatedAt: new Date("2026-09-01T12:00:00.000Z"),
				}) as never,
			selectFilters: () => undefined,
		});
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: originalDocument,
		});
	}

	expect(reports.at(-1)).toMatchObject({
		jobRunId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7181",
		phase: "firefox-complete",
	});
});
