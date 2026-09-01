import { useEffect, useRef, useState } from "react";

import { useQueryResource } from "@questpie/react";

import type { SupportSession } from "../auth/client";
import { reportFixturePhase } from "../fixture-control";
import type { SupportDesk } from "../questpie";
import { errorMessage } from "../shared/format";
import { TicketDetailPanel } from "./detail";
import { EditTicketDialog } from "./dialogs";
import { ticketEditInput } from "./edit-input";

type SelectedTicketProps = Readonly<{
	desk: SupportDesk;
	session: SupportSession;
	ticketId: string;
}>;

export function SelectedTicket({
	desk,
	session,
	ticketId,
}: SelectedTicketProps) {
	const detailSnapshot = useQueryResource(
		desk.queries["tickets.detail"].observe({ id: ticketId }),
	);
	const commentsSnapshot = useQueryResource(
		desk.queries["comments.page"].observe({
			after: null,
			first: 50,
			ticketId,
		}),
	);
	const labelsSnapshot = useQueryResource(
		desk.queries["labels.page"].observe({
			after: null,
			first: 50,
			ticketId,
		}),
	);
	const [busy, setBusy] = useState(false);
	const [actionStatus, setActionStatus] = useState("");
	const [actionKind, setActionKind] = useState<"ok" | "error">("ok");
	const [editError, setEditError] = useState("");
	const editDialog = useRef<HTMLDialogElement>(null);
	const selectionReported = useRef(false);

	const snapshots = [detailSnapshot, commentsSnapshot, labelsSnapshot] as const;
	const failure = snapshots.find((snapshot) => snapshot.kind === "failed");
	const reconnecting = snapshots.some(
		(snapshot) =>
			snapshot.kind !== "failed" && snapshot.connection.kind === "reconnecting",
	);
	const reset = snapshots.some(
		(snapshot) =>
			snapshot.kind === "ready" && snapshot.delivery.kind === "reset",
	);
	const pending = snapshots.some((snapshot) => snapshot.kind === "pending");
	const resourceState = failure
		? "failed"
		: reconnecting
			? "reconnecting"
			: reset
				? "reset"
				: pending
					? "pending"
					: "ready";
	const resourceMessage = failure
		? `Live ticket unavailable (${failure.failure.code}).`
		: reconnecting
			? "Reconnecting while retaining the last authorized ticket view…"
			: reset
				? "Ticket view replaced after an authority or deployment reset."
				: pending
					? "Loading ticket and activity…"
					: "Live ticket view is current.";
	const ticket = detailSnapshot.kind === "ready" ? detailSnapshot.value : null;
	const comments =
		commentsSnapshot.kind === "ready" ? commentsSnapshot.value : null;
	const labels = labelsSnapshot.kind === "ready" ? labelsSnapshot.value : null;

	useEffect(() => {
		if (
			selectionReported.current ||
			detailSnapshot.kind !== "ready" ||
			detailSnapshot.value === null
		)
			return;
		selectionReported.current = true;
		void reportFixturePhase({
			phase: "ticket-selected",
			reference: detailSnapshot.value.reference,
			ticketId,
		});
	}, [detailSnapshot, ticketId]);

	async function execute<Output>(
		label: string,
		operation: () => Promise<Output>,
	): Promise<Output> {
		setBusy(true);
		setActionKind("ok");
		setActionStatus(`${label}…`);
		try {
			const output = await operation();
			setActionStatus(`${label} complete.`);
			return output;
		} catch (error) {
			setActionKind("error");
			setActionStatus(`${label} failed: ${errorMessage(error)}.`);
			throw error;
		} finally {
			setBusy(false);
		}
	}

	const detailTitle =
		detailSnapshot.kind === "ready"
			? detailSnapshot.value === null
				? "Ticket unavailable"
				: detailSnapshot.value.summary
			: detailSnapshot.kind === "failed"
				? "Ticket unavailable"
				: "Loading ticket…";
	const detailMessage =
		detailSnapshot.kind === "failed"
			? `The live Query ended with ${detailSnapshot.failure.code}.`
			: detailSnapshot.kind === "ready"
				? "The ticket no longer exists or is outside your access."
				: "Fetching details and activity.";

	return (
		<>
			<TicketDetailPanel
				actionKind={actionKind}
				actionStatus={actionStatus}
				busy={busy}
				comments={comments}
				detailMessage={detailMessage}
				detailTitle={detailTitle}
				labels={labels}
				onAssign={() => {
					if (!ticket) return;
					void execute("Assigning ticket", () =>
						desk.mutations["ticket.assign"](
							{
								assigneeMembershipId: session.membershipId,
								ticketId: ticket.id,
							},
							{ callId: `browser:assign:${crypto.randomUUID()}` },
						),
					).catch(() => undefined);
				}}
				onComment={(body, form) => {
					if (!ticket) return;
					void execute("Adding comment", () =>
						desk.mutations["ticket.addComment"](
							{ body, ticketId: ticket.id },
							{ callId: `browser:comment:${crypto.randomUUID()}` },
						),
					)
						.then(() => form.reset())
						.catch(() => undefined);
				}}
				onEdit={() => {
					setEditError("");
					editDialog.current?.showModal();
				}}
				onSummary={() => {
					if (!ticket) return;
					const effectKey = `browser:summary:${ticket.reference}:${crypto.randomUUID()}`;
					void execute("Sending summary", async () => {
						const result = await desk.actions["notification.sendTicketSummary"](
							{ ticketId: ticket.id },
							{ effectKey, timeoutMilliseconds: 3_000 },
						);
						await reportFixturePhase({
							effectId: result.effectId,
							effectKey,
							phase: "summary-sent",
							receipt: result.providerReceipt,
							ticketReference: result.ticketReference,
						});
					}).catch(() => undefined);
				}}
				onTransition={() => {
					if (!ticket) return;
					const close = ticket.status !== "closed";
					void execute(close ? "Closing ticket" : "Reopening ticket", () =>
						desk.mutations[close ? "ticket.close" : "ticket.reopen"](
							{ ticketId: ticket.id },
							{
								callId: `browser:${close ? "close" : "reopen"}:${crypto.randomUUID()}`,
							},
						),
					).catch(() => undefined);
				}}
				resourceMessage={resourceMessage}
				resourceState={resourceState}
				session={session}
				ticket={ticket}
			/>
			<EditTicketDialog
				busy={busy}
				dialogRef={editDialog}
				error={editError}
				onSubmit={(data) => {
					if (!ticket) return;
					setEditError("");
					void execute("Saving changes", () =>
						desk.mutations["ticket.edit"](
							ticketEditInput(session.role, data, ticket.id),
							{ callId: `browser:edit:${crypto.randomUUID()}` },
						),
					)
						.then(() => editDialog.current?.close())
						.catch((error: unknown) => setEditError(errorMessage(error)));
				}}
				role={session.role}
				ticket={ticket}
			/>
		</>
	);
}
