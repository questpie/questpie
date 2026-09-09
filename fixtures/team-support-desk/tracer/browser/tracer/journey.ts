import { demoIds } from "../../../src/demo-ids";
import type { SupportSession } from "../../../web/auth/client";
import type { SupportDesk, SupportDeskAdapter } from "../../../web/questpie";
import { reportFixturePhase } from "../fixture-control";

type JourneyTicket = Pick<
	NonNullable<Awaited<ReturnType<SupportDesk["queries"]["tickets.detail"]>>>,
	"id" | "reference" | "status" | "teamId" | "updatedAt"
>;
type NarrowedError<Predicate> = Predicate extends ((
	error: unknown,
) => error is infer Failure)
	? Failure
	: never;
type LifecycleRejection = Pick<
	Extract<
		NarrowedError<SupportDeskAdapter["mutations"]["ticket.create"]["isError"]>,
		{ code: "INVALID_TICKET" }
	>,
	"code" | "status"
>;

export type FirefoxUiCommands = Readonly<{
	addComment(
		body: string,
	): Promise<
		Pick<
			Awaited<ReturnType<SupportDesk["mutations"]["ticket.addComment"]>>["job"],
			"runId"
		>
	>;
	sendSummary(): Promise<
		Awaited<
			ReturnType<SupportDesk["actions"]["notification.sendTicketSummary"]>
		> & { effectKey: string }
	>;
	transition(kind: "close" | "reopen"): Promise<void>;
	rejectCreate(teamId: string): Promise<LifecycleRejection>;
}>;

type CommentProjection = Readonly<{
	comments: readonly Readonly<{ body?: string; id: string }>[];
}>;

export function firefoxCommentProjectionEvidence(input: {
	detail: CommentProjection | null;
	emptyDetail: CommentProjection | null;
}) {
	if (input.detail === null)
		throw new Error("Firefox seeded ticket detail was unavailable");
	if (input.emptyDetail === null || input.emptyDetail.comments.length !== 0)
		throw new Error("Firefox empty inverse-list projection was not empty");
	if (input.detail.comments.some(({ id }) => id === demoIds.comments.internal))
		throw new Error("Firefox hidden inverse-list row remained visible");
	const expectedSeededCommentIds = [
		demoIds.comments.customerTie,
		demoIds.comments.agent,
		demoIds.comments.customer,
	];
	const expectedSeededCommentIdSet = new Set<string>(expectedSeededCommentIds);
	const seededCommentIds = input.detail.comments
		.map(({ id }) => id)
		.filter((id) => expectedSeededCommentIdSet.has(id));
	if (
		seededCommentIds.length !== expectedSeededCommentIds.length ||
		seededCommentIds.some((id, index) => id !== expectedSeededCommentIds[index])
	)
		throw new Error("Firefox seeded newest-first/tie order was incorrect");
	const agentComment = input.detail.comments.find(
		({ id }) => id === demoIds.comments.agent,
	);
	if (agentComment === undefined || Object.hasOwn(agentComment, "body"))
		throw new Error("Firefox conditional comment body was not omitted");
	return Object.freeze({
		conditionalBodyOmitted: true,
		emptyCommentsObserved: true,
		hiddenCommentRemoved: true,
		seededCommentIds: Object.freeze(seededCommentIds),
	});
}

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
	ui: FirefoxUiCommands;
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
	const ticketId = ticket.id;
	const customerProjectionEvidence =
		input.role === "customer"
			? firefoxCommentProjectionEvidence({
					detail: await input.desk.queries["tickets.detail"]({ id: ticketId }),
					emptyDetail: await input.desk.queries["tickets.detail"]({
						id: demoIds.tickets.agentClosed,
					}),
				})
			: null;
	const { runId: jobRunId } = await input.ui.addComment(input.commentBody);
	await waitForRenderedText(
		".comments",
		input.commentBody,
		"committed watched comment",
	);
	if (customerProjectionEvidence !== null) {
		await reportFixturePhase({
			authProvider: "better-auth",
			commentBody: input.commentBody,
			...customerProjectionEvidence,
			phase: "firefox-comments-complete",
			reference: input.reference,
			role: input.role,
			watchedCommentObserved: true,
		});
		return;
	}
	const summary = await input.ui.sendSummary();
	await reportFixturePhase({
		effectId: summary.effectId,
		effectKey: summary.effectKey,
		phase: "summary-sent",
		receipt: summary.providerReceipt,
		ticketReference: summary.ticketReference,
	});
	if (ticket.status === "closed") await input.ui.transition("reopen");
	await input.ui.transition("close");
	await input.ui.transition("reopen");
	ticket = await input.desk.queries["tickets.detail"]({ id: ticketId });
	if (ticket === null)
		throw new Error("Firefox transitioned ticket is unavailable");
	input.selectFilters("open", ticket.teamId);
	await input.loadFilteredQueue("open", ticket.teamId);
	const databaseOwnedUpdateAdvanced =
		Number.isFinite(initialUpdatedAt) &&
		ticket.updatedAt.getTime() > initialUpdatedAt;
	if (!databaseOwnedUpdateAdvanced)
		throw new Error("Firefox database-owned update timestamp did not advance");
	const lifecycleError = await input.ui.rejectCreate(ticket.teamId);
	await reportFixturePhase({
		authProvider: "better-auth",
		commentBody: input.commentBody,
		databaseOwnedUpdateAdvanced,
		jobRunId,
		lifecycleError,
		phase: "firefox-complete",
		reference: input.reference,
		role: input.role,
		watchedCommentObserved: true,
	});
}
