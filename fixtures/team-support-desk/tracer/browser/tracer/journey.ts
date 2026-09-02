import type { SupportSession } from "../auth/client";
import { reportFixturePhase } from "../fixture-control";
import type { SupportDesk } from "../questpie";

type JourneyTicket = Readonly<{
	id: string;
	reference: string;
	status: string;
	teamId: string;
	updatedAt: Date;
}>;

type ExecuteTicketOperation = <Output>(
	label: string,
	operation: () => Promise<Output>,
) => Promise<Output>;

async function waitForRenderedText(
	selector: string,
	text: string,
	description: string,
): Promise<void> {
	const deadline = Date.now() + 10_000;
	do {
		if (document.querySelector(selector)?.textContent?.includes(text)) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	} while (Date.now() < deadline);
	throw new Error(`${description} was not rendered`);
}

export function firefoxJourneyFromUrl(
	url: string,
): Readonly<{ commentBody: string; reference: string }> | null {
	const parameters = new URL(url).searchParams;
	const reference = parameters.get("tracerReference");
	if (reference === null) return null;
	return Object.freeze({
		commentBody:
			parameters.get("tracerComment") ??
			`Firefox update ${crypto.randomUUID()}`,
		reference,
	});
}

export async function runFirefoxJourney(input: {
	commentBody: string;
	desk: SupportDesk;
	executeTicketOperation: ExecuteTicketOperation;
	loadFilteredQueue(status: string, teamId: string): Promise<unknown>;
	reference: string;
	role: SupportSession["role"];
	searchTicket(reference: string): Promise<JourneyTicket | null>;
	selectFilters(status: string, teamId: string): void;
}): Promise<void> {
	let ticket = await input.searchTicket(input.reference);
	if (ticket === null) throw new Error("Firefox exact-reference search failed");
	await waitForRenderedText(
		'[data-detail-state][data-kind="ready"]',
		"Live ticket view is current.",
		"initial watched ticket",
	);
	const initialUpdatedAt = ticket.updatedAt.getTime();
	let ticketId = ticket.id;
	await input.executeTicketOperation("Adding comment", () =>
		input.desk.mutations["ticket.addComment"](
			{ body: input.commentBody, ticketId },
			{ callId: `browser:comment:${crypto.randomUUID()}` },
		),
	);
	await waitForRenderedText(
		".comments",
		input.commentBody,
		"committed watched comment",
	);
	const effectKey = `browser:summary:${ticket.reference}:${crypto.randomUUID()}`;
	await input.executeTicketOperation("Sending summary", async () => {
		const result = await input.desk.actions["notification.sendTicketSummary"](
			{ ticketId },
			{ effectKey, timeoutMilliseconds: 3_000 },
		);
		await reportFixturePhase({
			effectId: result.effectId,
			effectKey,
			phase: "summary-sent",
			receipt: result.providerReceipt,
			ticketReference: result.ticketReference,
		});
	});
	if (ticket.status === "closed")
		ticket = await input.executeTicketOperation("Reopening ticket", () =>
			input.desk.mutations["ticket.reopen"](
				{ ticketId },
				{ callId: `browser:reopen:${crypto.randomUUID()}` },
			),
		);
	ticketId = ticket.id;
	ticket = await input.executeTicketOperation("Closing ticket", () =>
		input.desk.mutations["ticket.close"](
			{ ticketId },
			{ callId: `browser:close:${crypto.randomUUID()}` },
		),
	);
	ticketId = ticket.id;
	ticket = await input.executeTicketOperation("Reopening ticket", () =>
		input.desk.mutations["ticket.reopen"](
			{ ticketId },
			{ callId: `browser:reopen:${crypto.randomUUID()}` },
		),
	);
	input.selectFilters("open", ticket.teamId);
	await input.loadFilteredQueue("open", ticket.teamId);
	const databaseOwnedUpdateAdvanced =
		Number.isFinite(initialUpdatedAt) &&
		ticket.updatedAt.getTime() > initialUpdatedAt;
	if (!databaseOwnedUpdateAdvanced)
		throw new Error("Firefox database-owned update timestamp did not advance");
	let lifecycleError: Readonly<{ code: string; status: number }>;
	try {
		await input.desk.mutations["ticket.create"](
			{
				description: "Rejected inside the Firefox lifecycle tracer.",
				reference: "INVALID-REFERENCE",
				summary: "Invalid browser lifecycle reference",
				teamId: ticket.teamId,
			},
			{ callId: `browser:invalid-create:${crypto.randomUUID()}` },
		);
		throw new Error("Firefox lifecycle validation unexpectedly accepted input");
	} catch (error) {
		const candidate = error as Readonly<{ code?: unknown; status?: unknown }>;
		if (candidate.code !== "INVALID_TICKET" || candidate.status !== 422)
			throw error;
		lifecycleError = Object.freeze({
			code: candidate.code,
			status: candidate.status,
		});
	}
	await reportFixturePhase({
		authProvider: "better-auth",
		commentBody: input.commentBody,
		databaseOwnedUpdateAdvanced,
		lifecycleError,
		phase: "firefox-complete",
		reference: input.reference,
		role: input.role,
		watchedCommentObserved: true,
	});
}
