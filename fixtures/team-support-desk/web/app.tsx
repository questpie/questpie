import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";

import type { SupportSession } from "./auth/client";
import type { SupportDesk, SupportDeskAdapter } from "./questpie";
import { errorMessage } from "./shared/format";
import { CreateTicketDialog } from "./tickets/dialogs";
import { TicketQueue } from "./tickets/queue";
import { SelectedTicket } from "./tickets/selected";

type DeskApplicationProps = Readonly<{
	desk: SupportDesk;
	api: SupportDeskAdapter;
	onSignOut: () => Promise<void>;
	session: SupportSession;
}>;

export function DeskApplication({
	desk,
	api,
	onSignOut,
	session,
}: DeskApplicationProps) {
	const [pageIndex, setPageIndex] = useState(0);
	const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
	const [statusFilter, setStatusFilter] = useState("");
	const [teamFilter, setTeamFilter] = useState("");
	const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
	const createDialog = useRef<HTMLDialogElement>(null);
	const after = cursors[pageIndex] ?? null;

	const queue = useQuery(
		api.queries["tickets.queue"].options({
			after,
			first: 8,
			statuses: statusFilter ? [statusFilter] : null,
			teamIds: teamFilter ? [teamFilter] : null,
		}),
	);
	const teamsQuery = useQuery(
		api.queries["teams.list"].options({
			after: null,
			first: 100,
			organizationId: session.organizationId,
		}),
	);
	const create = useMutation({
		...api.mutations["ticket.create"].options(),
		onSuccess: (created) => {
			createDialog.current?.close();
			createDialog.current?.querySelector("form")?.reset();
			setCursors([null]);
			setPageIndex(0);
			setSelectedTicketId(created.id);
		},
	});
	const page = queue.isSuccess ? queue.data : null;
	const teams = teamsQuery.isSuccess ? teamsQuery.data.nodes : [];
	const queueKind = queue.isError
		? "failed"
		: queue.isPending
			? "pending"
			: "ready";
	const queueMessage = queue.isError
		? `Live queue unavailable (${errorMessage(queue.error)}).`
		: page === null
			? "Loading live queue…"
			: page.nodes.length === 0
				? "No tickets match these filters."
				: `${page.nodes.length} ticket${page.nodes.length === 1 ? "" : "s"} on this page`;
	async function searchTicket(reference: string): Promise<void> {
		const match = await desk.queries["tickets.searchByReference"]({
			reference,
		});
		if (match !== null) setSelectedTicketId(match.id);
	}

	function changeFilters(status: string, teamId: string): void {
		setStatusFilter(status);
		setTeamFilter(teamId);
		setCursors([null]);
		setPageIndex(0);
	}

	function nextPage(): void {
		const nextAfter = page?.pageInfo.endCursor;
		if (!page?.pageInfo.hasNextPage || !nextAfter) return;
		const index = pageIndex + 1;
		setCursors((current) => {
			const next = [...current];
			next[index] = nextAfter;
			return next;
		});
		setPageIndex(index);
	}

	function previousPage(): void {
		if (pageIndex === 0) return;
		setPageIndex((current) => current - 1);
	}

	return (
		<>
			<header className="topbar">
				<a className="brand" href="/" aria-label="Team Support Desk home">
					<span className="brand-mark" aria-hidden="true">
						Q
					</span>
					<span>
						<strong>Support Desk</strong>
						<small>Team operations</small>
					</span>
				</a>
				<div className="session" aria-label="Signed-in persona">
					<span className="presence" aria-hidden="true" />
					<span>
						<small>Signed in as</small>
						<strong>
							{session.label} · {session.role}
						</strong>
					</span>
					<button
						className="sign-out"
						onClick={() => void onSignOut()}
						type="button"
					>
						Sign out
					</button>
				</div>
			</header>

			<main className="workspace">
				<TicketQueue
					busy={create.isPending}
					onCreate={() => {
						create.reset();
						createDialog.current?.showModal();
					}}
					onNext={nextPage}
					onPrevious={previousPage}
					onSearch={(reference) =>
						void searchTicket(reference).catch(() => undefined)
					}
					onSelect={setSelectedTicketId}
					onStatusFilter={(status) => changeFilters(status, teamFilter)}
					onTeamFilter={(teamId) => changeFilters(statusFilter, teamId)}
					page={page}
					pageIndex={pageIndex}
					queueKind={queueKind}
					queueMessage={queueMessage}
					selectedTicketId={selectedTicketId}
					statusFilter={statusFilter}
					teamFilter={teamFilter}
					teams={teams}
				/>
				{selectedTicketId === null ? (
					<section className="detail" aria-labelledby="detail-heading">
						<div className="detail-empty">
							<span className="empty-glyph" aria-hidden="true">
								↗
							</span>
							<h2 id="detail-heading">Choose a ticket</h2>
							<p>
								Select an item from the queue to see its conversation and
								available actions.
							</p>
						</div>
					</section>
				) : (
					<SelectedTicket
						desk={desk}
						api={api}
						key={selectedTicketId}
						session={session}
						ticketId={selectedTicketId}
					/>
				)}
			</main>

			<CreateTicketDialog
				busy={create.isPending}
				dialogRef={createDialog}
				error={create.isError ? errorMessage(create.error) : ""}
				onSubmit={(data) => {
					create.mutate({
						description: String(data.get("description")),
						priority: String(data.get("priority")),
						reference: String(data.get("reference")),
						summary: String(data.get("summary")),
						teamId: String(data.get("teamId")),
					});
				}}
				teams={teams}
			/>
		</>
	);
}
