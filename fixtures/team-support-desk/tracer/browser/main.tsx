import "../../web/main";
import { demoAuthIdentities } from "../../src/auth/demo-identities";
import { authClient, supportSession } from "../../web/auth/client";
import { createSupportDesk } from "../../web/questpie";
import { errorMessage } from "../../web/shared/format";
import { reportFixturePhase } from "./fixture-control";
import { firefoxJourneyFromUrl, runFirefoxJourney } from "./tracer/journey";
import { observeSlaFollowUp } from "./tracer/sla-observer";

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
	await element('[data-detail-state][data-kind="ready"]');
}

function selectFilter(selector: string, value: string): void {
	const select = document.querySelector<HTMLSelectElement>(selector);
	if (select === null)
		throw new Error(`Browser tracer could not find ${selector}`);
	select.value = value;
	select.dispatchEvent(new Event("change", { bubbles: true }));
}

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
	const desk = createSupportDesk(session);
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
		executeTicketOperation: (_label, operation) => operation(),
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

void run().catch(async (error: unknown) => {
	await reportFixturePhase({ error: errorMessage(error), phase: "desk-error" });
});
