import type { FormEvent } from "react";

import type { TeamPage, TicketPage } from "../questpie";

type TicketQueueProps = Readonly<{
	busy: boolean;
	onCreate: () => void;
	onNext: () => void;
	onPrevious: () => void;
	onSearch: (reference: string) => void;
	onSelect: (ticketId: string) => void;
	onStatusFilter: (status: string) => void;
	onTeamFilter: (teamId: string) => void;
	page: TicketPage | null;
	pageIndex: number;
	queueKind: "failed" | "pending" | "ready";
	queueMessage: string;
	selectedTicketId: string | null;
	statusFilter: string;
	teamFilter: string;
	teams: TeamPage["nodes"];
}>;

export function TicketQueue({
	busy,
	onCreate,
	onNext,
	onPrevious,
	onSearch,
	onSelect,
	onStatusFilter,
	onTeamFilter,
	page,
	pageIndex,
	queueKind,
	queueMessage,
	selectedTicketId,
	statusFilter,
	teamFilter,
	teams,
}: TicketQueueProps) {
	function submitSearch(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		const reference = String(
			new FormData(event.currentTarget).get("reference") ?? "",
		).trim();
		if (reference) onSearch(reference);
	}

	return (
		<section className="queue" aria-labelledby="queue-heading">
			<header className="queue-heading">
				<div>
					<p className="eyebrow">Active workspace</p>
					<h1 id="queue-heading">Ticket queue</h1>
				</div>
				<button className="primary" type="button" onClick={onCreate}>
					New ticket
				</button>
			</header>

			<form className="reference-search" role="search" onSubmit={submitSearch}>
				<label htmlFor="reference-search">Find exact reference</label>
				<div className="field-row">
					<input
						id="reference-search"
						name="reference"
						placeholder="SUP-1001"
						autoComplete="off"
					/>
					<button type="submit">Find</button>
				</div>
			</form>

			<div className="filters" aria-label="Queue filters">
				<label>
					Status
					<select
						data-status-filter
						value={statusFilter}
						onChange={(event) => onStatusFilter(event.currentTarget.value)}
					>
						<option value="">All statuses</option>
						<option value="open">Open</option>
						<option value="closed">Closed</option>
					</select>
				</label>
				<label>
					Team
					<select
						data-team-filter
						value={teamFilter}
						onChange={(event) => onTeamFilter(event.currentTarget.value)}
					>
						<option value="">All teams</option>
						{teams.map((team) => (
							<option key={team.id} value={team.id}>
								{team.name}
							</option>
						))}
					</select>
				</label>
			</div>

			<div
				className="state-banner"
				data-queue-state
				data-kind={queueKind}
				role="status"
				aria-live="polite"
			>
				{queueMessage}
			</div>
			<ul
				className="ticket-list"
				data-ticket-list
				aria-label="Tickets"
				aria-busy={queueKind === "pending"}
			>
				{page?.nodes.map((ticket) => (
					<li key={ticket.id}>
						<button
							type="button"
							className="ticket-card"
							data-ticket-id={ticket.id}
							aria-current={selectedTicketId === ticket.id}
							onClick={() => onSelect(ticket.id)}
						>
							<span>
								<strong>{ticket.summary}</strong>
								<small>
									{ticket.reference} · {ticket.team?.name ?? "Unrouted"}
								</small>
							</span>
							<span className="queue-status" data-status={ticket.status}>
								{ticket.status}
							</span>
						</button>
					</li>
				))}
			</ul>
			<nav className="pagination" aria-label="Ticket pages">
				<button
					type="button"
					disabled={busy || pageIndex === 0}
					onClick={onPrevious}
				>
					Previous
				</button>
				<span>Page {pageIndex + 1}</span>
				<button
					type="button"
					disabled={busy || !page?.pageInfo.hasNextPage}
					onClick={onNext}
				>
					Next
				</button>
			</nav>
		</section>
	);
}
