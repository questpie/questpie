import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import type { SupportSession } from "../auth/client";
import type { SupportDesk, SupportDeskAdapter } from "../questpie";
import { errorMessage } from "../shared/format";
import { TicketDetailPanel } from "./detail";
import { EditTicketDialog } from "./dialogs";
import { ticketEditInput } from "./edit-input";

type SelectedTicketProps = Readonly<{
	api: SupportDeskAdapter;
	desk: SupportDesk;
	session: SupportSession;
	ticketId: string;
}>;

export function SelectedTicket({
	api,
	desk,
	session,
	ticketId,
}: SelectedTicketProps) {
	const detail = useQuery(
		api.queries["tickets.detail"].options({ id: ticketId }),
	);
	const labelQuery = useQuery(
		api.queries["labels.page"].options({
			after: null,
			first: 50,
			ticketId,
		}),
	);
	const assign = useMutation(api.mutations["ticket.assign"].options());
	const comment = useMutation({
		...api.mutations["ticket.addComment"].options(),
		onMutate: (input) => ({ body: input.body }),
	});
	const edit = useMutation(api.mutations["ticket.edit"].options());
	const close = useMutation(api.mutations["ticket.close"].options());
	const reopen = useMutation(api.mutations["ticket.reopen"].options());
	const [action, setAction] = useState<{
		pending: boolean;
		kind: "ok" | "error";
		message: string;
		submittedAt: number;
	} | null>(null);
	const editDialog = useRef<HTMLDialogElement>(null);

	const queries = [detail, labelQuery];
	const failure = queries.find((query) => query.isError);
	const resourceState = failure
		? "failed"
		: queries.some((query) => query.isPending)
			? "pending"
			: "ready";
	const resourceMessage = failure
		? `Live ticket unavailable (${errorMessage(failure.error)}).`
		: resourceState === "pending"
			? "Loading ticket and activity…"
			: "Live ticket view is current.";
	const ticket = detail.isSuccess ? detail.data : null;
	const labels = labelQuery.isSuccess ? labelQuery.data : null;
	const commands = [
		{ label: "Assigning ticket", state: assign },
		{ label: "Adding comment", state: comment },
		{ label: "Saving changes", state: edit },
		{ label: "Closing ticket", state: close },
		{ label: "Reopening ticket", state: reopen },
	];
	const latest = commands.reduce((left, right) =>
		right.state.submittedAt > left.state.submittedAt ? right : left,
	);
	const showAction =
		action !== null && action.submittedAt >= latest.state.submittedAt;
	const busy =
		action?.pending === true || commands.some(({ state }) => state.isPending);
	const actionKind = showAction
		? action.kind
		: latest.state.isError
			? "error"
			: "ok";
	const actionStatus = showAction
		? action.message
		: latest.state.isPending
			? `${latest.label}…`
			: latest.state.isError
				? `${latest.label}: ${errorMessage(latest.state.error)}.`
				: latest.state.isSuccess
					? `${latest.label} complete.`
					: "";
	// Pending intent is presentation only. Never merge it into the authorized cache.
	const pendingComment =
		ticket && comment.isPending && comment.variables.ticketId === ticket.id
			? comment.context?.body
			: undefined;

	async function sendSummary() {
		if (!ticket) return;
		const submittedAt = Date.now();
		setAction({
			pending: true,
			kind: "ok",
			message: "Sending summary…",
			submittedAt,
		});
		try {
			const effectKey = `browser:summary:${ticket.reference}:${crypto.randomUUID()}`;
			await desk.actions["notification.sendTicketSummary"](
				{ ticketId: ticket.id },
				{ effectKey, timeoutMilliseconds: 3_000 },
			);
			setAction({
				pending: false,
				kind: "ok",
				message: "Sending summary complete.",
				submittedAt,
			});
		} catch (error) {
			setAction({
				pending: false,
				kind: "error",
				message: `Sending summary failed: ${errorMessage(error)}.`,
				submittedAt,
			});
		}
	}

	const detailTitle = detail.isSuccess
		? detail.data === null
			? "Ticket unavailable"
			: detail.data.summary
		: detail.isError
			? "Ticket unavailable"
			: "Loading ticket…";
	const detailMessage = detail.isError
		? `The live Query ended with ${errorMessage(detail.error)}.`
		: detail.isSuccess
			? "The ticket no longer exists or is outside your access."
			: "Fetching details and activity.";

	return (
		<>
			<TicketDetailPanel
				actionKind={actionKind}
				actionStatus={actionStatus}
				busy={busy}
				detailMessage={detailMessage}
				detailTitle={detailTitle}
				labels={labels}
				pendingComment={pendingComment}
				onAssign={() => {
					if (!ticket) return;
					assign.mutate({
						assigneeMembershipId: session.membershipId,
						ticketId: ticket.id,
					});
				}}
				onComment={(body, form) => {
					if (!ticket) return;
					comment.mutate(
						{ body, ticketId: ticket.id },
						{ onSuccess: () => form.reset() },
					);
				}}
				onEdit={() => {
					edit.reset();
					editDialog.current?.showModal();
				}}
				onSummary={() => void sendSummary()}
				onTransition={() => {
					if (!ticket) return;
					const transition = ticket.status === "closed" ? reopen : close;
					transition.mutate({ ticketId: ticket.id });
				}}
				resourceMessage={resourceMessage}
				resourceState={resourceState}
				session={session}
				ticket={ticket}
			/>
			<EditTicketDialog
				busy={busy}
				dialogRef={editDialog}
				error={edit.isError ? errorMessage(edit.error) : ""}
				onSubmit={(data) => {
					if (!ticket) return;
					edit.mutate(ticketEditInput(session.role, data, ticket.id), {
						onSuccess: () => editDialog.current?.close(),
					});
				}}
				role={session.role}
				ticket={ticket}
			/>
		</>
	);
}
