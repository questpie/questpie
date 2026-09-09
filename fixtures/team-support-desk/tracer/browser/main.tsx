import { demoAuthIdentities } from "../../src/auth/demo-identities";
import { authClient, supportSession } from "../../web/auth/client";
import { createSupportDesk } from "../../web/questpie";
import { errorMessage } from "../../web/shared/format";
import { reportFixturePhase } from "./fixture-control";
import { firefoxJourneyFromUrl, runFirefoxJourney } from "./tracer/journey";
import type { FirefoxUiCommands } from "./tracer/journey";
import { createOperationObserver } from "./tracer/operation-observer";
import { observeSlaFollowUp } from "./tracer/sla-observer";

const originalFetch = globalThis.fetch;
const observer = createOperationObserver(
	originalFetch.bind(globalThis),
	location.origin,
);
globalThis.fetch = Object.assign(observer.fetch, {
	preconnect: originalFetch.preconnect,
});

async function element<Kind extends Element>(selector: string): Promise<Kind> {
	const deadline = Date.now() + 30_000;
	do {
		const found = document.querySelector<Kind>(selector);
		if (found !== null) return found;
		await new Promise((resolve) => setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	throw new Error(`Browser tracer could not find ${selector}`);
}

async function selectReference(reference: string): Promise<void> {
	const search = await element<HTMLInputElement>("#reference-search");
	search.value = reference;
	search.form!.requestSubmit();
	const deadline = Date.now() + 30_000;
	do {
		const detail = document.querySelector(
			'[data-detail-state][data-kind="ready"]',
		);
		if (
			detail
				?.closest(".detail")
				?.querySelector("[data-detail-reference]")
				?.textContent?.trim() === reference
		)
			return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	throw new Error(`Browser tracer did not select ${reference}`);
}

function selectFilter(selector: string, value: string): void {
	const select = document.querySelector<HTMLSelectElement>(selector);
	if (select === null)
		throw new Error(`Browser tracer could not find ${selector}`);
	select.value = value;
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

async function clickButton(
	label: string,
	selector = ".detail button",
): Promise<void> {
	const deadline = Date.now() + 10_000;
	do {
		const button = [
			...document.querySelectorAll<HTMLButtonElement>(selector),
		].find(
			(candidate) =>
				candidate.textContent?.trim() === label && !candidate.disabled,
		);
		if (button) {
			button.click();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	throw new Error(`Browser tracer could not click ${label}`);
}

async function statusText(selector: string, text: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	do {
		if (document.querySelector(selector)?.textContent?.includes(text)) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	throw new Error(`Native UI did not show ${text}`);
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected observed response object");
	return value as Record<string, unknown>;
}
function text(value: unknown): string {
	if (typeof value !== "string" || value.length === 0)
		throw new Error("Expected observed receipt identity");
	return value;
}

const ui: FirefoxUiCommands = {
	async addComment(body) {
		const captured = await observer.capture(
			"mutation/ticket.addComment",
			async () => {
				const textarea = await element<HTMLTextAreaElement>(
					".comment-form textarea[name=body]",
				);
				textarea.value = body;
				textarea.form!.requestSubmit();
			},
		);
		await statusText(
			"[data-action-status][data-kind=ok]",
			"Adding comment complete.",
		);
		const result = record(record(await captured.response.json()).result);
		return { runId: text(record(result.job).runId) };
	},
	async sendSummary() {
		const captured = await observer.capture(
			"action/notification.sendTicketSummary",
			() => clickButton("Send summary"),
		);
		await statusText(
			"[data-action-status][data-kind=ok]",
			"Sending summary complete.",
		);
		const result = record(record(await captured.response.json()).result);
		return {
			effectKey: text(captured.effectKey),
			effectId: text(result.effectId),
			providerReceipt: text(result.providerReceipt),
			ticketReference: text(result.ticketReference),
		};
	},
	async transition(kind) {
		const captured = await observer.capture(`mutation/ticket.${kind}`, () =>
			clickButton(kind === "close" ? "Close ticket" : "Reopen"),
		);
		await captured.response.body?.cancel();
		await statusText(
			"[data-action-status][data-kind=ok]",
			kind === "close"
				? "Closing ticket complete."
				: "Reopening ticket complete.",
		);
		await element(
			`.detail [data-status="${kind === "close" ? "closed" : "open"}"]`,
		);
	},
	async rejectCreate(teamId) {
		await clickButton("New ticket", "button");
		const form = await element<HTMLFormElement>("dialog[open] form");
		const fields = {
			reference: "INVALID-REFERENCE",
			summary: "Invalid browser lifecycle reference",
			description: "Rejected inside the Firefox lifecycle tracer.",
			teamId,
		};
		for (const [name, value] of Object.entries(fields)) {
			const field = form.elements.namedItem(name);
			if (
				!(
					field instanceof HTMLInputElement ||
					field instanceof HTMLTextAreaElement ||
					field instanceof HTMLSelectElement
				)
			)
				throw new Error("Missing create form field");
			field.value = value;
		}
		const captured = await observer.capture("mutation/ticket.create", () =>
			form.requestSubmit(),
		);
		await statusText("dialog[open] .form-error", "invalid ticket");
		const error = record(record(await captured.response.json()).error);
		if (captured.response.status !== 422 || error.code !== "INVALID_TICKET")
			throw new Error("Native lifecycle UI did not report INVALID_TICKET/422");
		form.closest("dialog")!.close();
		return { code: "INVALID_TICKET", status: 422 };
	},
};

async function run(): Promise<void> {
	const parameters = new URL(location.href).searchParams;
	const persona = parameters.get("tracerPersona");
	if (persona === "customer" || persona === "agent" || persona === "admin") {
		await element(".auth-card, .workspace");
		const identity = demoAuthIdentities[persona];
		const signedIn = await authClient.signIn.email({
			email: identity.email,
			password: identity.password,
		});
		if (signedIn.error) throw new Error("Browser tracer sign-in failed");
	}
	await element('[data-queue-state][data-kind="ready"]');
	const current = await authClient.getSession();
	const session = current.data === null ? null : supportSession(current.data);
	if (session === null)
		throw new Error("Browser tracer has no support session");
	const desk = createSupportDesk({
		membershipId: session.membershipId,
		organizationId: session.organizationId,
	});
	await reportFixturePhase({ phase: "desk-ready", role: session.role });
	const slaTicket = parameters.get("tracerSlaTicket");
	if (slaTicket !== null) {
		const ticket = await desk.queries["tickets.detail"]({ id: slaTicket });
		if (ticket === null) throw new Error("SLA observer ticket is unavailable");
		await selectReference(ticket.reference);
		await observeSlaFollowUp();
		return;
	}
	const journey = firefoxJourneyFromUrl(location.href);
	if (journey === null) return;
	await runFirefoxJourney({
		...journey,
		desk,
		ui,
		loadFilteredQueue: (status, teamId) =>
			desk.queries["tickets.queue"]({
				after: null,
				first: 8,
				statuses: status ? [status] : null,
				teamIds: teamId ? [teamId] : null,
			}),
		role: session.role,
		searchTicket: async (reference) => {
			const ticket = await desk.queries["tickets.searchByReference"]({
				reference,
			});
			if (ticket !== null) await selectReference(reference);
			return ticket;
		},
		selectFilters: (status, teamId) => {
			selectFilter("[data-status-filter]", status);
			selectFilter("[data-team-filter]", teamId);
		},
	});
}

// Install observation before the product creates generated clients. No product hook.
void (async () => {
	await import("../../web/main");
	await run();
})()
	.catch(async (error: unknown) => {
		await reportFixturePhase({
			error: errorMessage(error),
			phase: "desk-error",
		});
	})
	.finally(() => {
		observer.dispose();
		globalThis.fetch = originalFetch;
	});
