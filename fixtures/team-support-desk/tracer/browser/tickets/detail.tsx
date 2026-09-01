import type { CSSProperties, FormEvent } from "react";

import type { SupportSession } from "../auth/client";
import type { CommentPage, LabelPage, TicketDetail } from "../questpie";
import { dateTime } from "../shared/format";

type TicketDetailPanelProps = Readonly<{
	actionKind: "ok" | "error";
	actionStatus: string;
	busy: boolean;
	comments: CommentPage | null;
	detailMessage: string;
	detailTitle: string;
	labels: LabelPage | null;
	onAssign: () => void;
	onComment: (body: string, form: HTMLFormElement) => void;
	onEdit: () => void;
	onSummary: () => void;
	onTransition: () => void;
	resourceMessage: string;
	resourceState: "failed" | "pending" | "ready" | "reconnecting" | "reset";
	session: SupportSession;
	ticket: TicketDetail | null;
}>;

export function TicketDetailPanel({
	actionKind,
	actionStatus,
	busy,
	comments,
	detailMessage,
	detailTitle,
	labels,
	onAssign,
	onComment,
	onEdit,
	onSummary,
	onTransition,
	resourceMessage,
	resourceState,
	session,
	ticket,
}: TicketDetailPanelProps) {
	if (ticket === null)
		return (
			<section className="detail" aria-labelledby="detail-heading">
				<div
					className="state-banner"
					data-detail-state
					data-kind={resourceState}
					role="status"
					aria-live="polite"
				>
					{resourceMessage}
				</div>
				<div className="detail-empty">
					<span className="empty-glyph" aria-hidden="true">
						↗
					</span>
					<h2 id="detail-heading">{detailTitle}</h2>
					<p>{detailMessage}</p>
				</div>
			</section>
		);

	const unavailable = busy;
	function submitComment(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const form = event.currentTarget;
		const body = String(new FormData(form).get("body") ?? "").trim();
		if (body) onComment(body, form);
	}

	return (
		<section className="detail" aria-labelledby="detail-heading">
			<div className="detail-content">
				<div
					className="state-banner"
					data-detail-state
					data-kind={resourceState}
					role="status"
					aria-live="polite"
				>
					{resourceMessage}
				</div>
				<header className="detail-header">
					<div>
						<p className="reference" data-detail-reference>
							{ticket.reference}
						</p>
						<h2 id="detail-heading">{ticket.summary}</h2>
					</div>
					<span className="status-pill" data-status={ticket.status}>
						{ticket.status}
					</span>
				</header>

				<div className="detail-meta">
					<span>
						<strong>Priority: </strong>
						{ticket.priority}
					</span>
					<span>
						<strong>Team: </strong>
						{ticket.team?.name ?? "Unrouted"}
					</span>
					<span>
						<strong>Requester: </strong>
						{ticket.requester
							? `${ticket.requester.role} · ${ticket.requester.principalId.slice(0, 8)}`
							: "Unknown"}
					</span>
					<span>
						<strong>Assignee: </strong>
						{ticket.assignee
							? `${ticket.assignee.role} · ${ticket.assignee.principalId.slice(0, 8)}`
							: "Unassigned"}
					</span>
					<span>
						<strong>Updated: </strong>
						{dateTime(ticket.updatedAt)}
					</span>
				</div>
				<p className="description">{ticket.description}</p>
				<div className="labels" aria-label="Ticket labels">
					{labels?.nodes.map((label) => (
						<span
							key={label.id}
							className="label-chip"
							style={{ "--label-color": label.color } as CSSProperties}
						>
							{label.name}
						</span>
					))}
				</div>

				<div className="action-bar" aria-label="Ticket actions">
					<button
						type="button"
						disabled={
							unavailable ||
							(session.role === "customer" && ticket.status === "closed")
						}
						onClick={onEdit}
					>
						Edit
					</button>
					<button
						type="button"
						disabled={
							unavailable ||
							session.role === "customer" ||
							ticket.assignee?.id === session.membershipId
						}
						onClick={onAssign}
					>
						{ticket.assignee?.id === session.membershipId
							? "Assigned to me"
							: "Assign to me"}
					</button>
					<button
						type="button"
						disabled={unavailable || session.role === "customer"}
						onClick={onSummary}
					>
						Send summary
					</button>
					<button
						className="primary"
						type="button"
						disabled={unavailable || session.role === "customer"}
						onClick={onTransition}
					>
						{ticket.status === "closed" ? "Reopen" : "Close ticket"}
					</button>
				</div>
				<p
					className="action-status"
					data-action-status
					data-kind={actionKind}
					role="status"
					aria-live="polite"
				>
					{actionStatus}
				</p>

				<section className="activity" aria-labelledby="activity-heading">
					<header>
						<h3 id="activity-heading">Activity</h3>
						<span>
							{comments?.nodes.length ?? 0} comment
							{comments?.nodes.length === 1 ? "" : "s"}
						</span>
					</header>
					<div className="state-banner" role="status" aria-live="polite">
						{comments?.nodes.length === 0 ? "No activity yet." : ""}
					</div>
					<ol className="comments">
						{comments?.nodes.map((comment) => (
							<li className="comment" key={comment.id}>
								<span className="avatar" aria-hidden="true">
									{(comment.author?.role ?? "?").slice(0, 2)}
								</span>
								<div>
									<header>
										<strong>
											{comment.author
												? `${comment.author.role} · ${comment.author.principalId.slice(0, 8)}`
												: "Former member"}
										</strong>
										<time dateTime={comment.createdAt.toISOString()}>
											{dateTime(comment.createdAt)}
										</time>
									</header>
									<p>{comment.body}</p>
								</div>
							</li>
						))}
					</ol>
					<form className="comment-form" onSubmit={submitComment}>
						<label htmlFor="comment-body">Add a comment</label>
						<textarea
							id="comment-body"
							name="body"
							rows={3}
							required
							maxLength={2_000}
							placeholder="Share an update with the team…"
						/>
						<div>
							<span>Visible to this ticket’s participants</span>
							<button className="primary" type="submit" disabled={busy}>
								Comment
							</button>
						</div>
					</form>
				</section>
			</div>
		</section>
	);
}
